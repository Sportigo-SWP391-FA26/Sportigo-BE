import bcrypt from 'bcryptjs'
import express from 'express'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// note: giả lập prisma; $transaction hỗ trợ cả kiểu mảng và kiểu callback nhận tx
const { prisma } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    member: { update: vi.fn() },
    coach: { update: vi.fn() },
    refreshToken: { updateMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return { prisma }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

// note: import sau vi.mock để module users dùng prisma giả
import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { usersRouter } from '../../src/modules/users/users.routes.js'

// note: app nhỏ chỉ gắn router users + errorHandler thật để kiểm tra mã lỗi trả về
const app = express()
app.use(express.json())
app.use('/users', usersRouter)
app.use(errorHandler)

const auth = (userId = 5, role = 'MEMBER') => `Bearer ${createAccessToken({ userId, role })}`

const OLD_PASSWORD = 'matkhau123'
let oldHash = ''

// note: hồ sơ Member mẫu; overrides để đổi role/status cho từng trường hợp
const memberRow = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  email: 'binh@gmail.com',
  phone: '0912345678',
  passwordHash: oldHash,
  displayName: 'Trần Bình',
  status: 'ACTIVE',
  emailVerifiedAt: new Date('2026-10-01'),
  createdAt: new Date('2026-10-01'),
  role: { name: 'MEMBER' },
  member: { memberCode: 'MEM-0005', dateOfBirth: new Date('2000-05-20T00:00:00Z'), gender: 'MALE', emergencyContact: null, joinedAt: new Date('2026-10-01') },
  coach: null,
  ...overrides,
})

const coachRow = () =>
  memberRow({ id: 7, role: { name: 'COACH' }, member: null, coach: { coachCode: 'COA-07', bio: null, hiredAt: null } })

beforeAll(async () => {
  // note: cost 4 cho test chạy nhanh; service vẫn so sánh bằng bcrypt.compare như thật
  oldHash = await bcrypt.hash(OLD_PASSWORD, 4)
})

beforeEach(() => {
  vi.clearAllMocks()
  prisma.user.findFirst.mockResolvedValue(null)
})

