import express from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// note: giả lập đúng các bảng FR-65 đọc; mặc định trả rỗng, từng test tự đặt dữ liệu
const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findMany: vi.fn() },
    classSession: { findMany: vi.fn() },
    privateCourseAttendance: { groupBy: vi.fn() },
    progressAssessment: { groupBy: vi.fn() },
    classRegistration: { findMany: vi.fn() },
    privateCourseEnrollment: { findMany: vi.fn() },
    supportRequest: { findMany: vi.fn() },
    requestAssignment: { groupBy: vi.fn() },
    payment: { groupBy: vi.fn() },
    auditLog: { groupBy: vi.fn() },
  },
}))
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { toDateColumnRange, toInstantRange } from '../../src/modules/users/staff-performance.schema.js'
import { staffRouter } from '../../src/modules/users/staff.routes.js'

const app = express()
app.use(express.json())
app.use('/staff', staffRouter)
app.use(errorHandler)

const COACH = 7
const RECEPTIONIST = 3
const auth = (role = 'CENTER_MANAGER') => `Bearer ${createAccessToken({ userId: 1, role })}`
const get = (query = '?from=2026-10-01&to=2026-10-31', role?: string) => request(app).get(`/staff/performance${query}`).set('Authorization', auth(role))

const staffRows = [
  { id: COACH, displayName: 'Coach Lan', email: 'lan@sportigo.vn', avatarUrl: null, status: 'ACTIVE', role: { name: 'COACH' }, coach: { coachCode: 'COA-000007', status: 'ACTIVE' }, receptionist: null },
  { id: 8, displayName: 'Coach Mới', email: 'moi@sportigo.vn', avatarUrl: null, status: 'INACTIVE', role: { name: 'COACH' }, coach: { coachCode: 'COA-000008', status: 'ACTIVE' }, receptionist: null },
  { id: RECEPTIONIST, displayName: 'Lễ tân Mai', email: 'mai@sportigo.vn', avatarUrl: null, status: 'ACTIVE', role: { name: 'RECEPTIONIST' }, coach: null, receptionist: { staffCode: 'REC-000003' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  prisma.user.findMany.mockResolvedValue(staffRows)
  for (const fn of [
    prisma.classSession.findMany, prisma.classRegistration.findMany, prisma.privateCourseEnrollment.findMany, prisma.supportRequest.findMany,
    prisma.privateCourseAttendance.groupBy, prisma.progressAssessment.groupBy, prisma.requestAssignment.groupBy, prisma.payment.groupBy, prisma.auditLog.groupBy,
  ]) fn.mockResolvedValue([])
})

afterEach(() => vi.useRealTimers())

describe('FR-65 Hiệu suất nhân sự', () => {
  it('chỉ Center Manager xem được', async () => {
    for (const role of ['RECEPTIONIST', 'COACH', 'MEMBER']) expect((await get(undefined, role)).status).toBe(403)
    expect((await request(app).get('/staff/performance')).status).toBe(401)
  })

  it('tham số sai thì 400: ngày không tồn tại, from sau to, quá 366 ngày, trường lạ', async () => {
    expect((await get('?from=2026-02-30&to=2026-03-01')).status).toBe(400)
    expect((await get('?from=2026-10-31&to=2026-10-01')).status).toBe(400)
    expect((await get('?from=2025-01-01&to=2026-10-31')).status).toBe(400)
    expect((await get('?from=2026-10-01&to=2026-10-31&role=COACH')).status).toBe(400)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('bỏ trống from/to thì lấy từ đầu tháng tới hôm nay theo giờ Việt Nam', async () => {
    // note: 2026-11-05 20:00 UTC = 2026-11-06 03:00 giờ Việt Nam → đã sang ngày 06
    vi.useFakeTimers({ now: new Date('2026-11-05T20:00:00Z'), toFake: ['Date'] })
    const response = await get('')
    expect(response.body).toMatchObject({ from: '2026-11-01', to: '2026-11-06' })
  })

  it('đổi ngày sang mốc giờ thật theo UTC+7', () => {
    const { start, endExclusive } = toInstantRange({ from: '2026-10-01', to: '2026-10-31' })
    expect(start.toISOString()).toBe('2026-09-30T17:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2026-10-31T17:00:00.000Z')
    expect(toDateColumnRange({ from: '2026-10-01', to: '2026-10-31' }).lte.toISOString()).toBe('2026-10-31T00:00:00.000Z')
  })

  it('Coach: đếm buổi đã diễn ra, buổi đã điểm danh, tỷ lệ có mặt, buổi 1-1, đánh giá, học viên không trùng', async () => {
    prisma.classSession.findMany.mockResolvedValue([
      { groupClass: { coachId: COACH }, attendances: [{ status: 'PRESENT' }, { status: 'LATE' }, { status: 'ABSENT' }, { status: 'PRESENT' }] },
      { groupClass: { coachId: COACH }, attendances: [] },
    ])
    prisma.privateCourseAttendance.groupBy.mockResolvedValue([{ markedById: COACH, _count: { _all: 5 } }])
    prisma.progressAssessment.groupBy.mockResolvedValue([{ coachId: COACH, _count: { _all: 2 } }])
    // note: member 20 học cả lớp nhóm lẫn 1-1 của Coach → chỉ tính 1 học viên
    prisma.classRegistration.findMany.mockResolvedValue([{ memberId: 20, groupClass: { coachId: COACH } }, { memberId: 21, groupClass: { coachId: COACH } }])
    prisma.privateCourseEnrollment.findMany.mockResolvedValue([{ memberId: 20, coachId: COACH }])

    const response = await get()

    expect(response.status).toBe(200)
    expect(response.body.coaches[0]).toMatchObject({
      id: COACH,
      staffCode: 'COA-000007',
      groupSessionsHeld: 2,
      groupSessionsMarked: 1,
      privateSessions: 5,
      attendanceRate: 0.75,
      assessments: 2,
      activeTrainees: 2,
    })
    // note: Coach chưa có số liệu → 0, tỷ lệ null (FE hiện "—" thay vì 0%)
    expect(response.body.coaches[1]).toMatchObject({ id: 8, groupSessionsHeld: 0, attendanceRate: null, activeTrainees: 0 })
    expect(response.body.totals).toMatchObject({ groupSessionsHeld: 2, privateSessions: 5 })
  })

  it('buổi lớp: bỏ buổi bị hủy, chỉ lấy buổi đã kết thúc trước hiện tại', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T05:00:00Z'), toFake: ['Date'] })
    await get()
    const where = prisma.classSession.findMany.mock.calls[0][0].where
    expect(where.status).toEqual({ not: 'CANCELLED' })
    expect(where.endsAt.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z')
    // note: khoảng xem tới 31/10 nhưng hôm nay mới 15/10 → buổi chưa diễn ra không bị tính
    expect(where.endsAt.lt.toISOString()).toBe('2026-10-15T05:00:00.000Z')
    expect(where.groupClass).toEqual({ coachId: { in: [COACH, 8] } })
  })

  it('Lễ tân: yêu cầu đã giải quyết + giờ trung bình, yêu cầu đang giữ, tiền thu tại quầy, hội viên tạo tại quầy', async () => {
    prisma.supportRequest.findMany.mockResolvedValue([
      { createdAt: new Date('2026-10-02T01:00:00Z'), resolvedAt: new Date('2026-10-02T03:00:00Z'), assignments: [{ assignedToId: RECEPTIONIST }] },
      { createdAt: new Date('2026-10-05T00:00:00Z'), resolvedAt: new Date('2026-10-05T05:00:00Z'), assignments: [{ assignedToId: RECEPTIONIST }] },
      // note: người phụ trách cuối là lễ tân khác (không nằm trong danh sách) → không tính cho Mai
      { createdAt: new Date('2026-10-06T00:00:00Z'), resolvedAt: new Date('2026-10-06T01:00:00Z'), assignments: [{ assignedToId: 99 }] },
    ])
    prisma.requestAssignment.groupBy.mockResolvedValue([{ assignedToId: RECEPTIONIST, _count: { _all: 1 } }])
    prisma.payment.groupBy.mockResolvedValue([{ collectedById: RECEPTIONIST, _sum: { amount: new Prisma.Decimal('1500000.00') }, _count: { _all: 3 } }])
    prisma.auditLog.groupBy.mockResolvedValue([{ actorId: RECEPTIONIST, _count: { _all: 4 } }])

    const response = await get()

    expect(response.body.receptionists[0]).toMatchObject({
      id: RECEPTIONIST,
      staffCode: 'REC-000003',
      supportResolved: 2,
      supportInProgress: 1,
      avgResolutionHours: 3.5,
      cashCollected: 1500000,
      cashPayments: 3,
      membersCreated: 4,
    })
    expect(response.body.totals).toMatchObject({ supportResolved: 2, cashCollected: 1500000, membersCreated: 4 })
    // note: tiền đã thu gồm cả khoản sau đó bị hoàn, không tính khoản chờ/thất bại
    expect(prisma.payment.groupBy.mock.calls[0][0].where.status).toEqual({ in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] })
    expect(prisma.auditLog.groupBy.mock.calls[0][0].where.action).toBe('MEMBER_CREATED')
  })

  it('bỏ tài khoản đã xóa mềm; không có nhân sự thì không truy vấn thêm', async () => {
    prisma.user.findMany.mockResolvedValue([])
    const response = await get()
    expect(response.body).toMatchObject({ coaches: [], receptionists: [], totals: { groupSessionsHeld: 0, cashCollected: 0 } })
    expect(prisma.user.findMany.mock.calls[0][0].where.deletedAt).toBeNull()
    expect(prisma.classSession.findMany).not.toHaveBeenCalled()
    expect(prisma.payment.groupBy).not.toHaveBeenCalled()
  })
})
