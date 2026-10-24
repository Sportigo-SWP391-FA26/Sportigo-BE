import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  DAY,
  createClassScenario,
  createReceptionist,
  resetDatabase,
} from './fixtures.js'

type HistoryItem = {
  id: number
  status: string
  session: { id: number; startsAt: string }
  class: { id: number }
  member: { id: number }
}

describe.skipIf(!hasTestDatabase)('FR-48 Lịch sử điểm danh', () => {
  let s: Awaited<ReturnType<typeof createClassScenario>>

  beforeAll(async () => {
    await resetDatabase()
    s = await createClassScenario()
    const [first, second] = s.registrations
    await prisma.sessionAttendance.createMany({
      data: [
        {
          registrationId: first!.id,
          classSessionId: s.sessions.ongoing.id,
          status: 'PRESENT',
        },
        {
          registrationId: second!.id,
          classSessionId: s.sessions.ongoing.id,
          status: 'ABSENT',
        },
        {
          registrationId: first!.id,
          classSessionId: s.sessions.expired.id,
          status: 'LATE',
        },
        {
          registrationId: s.outsiderRegistration.id,
          classSessionId: s.sessions.otherClass.id,
          status: 'PRESENT',
        },
      ],
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const list = (auth: string, query: Record<string, string | number> = {}) =>
    request(app).get('/api/attendance').query(query).set('Authorization', auth)

  it('FR-48: Member chỉ thấy lịch sử của chính mình, sắp theo thời gian giảm dần', async () => {
    const member = s.members[0]!
    const response = await list(member.auth)

    expect(response.status).toBe(200)
    const items: HistoryItem[] = response.body.items
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.member.id === member.id)).toBe(true)
    expect(items.map((item) => item.session.id)).toEqual([
      s.sessions.ongoing.id,
      s.sessions.expired.id,
    ])
  })

  it('FR-48: Member gửi memberId của người khác vẫn chỉ nhận dữ liệu của mình', async () => {
    const member = s.members[0]!
    const response = await list(member.auth, { memberId: s.outsider.id })

    expect(response.status).toBe(200)
    const items: HistoryItem[] = response.body.items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.member.id === member.id)).toBe(true)
  })

  it('FR-48: Coach chỉ thấy các lớp mình phụ trách', async () => {
    const asCoach = await list(s.coach.auth)
    const asOtherCoach = await list(s.otherCoach.auth)

    expect(asCoach.body.total).toBe(3)
    expect(
      asCoach.body.items.every(
        (item: HistoryItem) => item.class.id === s.groupClass.id,
      ),
    ).toBe(true)
    expect(asOtherCoach.body.total).toBe(1)
    expect(asOtherCoach.body.items[0].class.id).toBe(s.otherClass.id)
  })

  it('FR-48: Coach lọc theo lớp không phụ trách nhận danh sách rỗng', async () => {
    const response = await list(s.coach.auth, { classId: s.otherClass.id })

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(0)
  })

  it('FR-48: Manager lọc theo lớp, Member, buổi học và trạng thái', async () => {
    const byClass = await list(s.manager.auth, { classId: s.groupClass.id })
    const byMember = await list(s.manager.auth, { memberId: s.members[0]!.id })
    const bySession = await list(s.manager.auth, {
      sessionId: s.sessions.ongoing.id,
    })
    const byStatus = await list(s.manager.auth, { status: 'ABSENT' })

    expect(byClass.body.total).toBe(3)
    expect(byMember.body.total).toBe(2)
    expect(bySession.body.total).toBe(2)
    expect(byStatus.body.total).toBe(1)
    expect(byStatus.body.items[0].member.id).toBe(s.members[1]!.id)
  })

  it('FR-48: Manager lọc theo khoảng thời gian buổi học', async () => {
    const response = await list(s.manager.auth, {
      from: new Date(Date.now() - 2 * DAY).toISOString(),
    })

    expect(response.status).toBe(200)
    expect(
      response.body.items.some(
        (item: HistoryItem) => item.session.id === s.sessions.expired.id,
      ),
    ).toBe(false)
    expect(response.body.total).toBe(3)
  })

  it('FR-48 / NFR-10: phân trang và giới hạn pageSize tối đa 100', async () => {
    const firstPage = await list(s.manager.auth, { page: 1, pageSize: 1 })
    const tooLarge = await list(s.manager.auth, { pageSize: 101 })

    expect(firstPage.body.items).toHaveLength(1)
    expect(firstPage.body.total).toBe(4)
    expect(firstPage.body.pageSize).toBe(1)
    expect(tooLarge.status).toBe(400)
  })

  it('FR-48: from sau to trả 422', async () => {
    const response = await list(s.manager.auth, {
      from: '2026-10-10T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    })

    expect(response.status).toBe(400)
  })

  it('FR-48 / BR-06: Receptionist không được xem lịch sử điểm danh', async () => {
    const receptionist = await createReceptionist()
    const response = await list(receptionist.auth)

    expect(response.status).toBe(403)
  })
})
