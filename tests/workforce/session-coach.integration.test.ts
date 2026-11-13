import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import sessionService from '../../src/modules/class-sessions/session.service.js'
import groupClassService from '../../src/modules/group-classes/group-class.service.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  DAY,
  HOUR,
  createCoach,
  createGroupClass,
  createManager,
  createMember,
  createRegistration,
  createRoom,
  createSession,
  createSport,
  resetDatabase,
} from '../training/fixtures.js'

// FR-66: coach dạy thực tế từng buổi (dạy thay, coach vắng) – test với database thật
describe.skipIf(!hasTestDatabase)('FR-66 Dạy thay và coach vắng', () => {
  let manager: Awaited<ReturnType<typeof createManager>>
  let mainCoach: Awaited<ReturnType<typeof createCoach>>
  let subCoach: Awaited<ReturnType<typeof createCoach>>
  let unqualifiedCoach: Awaited<ReturnType<typeof createCoach>>
  let classId: number
  let roomId: number
  let registrationId: number
  const now = Date.now()

  // note: tạo buổi học 90 phút của lớp chính
  const newSession = (startsAt: number, status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED') =>
    createSession({ classId, roomId, startsAt, endsAt: startsAt + 90 * 60 * 1000, status })
  const put = (sessionId: number, body: object, auth = manager.auth) =>
    request(app).put(`/api/session-coaches/${sessionId}/substitute`).set('Authorization', auth).send(body)

  beforeAll(async () => {
    await resetDatabase()
    const sport = await createSport()
    const otherSport = await createSport()
    manager = await createManager()
    mainCoach = await createCoach()
    subCoach = await createCoach()
    unqualifiedCoach = await createCoach()
    await prisma.coachSport.createMany({
      data: [
        { coachId: mainCoach.id, sportId: sport.id },
        { coachId: subCoach.id, sportId: sport.id },
        { coachId: unqualifiedCoach.id, sportId: otherSport.id },
      ],
    })
    const room = await createRoom()
    roomId = room.id
    classId = (await createGroupClass({ sportId: sport.id, coachId: mainCoach.id })).id
    const member = await createMember()
    registrationId = (await createRegistration({ memberId: member.id, classId })).id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('chỉ Center Manager được dùng API dạy thay', async () => {
    const session = await newSession(now + 2 * DAY)
    expect((await put(session.id, { coachId: subCoach.id, reason: 'Nghỉ phép' }, mainCoach.auth)).status).toBe(403)
    expect((await request(app).get('/api/session-coaches?from=2026-11-01&to=2026-11-30')).status).toBe(401)
  })

  it('giao dạy thay: buổi ghi đúng người dạy thực tế, báo cho 2 coach, ghi audit', async () => {
    const session = await newSession(now + 3 * DAY)
    const response = await put(session.id, { coachId: subCoach.id, reason: 'Coach chính nghỉ phép' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      actualCoach: { id: subCoach.id },
      replacedCoach: { id: mainCoach.id },
      classCoach: { id: mainCoach.id },
      coachAbsent: false,
      reason: 'Coach chính nghỉ phép',
    })
    const row = await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(row).toMatchObject({ coachId: subCoach.id, replacedCoachId: mainCoach.id, coachChangedById: manager.id })
    expect(await prisma.notification.count({ where: { userId: subCoach.id, title: 'Bạn được phân công dạy thay' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: mainCoach.id, title: 'Buổi học được giao người dạy thay' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'SESSION_COACH_SUBSTITUTED', entityId: String(session.id) } })).toBe(1)

    // note: lịch xung đột: coach dạy thay bận giờ đó, coach chính được rảnh
    expect(await sessionService.checkCoachConflict(subCoach.id, row.startsAt, row.endsAt)).toBe(true)
    expect(await sessionService.checkCoachConflict(mainCoach.id, row.startsAt, row.endsAt)).toBe(false)
  })

  it('người dạy thay điểm danh được, coach chính bị chặn; lịch "buổi của tôi" đổi theo', async () => {
    const ongoing = await newSession(now - HOUR)
    expect((await put(ongoing.id, { coachId: subCoach.id, reason: 'Dạy thay đột xuất', coachAbsent: true })).status).toBe(200)

    const mark = (auth: string) =>
      request(app).put(`/api/class-sessions/${ongoing.id}/attendance`).set('Authorization', auth)
        .send({ records: [{ classRegistrationId: registrationId, status: 'PRESENT' }] })
    expect((await mark(mainCoach.auth)).status).toBe(403)
    const marked = await mark(subCoach.auth)
    expect(marked.status).toBe(200)
    expect(marked.body.records[0].markedById).toBe(subCoach.id)

    const range = `from=${new Date(now - DAY).toISOString()}&to=${new Date(now + DAY).toISOString()}`
    const subSessions = await request(app).get(`/api/coaches/me/sessions?${range}`).set('Authorization', subCoach.auth)
    const mainSessions = await request(app).get(`/api/coaches/me/sessions?${range}`).set('Authorization', mainCoach.auth)
    expect(subSessions.body.find((item: { id: number }) => item.id === ongoing.id)).toMatchObject({ isSubstitute: true })
    expect(mainSessions.body.some((item: { id: number }) => item.id === ongoing.id)).toBe(false)

    // note: đã điểm danh thì khóa, không đổi người dạy được nữa
    const locked = await request(app).delete(`/api/session-coaches/${ongoing.id}/substitute`).set('Authorization', manager.auth)
    expect(locked.status).toBe(409)
    expect(locked.body.code).toBe('SESSION_COACH_LOCKED')
  })

  it('từ chối người dạy thay sai môn, trùng lịch, hoặc chính là coach chính', async () => {
    const session = await newSession(now + 5 * DAY)
    expect((await put(session.id, { coachId: unqualifiedCoach.id, reason: 'Thử sai môn' })).body.code).toBe('COACH_NOT_QUALIFIED')
    expect((await put(session.id, { coachId: mainCoach.id, reason: 'Trùng coach chính' })).body.code).toBe('SAME_AS_MAIN_COACH')

    // note: coach dạy thay đã có buổi lớp khác cùng giờ
    const otherClass = await createGroupClass({ sportId: (await prisma.groupClass.findUniqueOrThrow({ where: { id: classId } })).sportId, coachId: subCoach.id })
    await createSession({ classId: otherClass.id, roomId: (await createRoom()).id, startsAt: session.startsAt.getTime(), endsAt: session.endsAt.getTime() })
    const conflict = await put(session.id, { coachId: subCoach.id, reason: 'Trùng lịch' })
    expect(conflict.status).toBe(409)
    expect(conflict.body.code).toBe('COACH_SCHEDULE_CONFLICT')

    const candidates = await request(app).get(`/api/session-coaches/${session.id}/candidates`).set('Authorization', manager.auth)
    expect(candidates.status).toBe(200)
    expect(candidates.body.items).toEqual([expect.objectContaining({ id: subCoach.id, available: false })])
  })

  it('validate đầu vào: thiếu lý do 400, buổi không tồn tại 404, buổi đã hủy 409', async () => {
    const session = await newSession(now + 6 * DAY)
    expect((await put(session.id, { coachId: subCoach.id })).status).toBe(400)
    expect((await put(999999, { coachId: subCoach.id, reason: 'Không có buổi' })).status).toBe(404)
    const cancelled = await newSession(now + 7 * DAY, 'CANCELLED')
    expect((await put(cancelled.id, { coachId: subCoach.id, reason: 'Buổi đã hủy' })).body.code).toBe('SESSION_COACH_LOCKED')
  })

  it('Coach báo nghỉ, Manager duyệt thì hủy buổi và chờ xếp bù', async () => {
    const session = await newSession(now + 8 * DAY)
    const invalid = await request(app).post('/api/coach-absences/me').set('Authorization', subCoach.auth).send({ sessionId: session.id, reason: 'Ốm đột xuất' })
    expect(invalid.status).toBe(403)
    const absent = await request(app).post('/api/coach-absences/me').set('Authorization', mainCoach.auth).send({ sessionId: session.id, reason: 'Ốm đột xuất' })
    expect(absent.status).toBe(201)
    expect(absent.body.status).toBe('PENDING')
    const reviewed = await request(app).post(`/api/coach-absences/${absent.body.id}/review`).set('Authorization', manager.auth).send({ approve: true })
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.status).toBe('APPROVED')
    expect((await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('CANCELLED')
    expect((await request(app).post(`/api/coach-absences/${absent.body.id}/review`).set('Authorization', manager.auth).send({ approve: true })).status).toBe(409)
    expect((await request(app).post(`/api/session-coaches/${session.id}/absence`).set('Authorization', manager.auth).send({ reason: 'legacy' })).status).toBe(404)
    const makeupStart = new Date(session.startsAt)
    makeupStart.setUTCDate(makeupStart.getUTCDate() + 3)
    makeupStart.setUTCHours(2, 0, 0, 0)
    const makeupEnd = new Date(makeupStart.getTime() + 90 * 60 * 1000)
    await prisma.coachAvailability.create({ data: {
      coachId: mainCoach.id, dayOfWeek: makeupStart.getUTCDay(),
      startTime: new Date('1970-01-01T09:00:00.000Z'), endTime: new Date('1970-01-01T10:30:00.000Z'),
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    } })
    const body = { coachId: mainCoach.id, roomId, startsAt: makeupStart.toISOString(), endsAt: makeupEnd.toISOString() }
    const makeup = await request(app).post(`/api/coach-absences/${absent.body.id}/makeup`).set('Authorization', manager.auth).send(body)
    expect(makeup.status).toBe(201)
    expect(makeup.body.makeupSessionId).toBeTypeOf('number')
    expect((await request(app).post(`/api/coach-absences/${absent.body.id}/makeup`).set('Authorization', manager.auth).send(body)).status).toBe(409)
  })

  it('danh sách theo khoảng ngày, lọc chỉ buổi có thay đổi; khoảng ngày quá 31 ngày bị chặn', async () => {
    const day = (offset: number) => new Date(now + offset * DAY + 7 * HOUR).toISOString().slice(0, 10)
    const list = await request(app).get(`/api/session-coaches?from=${day(-2)}&to=${day(10)}&changedOnly=true`).set('Authorization', manager.auth)
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(0)
    expect(list.body.items.every((item: { replacedCoach: unknown; coachAbsent: boolean }) => item.replacedCoach || item.coachAbsent)).toBe(true)

    const tooLong = await request(app).get(`/api/session-coaches?from=${day(0)}&to=${day(40)}`).set('Authorization', manager.auth)
    expect(tooLong.body.code).toBe('DATE_RANGE_TOO_LARGE')
  })

  it('đổi coach của lớp: buổi đã diễn ra được chốt coach cũ, buổi sau đi theo coach mới', async () => {
    // note: lớp riêng chỉ có 1 buổi đã xong để assignCoach không vướng kiểm tra lịch của các buổi khác
    const sportId = (await prisma.groupClass.findUniqueOrThrow({ where: { id: classId } })).sportId
    const otherClass = await createGroupClass({ sportId, coachId: mainCoach.id })
    const past = await createSession({ classId: otherClass.id, roomId, startsAt: now - 2 * DAY, endsAt: now - 2 * DAY + HOUR, status: 'COMPLETED' })
    await groupClassService.assignCoach(otherClass.id, subCoach.id, manager.id)
    expect((await prisma.classSession.findUniqueOrThrow({ where: { id: past.id } })).coachId).toBe(mainCoach.id)
  })
})
