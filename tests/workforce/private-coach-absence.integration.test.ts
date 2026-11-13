import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import { DAY, createCoach, createManager, createMember, createPrivateCourse, createRoom, createSport, resetDatabase } from '../training/fixtures.js'

describe.skipIf(!hasTestDatabase)('Coach báo nghỉ và xếp bù buổi 1–1', () => {
  let manager: Awaited<ReturnType<typeof createManager>>
  let coach: Awaited<ReturnType<typeof createCoach>>
  let other: Awaited<ReturnType<typeof createCoach>>
  let scheduleId: number
  let sessionDate: string
  let roomId: number
  let originalStart: Date

  beforeAll(async () => {
    await resetDatabase()
    manager = await createManager()
    coach = await createCoach()
    other = await createCoach()
    const member = await createMember()
    const sport = await createSport()
    const room = await createRoom(); roomId = room.id
    const course = await createPrivateCourse({ sportId: sport.id })
    await prisma.coachSport.createMany({ data: [{ coachId: coach.id, sportId: sport.id }, { coachId: other.id, sportId: sport.id }] })
    const enrollment = await prisma.privateCourseEnrollment.create({ data: {
      memberId: member.id, coachId: coach.id, privateCourseId: course.id, status: 'ACTIVE',
      purchasedSessions: 12, remainingSessions: 12, purchasedPrice: 6_000_000,
      startDate: new Date(Date.now() - DAY), expiryDate: new Date(Date.now() + 50 * DAY),
    } })
    originalStart = new Date(Date.now() + 5 * DAY)
    originalStart.setUTCHours(2, 0, 0, 0)
    sessionDate = originalStart.toISOString().slice(0, 10)
    const schedule = await prisma.privateCourseSchedule.create({ data: {
      enrollmentId: enrollment.id, roomId, dayOfWeek: originalStart.getUTCDay(),
      startTime: new Date('1970-01-01T02:00:00.000Z'), endTime: new Date('1970-01-01T03:30:00.000Z'),
      effectiveFrom: new Date(Date.now() - DAY), effectiveTo: new Date(Date.now() + 40 * DAY),
    } })
    scheduleId = schedule.id
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('chỉ Coach được phân công báo nghỉ; Manager duyệt thì hủy riêng buổi đó', async () => {
    const body = { scheduleId, sessionDate, reason: 'Ốm đột xuất' }
    expect((await request(app).post('/api/coach-absences/private/me').set('Authorization', other.auth).send(body)).status).toBe(403)
    const created = await request(app).post('/api/coach-absences/private/me').set('Authorization', coach.auth).send(body)
    expect(created.status).toBe(201)
    expect(created.body.status).toBe('PENDING')
    const approved = await request(app).post(`/api/coach-absences/private/${created.body.id}/review`).set('Authorization', manager.auth).send({ approve: true })
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe('APPROVED')
    expect((await prisma.privateCourseScheduleException.findUniqueOrThrow({ where: { scheduleId_sessionDate: { scheduleId, sessionDate: new Date(`${sessionDate}T00:00:00Z`) } } })).action).toBe('CANCELLED')
    expect((await request(app).post(`/api/coach-absences/private/${created.body.id}/review`).set('Authorization', manager.auth).send({ approve: true })).status).toBe(409)

    const makeupStart = new Date(originalStart.getTime() + 2 * DAY)
    const makeupEnd = new Date(makeupStart.getTime() + 90 * 60_000)
    await prisma.coachAvailability.create({ data: { coachId: other.id, dayOfWeek: makeupStart.getUTCDay(),
      startTime: new Date('1970-01-01T09:00:00.000Z'), endTime: new Date('1970-01-01T10:30:00.000Z'),
      effectiveFrom: new Date('2026-01-01T00:00:00Z') } })
    const makeupBody = { coachId: other.id, roomId, startsAt: makeupStart.toISOString(), endsAt: makeupEnd.toISOString() }
    const makeup = await request(app).post(`/api/coach-absences/private/${created.body.id}/makeup`).set('Authorization', manager.auth).send(makeupBody)
    expect(makeup.status).toBe(201)
    expect(makeup.body.makeupCoachId).toBe(other.id)
    const exception = await prisma.privateCourseScheduleException.findUniqueOrThrow({ where: { scheduleId_sessionDate: { scheduleId, sessionDate: new Date(`${sessionDate}T00:00:00Z`) } } })
    expect(exception).toMatchObject({ action: 'RESCHEDULED', newCoachId: other.id, newRoomId: roomId })
    expect((await request(app).post(`/api/coach-absences/private/${created.body.id}/makeup`).set('Authorization', manager.auth).send(makeupBody)).status).toBe(409)
  })
})
