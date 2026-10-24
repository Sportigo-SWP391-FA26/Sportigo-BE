import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    user: { findMany: vi.fn(), count: vi.fn() },
  },
}))
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { usersRouter } from '../../src/modules/users/users.routes.js'

const app = express()
app.use(express.json())
app.use('/users', usersRouter)
app.use(errorHandler)

const auth = (role: string, userId = 1) => `Bearer ${createAccessToken({ userId, role })}`

const row = {
  id: 5,
  email: 'mem@sportigo.vn',
  phone: '0912345678',
  displayName: 'Trần Bình',
  status: 'ACTIVE',
  emailVerifiedAt: new Date('2026-10-01'),
  createdAt: new Date('2026-10-01'),
  role: { name: 'MEMBER' },
  member: { memberCode: 'MEM-005' },
  coach: null,
}

describe('FR-09 Tìm và lọc người dùng', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findMany.mockResolvedValue([row])
    prisma.user.count.mockResolvedValue(1)
  })

  it('Member và Coach không được gọi (403)', async () => {
    expect((await request(app).get('/users').set('Authorization', auth('MEMBER'))).status).toBe(403)
    expect((await request(app).get('/users').set('Authorization', auth('COACH'))).status).toBe(403)
  })

  it('Manager tìm theo từ khóa + lọc role + status, có phân trang', async () => {
    const response = await request(app)
      .get('/users?q=bình&role=MEMBER&status=ACTIVE&page=2&pageSize=10')
      .set('Authorization', auth('CENTER_MANAGER'))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ page: 2, pageSize: 10, total: 1 })
    expect(response.body.items[0]).toMatchObject({ id: 5, role: 'MEMBER', code: 'MEM-005', emailVerified: true })
    expect(response.body.items[0]).not.toHaveProperty('passwordHash')

    const args = prisma.user.findMany.mock.calls[0][0]
    expect(args.skip).toBe(10)
    expect(args.take).toBe(10)
    expect(args.where).toMatchObject({ role: { name: 'MEMBER' }, status: 'ACTIVE' })
    // note: từ khóa được tìm trên tên, email, phone, mã hội viên, mã Coach và mã lễ tân
    expect(args.where.OR).toHaveLength(6)
  })

  it('Receptionist luôn bị giới hạn ở role MEMBER', async () => {
    await request(app).get('/users').set('Authorization', auth('RECEPTIONIST'))
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ role: { name: 'MEMBER' } })
  })

  it('Receptionist lọc role khác MEMBER thì 403', async () => {
    const response = await request(app).get('/users?role=COACH').set('Authorization', auth('RECEPTIONIST'))
    expect(response.status).toBe(403)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('trang không có kết quả trả mảng rỗng', async () => {
    prisma.user.findMany.mockResolvedValue([])
    prisma.user.count.mockResolvedValue(0)
    const response = await request(app).get('/users?q=khong-ton-tai').set('Authorization', auth('CENTER_MANAGER'))
    expect(response.body).toMatchObject({ items: [], total: 0 })
  })

  it('tham số sai thì 400', async () => {
    const response = await request(app).get('/users?role=ADMIN').set('Authorization', auth('CENTER_MANAGER'))
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })
})
