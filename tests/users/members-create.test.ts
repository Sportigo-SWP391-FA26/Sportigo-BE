import express from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma, sendVerificationEmail } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    emailVerificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  }
  return { prisma, sendVerificationEmail: vi.fn() }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))
vi.mock('../../src/modules/auth/email.service.js', () => ({ sendVerificationEmail, sendPasswordResetEmail: vi.fn() }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { membersRouter } from '../../src/modules/users/members.routes.js'

const app = express()
app.use(express.json())
app.use('/members', membersRouter)
app.use(errorHandler)

const auth = (role = 'RECEPTIONIST') => `Bearer ${createAccessToken({ userId: 3, role })}`

const body = { displayName: 'Trần Bình', email: 'Binh@Gmail.com', phone: '0912345678', dateOfBirth: '2000-05-20', gender: 'MALE' }

const createdRow = {
  id: 20,
  email: 'binh@gmail.com',
  phone: '0912345678',
  displayName: 'Trần Bình',
  status: 'INACTIVE',
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-25'),
  role: { name: 'MEMBER' },
  member: { memberCode: 'MEM-1A2B3C4D' },
  coach: null,
  receptionist: null,
}

const post = (payload: object = body, role?: string) => request(app).post('/members').set('Authorization', auth(role)).send(payload)

describe('FR-08 Receptionist tạo Member tại quầy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue(createdRow)
    prisma.user.findUnique.mockResolvedValue({ id: 20, email: 'binh@gmail.com', displayName: 'Trần Bình', emailVerifiedAt: null })
  })

  it('Receptionist và Manager được tạo; Coach, Member bị 403', async () => {
    expect((await post(body, 'COACH')).status).toBe(403)
    expect((await post(body, 'MEMBER')).status).toBe(403)
    expect((await post(body, 'CENTER_MANAGER')).status).toBe(201)
  })

  it('sinh mã MEM-, INACTIVE, mật khẩu ngẫu nhiên, ghi audit và gửi OTP', async () => {
    const response = await post()

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ code: 'MEM-1A2B3C4D', status: 'INACTIVE', role: 'MEMBER', emailSent: true })
    const data = prisma.user.create.mock.calls[0][0].data
    expect(data).toMatchObject({ email: 'binh@gmail.com', status: 'INACTIVE', role: { connect: { name: 'MEMBER' } } })
    expect(data.member.create.memberCode).toMatch(/^MEM-[0-9A-F]{8}$/)
    expect(data.member.create.dateOfBirth).toEqual(new Date('2000-05-20T00:00:00.000Z'))
    expect(data.passwordHash).toMatch(/^\$2[aby]\$12\$/)
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: 3, action: 'MEMBER_CREATED', entityId: '20' })
    expect(sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'binh@gmail.com' }))
  })

  it('thiếu trường bắt buộc hoặc tự gửi memberCode/password thì 400', async () => {
    expect((await post({ displayName: 'Trần Bình', email: 'binh@gmail.com' })).status).toBe(400)
    expect((await post({ ...body, memberCode: 'MEM-HACK' })).status).toBe(400)
    expect((await post({ ...body, password: '12345678' })).status).toBe(400)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('số điện thoại trùng thì 409 field phone', async () => {
    prisma.user.findFirst.mockResolvedValue({ email: 'khac@gmail.com', phone: '0912345678' })
    const response = await post()
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'ACCOUNT_EXISTS', details: { field: 'phone' } })
  })

  it('mã hội viên sinh ra bị trùng thì thử lại với mã khác', async () => {
    const clash = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test', meta: { target: ['memberCode'] } })
    prisma.user.create.mockRejectedValueOnce(clash).mockResolvedValueOnce(createdRow)

    expect((await post()).status).toBe(201)
    const [first, second] = prisma.user.create.mock.calls.map((call) => call[0].data.member.create.memberCode)
    expect(first).not.toBe(second)
  })

  it('gửi email lỗi vẫn tạo tài khoản và trả emailSent=false', async () => {
    sendVerificationEmail.mockRejectedValueOnce(new Error('SMTP down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await post()
    expect(response.status).toBe(201)
    expect(response.body.emailSent).toBe(false)
  })
})
