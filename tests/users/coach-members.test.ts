import express from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: { findMany: vi.fn(), count: vi.fn() },
  }
  return { prisma }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { coachMembersRouter } from '../../src/modules/users/coach-members.routes.js'

const app = express()
app.use(express.json())
app.use('/coaches/me/members', coachMembersRouter)
app.use(errorHandler)

const COACH = 7
const auth = (role = 'COACH', userId = COACH) => `Bearer ${createAccessToken({ userId, role })}`

const row = {
  id: 20,
  displayName: 'Trần Bình',
  member: {
    memberCode: 'MEM-1A2B3C4D',
    gender: 'MALE',
    dateOfBirth: new Date('2000-05-20T00:00:00Z'),
    registrations: [{ groupClass: { id: 3, name: 'Yoga sáng', status: 'IN_PROGRESS', sport: { name: 'Yoga' } } }],
    privateEnrollments: [
      {
        id: 9,
        status: 'ACTIVE',
        remainingSessions: 6,
        expiryDate: new Date('2026-12-31T00:00:00Z'),
        privateCourse: { name: 'Bơi 1-1', sport: { name: 'Bơi' } },
        plans: [{ workoutPlan: { id: 5, name: 'Bơi sải cơ bản', level: 'BEGINNER' } }],
      },
    ],
    assessments: [
      { assessmentDate: new Date('2026-10-20T00:00:00Z'), score: new Prisma.Decimal('7.5'), recommendation: 'Tăng sức bền', nextAssessmentDate: new Date('2026-11-20T00:00:00Z') },
    ],
  },
}

const get = (query = '', token = auth()) => request(app).get(`/coaches/me/members${query}`).set('Authorization', token)

describe('FR-11 Coach xem học viên của mình', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findMany.mockResolvedValue([row])
    prisma.user.count.mockResolvedValue(1)
  })

  it('chỉ Coach gọi được', async () => {
    expect((await get('', auth('RECEPTIONIST', 3))).status).toBe(403)
    expect((await get('', auth('MEMBER', 20))).status).toBe(403)
  })

  it('chỉ lấy Member có lớp CONFIRMED hoặc khóa 1-1 với chính Coach này', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    const args = prisma.user.findMany.mock.calls[0][0]
    expect(args.where.role).toEqual({ name: 'MEMBER' })
    expect(args.where.member).toEqual({
      OR: [
        { registrations: { some: { status: 'CONFIRMED', groupClass: { coachId: COACH } } } },
        { privateEnrollments: { some: { coachId: COACH, status: { in: ['ACTIVE', 'COMPLETED'] } } } },
      ],
    })
    // note: dữ liệu lồng bên trong cũng lọc theo Coach
    expect(args.select.member.select.assessments.where).toEqual({ coachId: COACH })
    expect(args.select.member.select.privateEnrollments.where).toEqual({ coachId: COACH, status: { in: ['ACTIVE', 'COMPLETED'] } })
  })

  it('trả lớp, khóa 1-1, giáo án và đánh giá gần nhất làm mục tiêu', async () => {
    const response = await get()
    expect(response.body.items[0]).toMatchObject({
      memberCode: 'MEM-1A2B3C4D',
      dateOfBirth: '2000-05-20',
      classes: [{ id: 3, name: 'Yoga sáng', sport: 'Yoga' }],
      privateCourses: [{ enrollmentId: 9, remainingSessions: 6, expiryDate: '2026-12-31' }],
      goals: {
        workoutPlans: [{ id: 5, name: 'Bơi sải cơ bản' }],
        latestAssessment: { score: 7.5, recommendation: 'Tăng sức bền', nextAssessmentDate: '2026-11-20' },
      },
    })
  })

  it('lọc theo loại và từ khóa', async () => {
    await get('?type=PRIVATE&q=mem-1a')
    const where = prisma.user.findMany.mock.calls[0][0].where
    expect(where.member).toEqual({ privateEnrollments: { some: { coachId: COACH, status: { in: ['ACTIVE', 'COMPLETED'] } } } })
    expect(where.OR).toContainEqual({ member: { memberCode: { contains: 'mem-1a', mode: 'insensitive' } } })

    expect((await get('?type=ALL')).status).toBe(400)
  })
})
