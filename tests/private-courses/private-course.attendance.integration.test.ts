import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  createCoach,
  createEnrollment,
  createManager,
  createMember,
  createPrivateCourse,
  createSport,
  resetDatabase,
} from '../training/fixtures.js'

describe.skipIf(!hasTestDatabase)('FR-36 private-course attendance integration', () => {
  beforeEach(resetDatabase)
  afterAll(() => prisma.$disconnect())

  async function createAttendanceScenario(remainingSessions = 1, status: 'ACTIVE' | 'PENDING_PAYMENT' = 'ACTIVE') {
    const member = await createMember()
    const coach = await createCoach()
    const otherCoach = await createCoach()
    const manager = await createManager()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const enrollment = await createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: course.id,
      status,
    })
    await prisma.privateCourseEnrollment.update({
      where: { id: enrollment.id },
      data: {
        remainingSessions,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const sessionDate = new Date()
    sessionDate.setUTCHours(0, 0, 0, 0)
    sessionDate.setUTCDate(sessionDate.getUTCDate() - 7)
    const schedule = await prisma.privateCourseSchedule.create({
      data: {
        enrollmentId: enrollment.id,
        roomId: (await prisma.room.create({
          data: { code: `PRIVATE-${enrollment.id}`, name: 'Private room', capacity: 2 },
        })).id,
        dayOfWeek: sessionDate.getUTCDay(),
        startTime: new Date('1970-01-01T00:00:00.000Z'),
        endTime: new Date('1970-01-01T00:01:00.000Z'),
        effectiveFrom: new Date(sessionDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        effectiveTo: new Date(sessionDate.getTime() + 30 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    })
    return {
      member,
      coach,
      otherCoach,
      manager,
      enrollment,
      schedule,
      sessionDate: sessionDate.toISOString().slice(0, 10),
    }
  }

  it('only the assigned Coach can mark a completed occurrence and concurrent retries consume one session', async () => {
    const scenario = await createAttendanceScenario()
    const url = `/api/private-courses/enrollments/${scenario.enrollment.id}/schedules/${scenario.schedule.id}/attendance`
    const unauthorized = await request(app)
      .post(url)
      .set('Authorization', scenario.otherCoach.auth)
      .send({ sessionDate: scenario.sessionDate })
    const wrongRole = await request(app)
      .post(url)
      .set('Authorization', scenario.manager.auth)
      .send({ sessionDate: scenario.sessionDate })
    expect(unauthorized.status).toBe(403)
    expect(wrongRole.status).toBe(403)

    const duplicateAttempts = await Promise.all([
      request(app).post(url).set('Authorization', scenario.coach.auth).send({ sessionDate: scenario.sessionDate }),
      request(app).post(url).set('Authorization', scenario.coach.auth).send({ sessionDate: scenario.sessionDate }),
    ])
    expect(duplicateAttempts.some((response) => response.status === 200)).toBe(true)
    expect(duplicateAttempts.every((response) => [200, 409].includes(response.status))).toBe(true)
    expect(await prisma.privateCourseAttendance.count({ where: { scheduleId: scenario.schedule.id } })).toBe(1)
    expect(await prisma.privateCourseEnrollment.findUniqueOrThrow({
      where: { id: scenario.enrollment.id },
    })).toMatchObject({ status: 'COMPLETED', remainingSessions: 0 })
  })

  it('does not record attendance or decrement sessions for an unpaid enrollment', async () => {
    const scenario = await createAttendanceScenario(1, 'PENDING_PAYMENT')
    const response = await request(app)
      .post(`/api/private-courses/enrollments/${scenario.enrollment.id}/schedules/${scenario.schedule.id}/attendance`)
      .set('Authorization', scenario.coach.auth)
      .send({ sessionDate: scenario.sessionDate })

    expect(response.status).toBe(409)
    expect(await prisma.privateCourseAttendance.count({ where: { scheduleId: scenario.schedule.id } })).toBe(0)
    expect(await prisma.privateCourseEnrollment.findUniqueOrThrow({
      where: { id: scenario.enrollment.id },
    })).toMatchObject({ status: 'PENDING_PAYMENT', remainingSessions: 1 })
  })

  it('rolls back a second occurrence when concurrent attendance exceeds remaining sessions', async () => {
    const scenario = await createAttendanceScenario(1)
    const firstDate = new Date(`${scenario.sessionDate}T00:00:00.000Z`)
    const secondDate = new Date(firstDate)
    secondDate.setUTCDate(secondDate.getUTCDate() - 7)
    const secondDateString = secondDate.toISOString().slice(0, 10)
    const secondSchedule = await prisma.privateCourseSchedule.create({
      data: {
        enrollmentId: scenario.enrollment.id,
        roomId: scenario.schedule.roomId,
        dayOfWeek: secondDate.getUTCDay(),
        startTime: new Date('1970-01-01T00:02:00.000Z'),
        endTime: new Date('1970-01-01T00:03:00.000Z'),
        effectiveFrom: new Date(secondDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        effectiveTo: new Date(secondDate.getTime() + 30 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    })
    const mark = (scheduleId: number, date: string) =>
      request(app)
        .post(`/api/private-courses/enrollments/${scenario.enrollment.id}/schedules/${scheduleId}/attendance`)
        .set('Authorization', scenario.coach.auth)
        .send({ sessionDate: date })

    const responses = await Promise.all([
      mark(scenario.schedule.id, scenario.sessionDate),
      mark(secondSchedule.id, secondDateString),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(await prisma.privateCourseAttendance.count({
      where: { schedule: { enrollmentId: scenario.enrollment.id } },
    })).toBe(1)
    expect(await prisma.privateCourseEnrollment.findUniqueOrThrow({
      where: { id: scenario.enrollment.id },
    })).toMatchObject({ status: 'COMPLETED', remainingSessions: 0 })
  })

  it('migration enforces unique occurrences and valid start/end times', async () => {
    const scenario = await createAttendanceScenario()
    const attendance = {
      scheduleId: scenario.schedule.id,
      sessionDate: new Date(`${scenario.sessionDate}T00:00:00.000Z`),
      startsAt: new Date(`${scenario.sessionDate}T00:00:00.000Z`),
      endsAt: new Date(`${scenario.sessionDate}T00:01:00.000Z`),
      markedById: scenario.coach.id,
    }
    await prisma.privateCourseAttendance.create({ data: attendance })
    await expect(prisma.privateCourseAttendance.create({ data: attendance })).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(prisma.privateCourseAttendance.create({
      data: { ...attendance, sessionDate: new Date(`${scenario.sessionDate}T00:00:00.000Z`), startsAt: attendance.endsAt, endsAt: attendance.startsAt },
    })).rejects.toThrow(/PrivateCourseAttendance_valid_time_check/)
    await expect(prisma.privateCourseAttendance.create({
      data: { ...attendance, scheduleId: 999_999 },
    })).rejects.toMatchObject({ code: 'P2003' })
  })
})
