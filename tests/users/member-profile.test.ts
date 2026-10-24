import express from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: { findFirst: vi.fn() },
    classRegistration: { count: vi.fn() },
    privateCourseEnrollment: { count: vi.fn() },
    serviceOrder: { findMany: vi.fn() },
  }
  return { prisma }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { membersRouter } from '../../src/modules/users/members.routes.js'

const app = express()
app.use(express.json())
app.use('/members', membersRouter)
app.use((_request, response) => {
  response.status(404).json({ code: 'FALLTHROUGH' })
})
app.use(errorHandler)

const COACH = 7
const auth = (role: string, userId = 1) => `Bearer ${createAccessToken({ userId, role })}`
const coachUser = { id: COACH, displayName: 'Coach Lan' }

const profileRow = {
  id: 20,
  email: 'binh@gmail.com',
  phone: '0912345678',
  displayName: 'Trần Bình',
  status: 'ACTIVE',
  emailVerifiedAt: new Date('2026-10-01'),
  member: {
    memberCode: 'MEM-1A2B3C4D',
    dateOfBirth: new Date('2000-05-20T00:00:00Z'),
    gender: 'MALE',
    emergencyContact: 'Mẹ 0909',
    joinedAt: new Date('2026-10-01'),
    registrations: [
      {
        id: 1,
        status: 'CONFIRMED',
        registeredAt: new Date('2026-10-02'),
        groupClass: {
          id: 3,
          name: 'Yoga sáng',
          startDate: new Date('2026-10-05T00:00:00Z'),
          endDate: new Date('2026-12-05T00:00:00Z'),
          status: 'IN_PROGRESS',
          sport: { name: 'Yoga' },
          coach: { user: coachUser },
        },
        attendances: [{ status: 'PRESENT' }, { status: 'PRESENT' }, { status: 'LATE' }, { status: 'ABSENT' }],
      },
    ],
    privateEnrollments: [
      {
        id: 9,
        status: 'ACTIVE',
        purchasedSessions: 10,
        remainingSessions: 6,
        startDate: new Date('2026-10-01T00:00:00Z'),
        expiryDate: new Date('2026-12-31T00:00:00Z'),
        privateCourse: { id: 2, name: 'Bơi 1-1', sport: { name: 'Bơi' } },
        coach: { user: coachUser },
      },
    ],
    assessments: [
      {
        id: 4,
        assessmentDate: new Date('2026-10-20T00:00:00Z'),
        score: new Prisma.Decimal('8.5'),
        coachComment: 'Tiến bộ tốt',
        recommendation: null,
        nextAssessmentDate: null,
        coach: { user: coachUser },
      },
    ],
  },
}

describe('FR-10 Hồ sơ tổng hợp Member', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findFirst.mockResolvedValue(profileRow)
    prisma.serviceOrder.findMany.mockResolvedValue([
      { id: 1, orderNumber: 'ORD-1', status: 'PAID', finalAmount: new Prisma.Decimal('500000'), paidAt: new Date(), createdAt: new Date() },
    ])
  })

  it('Member không xem được hồ sơ người khác qua API này', async () => {
    expect((await request(app).get('/members/20').set('Authorization', auth('MEMBER', 20))).status).toBe(403)
  })

  it('Receptionist xem đầy đủ: liên hệ, điểm danh, buổi còn lại, thanh toán', async () => {
    const response = await request(app).get('/members/20').set('Authorization', auth('RECEPTIONIST', 3))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      memberCode: 'MEM-1A2B3C4D',
      email: 'binh@gmail.com',
      phone: '0912345678',
      dateOfBirth: '2000-05-20',
      scope: 'STAFF',
    })
    expect(response.body.classRegistrations[0].attendance).toEqual({ present: 2, late: 1, absent: 1, excused: 0, total: 4 })
    expect(response.body.privateEnrollments[0]).toMatchObject({ remainingSessions: 6, usedSessions: 4, expiryDate: '2026-12-31' })
    expect(response.body.assessments[0].score).toBe(8.5)
    expect(response.body.payments[0]).toMatchObject({ orderNumber: 'ORD-1', finalAmount: 500000 })
    // note: nhân viên thấy mọi lớp/khóa, không lọc theo Coach
    expect(prisma.user.findFirst.mock.calls[0][0].select.member.select.registrations.where).toEqual({})
  })

  it('Coach không được phân công thì 404, không truy vấn hồ sơ', async () => {
    prisma.classRegistration.count.mockResolvedValue(0)
    prisma.privateCourseEnrollment.count.mockResolvedValue(0)

    const response = await request(app).get('/members/20').set('Authorization', auth('COACH', COACH))

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('MEMBER_NOT_FOUND')
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.classRegistration.count).toHaveBeenCalledWith({
      where: { memberId: 20, status: 'CONFIRMED', groupClass: { coachId: COACH } },
    })
  })

  it('Coach được phân công: chỉ lấy lớp/khóa/đánh giá của mình, ẩn email/SĐT/thanh toán', async () => {
    prisma.classRegistration.count.mockResolvedValue(0)
    prisma.privateCourseEnrollment.count.mockResolvedValue(1)

    const response = await request(app).get('/members/20').set('Authorization', auth('COACH', COACH))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ email: null, phone: null, payments: null, scope: 'COACH' })
    expect(prisma.serviceOrder.findMany).not.toHaveBeenCalled()
    const select = prisma.user.findFirst.mock.calls[0][0].select.member.select
    expect(select.registrations.where).toEqual({ groupClass: { coachId: COACH } })
    expect(select.privateEnrollments.where).toEqual({ coachId: COACH })
    expect(select.assessments.where).toEqual({ coachId: COACH })
  })

  it('id không phải Member thì 404; id không phải số thì nhường route khác', async () => {
    prisma.user.findFirst.mockResolvedValue(null)
    expect((await request(app).get('/members/99').set('Authorization', auth('CENTER_MANAGER'))).status).toBe(404)

    const other = await request(app).get('/members/abc').set('Authorization', auth('CENTER_MANAGER'))
    expect(other.body.code).toBe('FALLTHROUGH')
  })
})
