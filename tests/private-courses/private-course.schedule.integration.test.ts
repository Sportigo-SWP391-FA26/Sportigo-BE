import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../src/lib/prisma.js'
import { PrivateCourseService } from '../../src/modules/private-courses/private.service.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  createCoach,
  createGroupClass,
  createMember,
  createPrivateCourse,
  createRegistration,
  createRoom,
  createSport,
  resetDatabase,
} from '../training/fixtures.js'

const service = new PrivateCourseService()

describe.skipIf(!hasTestDatabase)('FR-29 private-course recurring schedule integration', () => {
  beforeEach(resetDatabase)
  afterAll(() => prisma.$disconnect())

  async function expectConflictAtOccurrence(resource: 'coach' | 'member' | 'room', week: number) {
    const member = await createMember()
    const coach = await createCoach()
    const otherCoach = await createCoach()
    const otherMember = await createMember()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const room = await createRoom()
    const otherRoom = await createRoom()
    const classCoach = resource === 'coach' ? coach : otherCoach
    const registrationMember = resource === 'member' ? member : otherMember

    await prisma.coachSport.create({ data: { coachId: coach.id, sportId: sport.id } })
    await prisma.coachPrivateCourse.create({
      data: { coachId: coach.id, privateCourseId: course.id, isActive: true },
    })

    const startDate = new Date()
    startDate.setUTCHours(0, 0, 0, 0)
    startDate.setUTCDate(startDate.getUTCDate() + ((2 - startDate.getUTCDay() + 7) % 7 || 7))
    const endDate = new Date(startDate)
    endDate.setUTCDate(endDate.getUTCDate() + course.validityDays)
    await prisma.coachAvailability.create({
      data: {
        coachId: coach.id,
        dayOfWeek: startDate.getUTCDay(),
        startTime: new Date('1970-01-01T08:00:00.000Z'),
        endTime: new Date('1970-01-01T12:00:00.000Z'),
        effectiveFrom: startDate,
        effectiveTo: endDate,
      },
    })

    const groupClass = await createGroupClass({ sportId: sport.id, coachId: classCoach.id })
    const date = new Date(startDate)
    date.setUTCDate(date.getUTCDate() + 7 * week)
    await prisma.classSession.create({
      data: {
        classId: groupClass.id,
        roomId: resource === 'room' ? room.id : otherRoom.id,
        startsAt: new Date(`${date.toISOString().slice(0, 10)}T09:30:00.000Z`),
        endsAt: new Date(`${date.toISOString().slice(0, 10)}T10:30:00.000Z`),
      },
    })
    await createRegistration({
      memberId: registrationMember.id,
      classId: groupClass.id,
      status: 'CONFIRMED',
    })

    await expect(service.createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: course.id,
      startDate: startDate.toISOString().slice(0, 10),
      schedules: [{
        dayOfWeek: startDate.getUTCDay(),
        startTime: '09:00',
        roomId: room.id,
      }],
    })).rejects.toMatchObject({ status: 409, code: 'SCHEDULE_CONFLICT' })

    expect(await prisma.privateCourseEnrollment.count({
      where: { memberId: member.id, privateCourseId: course.id },
    })).toBe(0)
  }

  it.each([['first', 0], ['middle', 6], ['last', 12]] as const)(
    'rejects %s-occurrence conflicts for Coach, Member, and room',
    async (_label, week) => {
      for (const resource of ['coach', 'member', 'room'] as const) {
        await expectConflictAtOccurrence(resource, week)
      }
    },
  )

  it('migration enforces unique coach-to-sport qualifications and foreign keys', async () => {
    const coach = await createCoach()
    const sport = await createSport()
    const qualification = { coachId: coach.id, sportId: sport.id }
    await prisma.coachSport.create({ data: qualification })
    await expect(prisma.coachSport.create({ data: qualification })).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(prisma.coachSport.create({
      data: { coachId: coach.id, sportId: 999_999 },
    })).rejects.toMatchObject({ code: 'P2003' })
  })
})