describe('FR-05 Xem và cập nhật hồ sơ', () => {
  it('chưa đăng nhập thì 401', async () => {
    expect((await request(app).get('/users/me')).status).toBe(401)
  })

  it('GET /me trả hồ sơ, không lộ passwordHash, ngày sinh dạng YYYY-MM-DD', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())

    const response = await request(app).get('/users/me').set('Authorization', auth())

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: 5, role: 'MEMBER', member: { memberCode: 'MEM-0005', dateOfBirth: '2000-05-20' }, coach: null })
    expect(response.body.passwordHash).toBeUndefined()
    // note: luôn đọc theo id trong token, không theo tham số client gửi
    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ id: 5 })
  })

  it('tài khoản bị khóa nhưng token còn hạn thì 403 ACCOUNT_INACTIVE', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow({ status: 'LOCKED' }))
    const response = await request(app).get('/users/me').set('Authorization', auth())
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ACCOUNT_INACTIVE')
  })

  it('PATCH hợp lệ: tách đúng trường vào bảng User và Member', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())
    prisma.user.findUniqueOrThrow.mockResolvedValue(memberRow({ displayName: 'Trần Văn Bình' }))

    const response = await request(app)
      .patch('/users/me')
      .set('Authorization', auth())
      .send({ displayName: 'Trần Văn Bình', emergencyContact: 'Mẹ 0909' })

    expect(response.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { displayName: 'Trần Văn Bình' } })
    expect(prisma.member.update).toHaveBeenCalledWith({ where: { userId: 5 }, data: { emergencyContact: 'Mẹ 0909' } })
    expect(prisma.coach.update).not.toHaveBeenCalled()
  })

  it('sửa trường bị cấm (email, role, status) hoặc body rỗng thì 400', async () => {
    for (const body of [{ email: 'moi@gmail.com' }, { role: 'CENTER_MANAGER' }, { status: 'ACTIVE' }, {}]) {
      const response = await request(app).patch('/users/me').set('Authorization', auth()).send(body)
      expect(response.status).toBe(400)
    }
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('Coach gửi trường của Member thì 400 FIELD_NOT_ALLOWED', async () => {
    prisma.user.findUnique.mockResolvedValue(coachRow())
    const response = await request(app).patch('/users/me').set('Authorization', auth(7, 'COACH')).send({ dateOfBirth: '2000-01-01' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ code: 'FIELD_NOT_ALLOWED', details: { fields: ['dateOfBirth'] } })
  })

  it('số điện thoại đã thuộc người khác thì 409; giữ số của chính mình thì không kiểm tra trùng', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())
    prisma.user.findFirst.mockResolvedValueOnce({ id: 9 })
    const taken = await request(app).patch('/users/me').set('Authorization', auth()).send({ phone: '0987654321' })
    expect(taken.status).toBe(409)
    expect(taken.body.details).toEqual({ field: 'phone' })

    vi.clearAllMocks()
    prisma.user.findUnique.mockResolvedValue(memberRow())
    prisma.user.findUniqueOrThrow.mockResolvedValue(memberRow())
    const same = await request(app).patch('/users/me').set('Authorization', auth()).send({ phone: '0912345678' })
    expect(same.status).toBe(200)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it('hai request cùng lấy một số điện thoại: unique của DB chặn và trả 409 thay vì 500', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())
    // note: Once để lỗi giả không rò sang test sau (clearAllMocks không xóa implementation)
    prisma.user.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }))
    const response = await request(app).patch('/users/me').set('Authorization', auth()).send({ phone: '0987654321' })
    expect(response.status).toBe(409)
  })
})

describe('FR-62 Đổi mật khẩu', () => {
  const change = (body: object) => request(app).put('/users/me/password').set('Authorization', auth()).send(body)
  const valid = { currentPassword: OLD_PASSWORD, newPassword: 'matkhaumoi456', confirmPassword: 'matkhaumoi456' }

  it('đổi thành công: lưu hash mới, thu hồi refresh token, ghi audit, cấp phiên mới', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())

    const response = await change(valid)

    expect(response.status).toBe(200)
    expect(response.body.accessToken).toEqual(expect.any(String))
    // note: refreshToken chỉ nằm trong cookie, không trả trong body
    expect(response.body.refreshToken).toBeUndefined()
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('sportigo_refresh=')]))
    const savedHash = prisma.user.update.mock.calls[0][0].data.passwordHash
    expect(await bcrypt.compare('matkhaumoi456', savedHash)).toBe(true)
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 5, revokedAt: null } }))
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'PASSWORD_CHANGED', entityId: '5' })
    // note: audit không được chứa hash mật khẩu
    expect(prisma.auditLog.create.mock.calls[0][0].data.newData).toBeUndefined()
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1)
  })

  it('sai mật khẩu hiện tại thì 400 INVALID_CURRENT_PASSWORD (không phải 401)', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())
    const response = await change({ ...valid, currentPassword: 'saimatkhau' })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_CURRENT_PASSWORD')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('mật khẩu mới trùng mật khẩu cũ thì 400 SAME_AS_CURRENT_PASSWORD', async () => {
    prisma.user.findUnique.mockResolvedValue(memberRow())
    const response = await change({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD, confirmPassword: OLD_PASSWORD })
    expect(response.body.code).toBe('SAME_AS_CURRENT_PASSWORD')
  })

  it('mật khẩu yếu hoặc xác nhận không khớp thì 400 trước khi đọc DB', async () => {
    expect((await change({ ...valid, newPassword: '123', confirmPassword: '123' })).status).toBe(400)
    expect((await change({ ...valid, confirmPassword: 'khac123456' })).status).toBe(400)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
