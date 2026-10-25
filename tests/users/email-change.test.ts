import bcrypt from 'bcryptjs'
import express from 'express'
import request from 'supertest'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// note: prisma giả + hàm gửi mail giả (không gửi email thật trong test)
const { prisma, sendEmail } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: { findUnique: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    emailChangeRequest: { deleteMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return { prisma, sendEmail: vi.fn() }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))
vi.mock('../../src/modules/auth/email.service.js', () => ({ sendEmail, sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { usersRouter } from '../../src/modules/users/users.routes.js'

const app = express()
app.use(express.json())
app.use('/users', usersRouter)
app.use(errorHandler)

const USER_ID = 5
const PASSWORD = 'matkhau123'
const NEW_EMAIL = 'binh.moi@gmail.com'
const auth = () => `Bearer ${createAccessToken({ userId: USER_ID, role: 'MEMBER' })}`
let passwordHash = ''

// note: findUnique dùng cho cả 2 việc: tải hồ sơ theo id và kiểm tra email trùng theo email
function mockUsers({ emailOwner = null as null | { id: number } } = {}) {
  prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: number; email?: string } }) =>
    where.id !== undefined
      ? { id: USER_ID, email: 'binh@gmail.com', passwordHash, displayName: 'Trần Bình', status: 'ACTIVE', role: { name: 'MEMBER' }, member: null, coach: null }
      : emailOwner,
  )
}

const hashOf = (code: string, email = NEW_EMAIL) => createHash('sha256').update(`${USER_ID}:${email}:${code}`).digest('hex')
const pending = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  userId: USER_ID,
  newEmail: NEW_EMAIL,
  tokenHash: hashOf('123456'),
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  usedAt: null,
  ...overrides,
})

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4)
})

beforeEach(() => {
  vi.clearAllMocks()
  mockUsers()
  prisma.emailChangeRequest.create.mockResolvedValue({ id: 3, expiresAt: new Date('2026-10-25T08:10:00Z') })
  prisma.emailChangeRequest.updateMany.mockResolvedValue({ count: 1 })
  prisma.user.findUniqueOrThrow.mockResolvedValue({
    id: USER_ID, email: NEW_EMAIL, phone: null, displayName: 'Trần Bình', status: 'ACTIVE', emailVerifiedAt: new Date(), createdAt: new Date(),
    role: { name: 'MEMBER' }, member: null, coach: null,
  })
})

describe('FR-05 Đổi email - bước 1 gửi OTP', () => {
  const start = (body: object) => request(app).post('/users/me/email-change').set('Authorization', auth()).send(body)

  it('đúng mật khẩu: lưu hash OTP (không lưu mã gốc), gửi mail tới email MỚI, chưa đổi email', async () => {
    const response = await start({ newEmail: 'Binh.Moi@Gmail.com', currentPassword: PASSWORD })

    expect(response.status).toBe(202)
    expect(response.body.newEmail).toBe(NEW_EMAIL)
    const saved = prisma.emailChangeRequest.create.mock.calls[0][0].data
    expect(saved).toMatchObject({ userId: USER_ID, newEmail: NEW_EMAIL })
    // note: lấy OTP từ nội dung mail giả rồi kiểm tra DB chỉ giữ bản băm của nó
    const mail = sendEmail.mock.calls[0][0]
    expect(mail.to).toBe(NEW_EMAIL)
    const code = /(\d{6}) là mã/.exec(mail.subject)?.[1] ?? ''
    expect(saved.tokenHash).toBe(hashOf(code))
    expect(saved.tokenHash).not.toContain(code)
    // note: yêu cầu cũ chưa dùng bị xóa để mỗi lúc chỉ có 1 mã hợp lệ
    expect(prisma.emailChangeRequest.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null } })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('sai mật khẩu, trùng email hiện tại, email sai định dạng thì 400', async () => {
    expect((await start({ newEmail: NEW_EMAIL, currentPassword: 'saimatkhau' })).body.code).toBe('INVALID_CURRENT_PASSWORD')
    expect((await start({ newEmail: 'binh@gmail.com', currentPassword: PASSWORD })).body.code).toBe('SAME_AS_CURRENT_EMAIL')
    expect((await start({ newEmail: 'khong-phai-email', currentPassword: PASSWORD })).status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('email mới đã thuộc tài khoản khác thì 409', async () => {
    mockUsers({ emailOwner: { id: 9 } })
    const response = await start({ newEmail: NEW_EMAIL, currentPassword: PASSWORD })
    expect(response.status).toBe(409)
    expect(response.body.details).toEqual({ field: 'newEmail' })
  })

  it('không gửi được mail thì 502 để người dùng thử lại', async () => {
    sendEmail.mockRejectedValueOnce(new Error('webhook down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await start({ newEmail: NEW_EMAIL, currentPassword: PASSWORD })
    expect(response.status).toBe(502)
    expect(response.body.code).toBe('EMAIL_DELIVERY_FAILED')
  })
})

describe('FR-05 Đổi email - bước 2 xác nhận OTP', () => {
  const confirm = (code: string) => request(app).post('/users/me/email-change/confirm').set('Authorization', auth()).send({ code })

  it('đúng OTP: đổi email, ghi emailVerifiedAt và audit EMAIL_CHANGED, trả hồ sơ mới', async () => {
    prisma.emailChangeRequest.findFirst.mockResolvedValue(pending())

    const response = await confirm('123456')

    expect(response.status).toBe(200)
    expect(response.body.email).toBe(NEW_EMAIL)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { email: NEW_EMAIL, emailVerifiedAt: expect.any(Date) },
    })
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'EMAIL_CHANGED',
      oldData: { email: 'binh@gmail.com' },
      newData: { email: NEW_EMAIL },
    })
  })

  it('sai mã, hết hạn hoặc không có yêu cầu thì 400 và không đổi email', async () => {
    prisma.emailChangeRequest.findFirst.mockResolvedValueOnce(pending())
    expect((await confirm('654321')).body.code).toBe('INVALID_EMAIL_CHANGE_CODE')

    prisma.emailChangeRequest.findFirst.mockResolvedValueOnce(pending({ expiresAt: new Date(Date.now() - 1000) }))
    expect((await confirm('123456')).body.code).toBe('INVALID_EMAIL_CHANGE_CODE')

    prisma.emailChangeRequest.findFirst.mockResolvedValueOnce(null)
    expect((await confirm('123456')).status).toBe(400)

    expect((await confirm('12ab')).status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('mã vừa được dùng ở request khác (updateMany count 0) thì 400, không dùng lại được', async () => {
    prisma.emailChangeRequest.findFirst.mockResolvedValue(pending())
    prisma.emailChangeRequest.updateMany.mockResolvedValueOnce({ count: 0 })
    expect((await confirm('123456')).body.code).toBe('INVALID_EMAIL_CHANGE_CODE')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('trong lúc chờ OTP email bị người khác lấy thì 409', async () => {
    prisma.emailChangeRequest.findFirst.mockResolvedValue(pending())
    mockUsers({ emailOwner: { id: 9 } })
    expect((await confirm('123456')).status).toBe(409)

    // note: trường hợp 2 người ghi cùng lúc, unique của DB chặn
    mockUsers()
    prisma.user.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }))
    expect((await confirm('123456')).status).toBe(409)
  })
})
