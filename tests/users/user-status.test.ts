import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => {
  const prisma = {
    // note: hỗ trợ cả 2 kiểu $transaction (mảng query và callback nhận tx)
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { createMany: vi.fn(async () => ({ count: 1 })) },
  }
  return { prisma }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { usersRouter } from '../../src/modules/users/users.routes.js'

const app = express()
app.use(express.json())
app.use('/users', usersRouter)
app.use(errorHandler)

const auth = (role: string, userId = 1) => `Bearer ${createAccessToken({ userId, role })}`

const member = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  email: 'mem@sportigo.vn',
  phone: null,
  displayName: 'Trần Bình',
  status: 'ACTIVE',
  emailVerifiedAt: new Date('2026-10-01'),
  createdAt: new Date('2026-10-01'),
  role: { name: 'MEMBER' },
  member: { memberCode: 'MEM-005' },
  coach: null,
  ...overrides,
})

const lock = (id = 5, role = 'CENTER_MANAGER') =>
  request(app).patch(`/users/${id}/status`).set('Authorization', auth(role)).send({ status: 'LOCKED', reason: 'Vi phạm nội quy' })

describe('FR-06 Khóa/mở khóa tài khoản', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.updateMany.mockResolvedValue({ count: 1 })
  })

  it('chỉ Center Manager được gọi', async () => {
    expect((await lock(5, 'RECEPTIONIST')).status).toBe(403)
    expect((await lock(5, 'MEMBER')).status).toBe(403)
  })

  it('khóa Member: đổi status, thu hồi refresh token, ghi audit và gửi thông báo', async () => {
    prisma.user.findUnique.mockResolvedValue(member())
    prisma.user.findUniqueOrThrow.mockResolvedValue(member({ status: 'LOCKED' }))

    const response = await lock()

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('LOCKED')
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 5, status: 'ACTIVE' }, data: { status: 'LOCKED' } })
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 5, revokedAt: null } }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        action: 'USER_LOCKED',
        entityType: 'User',
        entityId: '5',
        oldData: { status: 'ACTIVE' },
        newData: { status: 'LOCKED', reason: 'Vi phạm nội quy' },
      }),
    })
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 5, type: 'ACCOUNT_STATUS' })],
    })
  })

  it('mở khóa: về ACTIVE, không thu hồi token, audit USER_UNLOCKED', async () => {
    prisma.user.findUnique.mockResolvedValue(member({ status: 'LOCKED' }))
    prisma.user.findUniqueOrThrow.mockResolvedValue(member())

    const response = await request(app)
      .patch('/users/5/status')
      .set('Authorization', auth('CENTER_MANAGER'))
      .send({ status: 'ACTIVE', reason: 'Đã xác minh lại' })

    expect(response.status).toBe(200)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 5, status: 'LOCKED' }, data: { status: 'ACTIVE' } })
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('USER_UNLOCKED')
  })

  it('mở khóa tài khoản chưa xác minh email thì về INACTIVE', async () => {
    prisma.user.findUnique.mockResolvedValue(member({ status: 'LOCKED', emailVerifiedAt: null }))
    prisma.user.findUniqueOrThrow.mockResolvedValue(member({ status: 'INACTIVE', emailVerifiedAt: null }))

    await request(app).patch('/users/5/status').set('Authorization', auth('CENTER_MANAGER')).send({ status: 'ACTIVE', reason: 'Mở lại' })
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 5, status: 'LOCKED' }, data: { status: 'INACTIVE' } })
  })

  it('không tự khóa mình, không khóa Manager khác', async () => {
    const self = await request(app)
      .patch('/users/1/status')
      .set('Authorization', auth('CENTER_MANAGER', 1))
      .send({ status: 'LOCKED', reason: 'Thử tự khóa' })
    expect(self.status).toBe(400)
    expect(self.body.code).toBe('CANNOT_CHANGE_OWN_STATUS')

    prisma.user.findUnique.mockResolvedValue(member({ id: 9, role: { name: 'CENTER_MANAGER' } }))
    expect((await lock(9)).status).toBe(403)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it('khóa tài khoản đã khóa thì 409; không tìm thấy thì 404', async () => {
    prisma.user.findUnique.mockResolvedValue(member({ status: 'LOCKED' }))
    expect((await lock()).body.code).toBe('STATUS_UNCHANGED')

    prisma.user.findUnique.mockResolvedValue(null)
    expect((await lock(77)).status).toBe(404)
  })

  it('Manager khác vừa đổi trạng thái trước (updateMany count 0) thì 409 STATUS_CONFLICT', async () => {
    prisma.user.findUnique.mockResolvedValue(member())
    prisma.user.updateMany.mockResolvedValue({ count: 0 })

    const response = await lock()
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('STATUS_CONFLICT')
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it('thiếu lý do hoặc status lạ thì 400', async () => {
    const response = await request(app).patch('/users/5/status').set('Authorization', auth('CENTER_MANAGER')).send({ status: 'INACTIVE' })
    expect(response.status).toBe(400)
  })
})
