import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma, sendVerificationEmail } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    coach: { count: vi.fn(), update: vi.fn() },
    receptionist: { count: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    emailVerificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  }
  return { prisma, sendVerificationEmail: vi.fn() }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))
// note: không gửi mail thật trong test
vi.mock('../../src/modules/auth/email.service.js', () => ({ sendVerificationEmail, sendPasswordResetEmail: vi.fn() }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { staffRouter } from '../../src/modules/users/staff.routes.js'

const app = express()
app.use(express.json())
app.use('/staff', staffRouter)
app.use(errorHandler)

const auth = (role = 'CENTER_MANAGER') => `Bearer ${createAccessToken({ userId: 1, role })}`

const coachRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  email: 'coach@sportigo.vn',
  phone: '0901234567',
  displayName: 'Lê Lan',
  status: 'INACTIVE',
  emailVerifiedAt: null,
  createdAt: new Date('2026-10-25'),
  role: { name: 'COACH' },
  coach: { coachCode: 'COA-07', bio: null, status: 'ACTIVE', hiredAt: new Date('2026-10-01') },
  receptionist: null,
  ...overrides,
})

const receptionistRow = (overrides: Record<string, unknown> = {}) =>
  coachRow({ id: 8, email: 'le@sportigo.vn', role: { name: 'RECEPTIONIST' }, coach: null, receptionist: { staffCode: 'REC-01', hiredAt: null }, ...overrides })

const newCoach = {
  role: 'COACH',
  staffCode: 'coa-07',
  displayName: 'Lê Lan',
  email: 'Coach@Sportigo.vn',
  phone: '0901234567',
  password: 'matkhau123',
  hiredAt: '2026-10-01',
}

describe('FR-07 Quản lý nhân sự', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.coach.count.mockResolvedValue(0)
    prisma.receptionist.count.mockResolvedValue(0)
  })

  it('chỉ Center Manager được gọi', async () => {
    for (const role of ['RECEPTIONIST', 'COACH', 'MEMBER']) {
      expect((await request(app).get('/staff').set('Authorization', auth(role))).status).toBe(403)
    }
    expect((await request(app).post('/staff').send(newCoach)).status).toBe(401)
  })

  it('danh sách chỉ lấy Coach/Receptionist, gộp mã nhân sự', async () => {
    prisma.user.findMany.mockResolvedValue([coachRow(), receptionistRow()])
    prisma.user.count.mockResolvedValue(2)

    const response = await request(app).get('/staff?q=lan').set('Authorization', auth())

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { staffCode: string }) => item.staffCode)).toEqual(['COA-07', 'REC-01'])
    const where = prisma.user.findMany.mock.calls[0][0].where
    expect(where.role).toEqual({ name: { in: ['COACH', 'RECEPTIONIST'] } })
    expect(where.OR).toContainEqual({ receptionist: { staffCode: { contains: 'lan', mode: 'insensitive' } } })
  })

  it('tạo Coach: mã viết hoa, INACTIVE, ghi audit, gửi OTP xác minh', async () => {
    prisma.user.create.mockResolvedValue(coachRow())
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'coach@sportigo.vn', displayName: 'Lê Lan', emailVerifiedAt: null })

    const response = await request(app).post('/staff').set('Authorization', auth()).send(newCoach)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ staffCode: 'COA-07', role: 'COACH', emailSent: true })
    expect(response.body.passwordHash).toBeUndefined()
    const data = prisma.user.create.mock.calls[0][0].data
    expect(data).toMatchObject({ email: 'coach@sportigo.vn', status: 'INACTIVE', role: { connect: { name: 'COACH' } } })
    expect(data.coach.create.coachCode).toBe('COA-07')
    expect(data.passwordHash).not.toBe('matkhau123')
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'STAFF_CREATED', entityId: '7' })
    expect(sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'coach@sportigo.vn' }))
  })

  it('tạo Receptionist lưu vào bảng Receptionist; gửi bio cho Receptionist thì 400', async () => {
    prisma.user.create.mockResolvedValue(receptionistRow())
    prisma.user.findUnique.mockResolvedValue(null)
    const body = { ...newCoach, role: 'RECEPTIONIST', staffCode: 'REC-01', email: 'le@sportigo.vn' }

    expect((await request(app).post('/staff').set('Authorization', auth()).send(body)).status).toBe(201)
    expect(prisma.user.create.mock.calls[0][0].data.receptionist.create.staffCode).toBe('REC-01')

    const withBio = await request(app).post('/staff').set('Authorization', auth()).send({ ...body, bio: 'x' })
    expect(withBio.status).toBe(400)
    expect(withBio.body.code).toBe('FIELD_NOT_ALLOWED')
  })

  it('mã nhân sự trùng (kể cả khác bảng) thì 409 STAFF_CODE_EXISTS', async () => {
    prisma.receptionist.count.mockResolvedValue(1)
    const response = await request(app).post('/staff').set('Authorization', auth()).send(newCoach)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('STAFF_CODE_EXISTS')
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('email trùng thì 409 ACCOUNT_EXISTS field email; không cho tạo Manager', async () => {
    prisma.user.findFirst.mockResolvedValue({ email: 'coach@sportigo.vn', phone: null })
    const response = await request(app).post('/staff').set('Authorization', auth()).send(newCoach)
    expect(response.status).toBe(409)
    expect(response.body.details).toEqual({ field: 'email' })

    const manager = await request(app).post('/staff').set('Authorization', auth()).send({ ...newCoach, role: 'CENTER_MANAGER' })
    expect(manager.status).toBe(400)
  })

  it('cập nhật Coach: đổi mã, trạng thái Coach, ghi audit giá trị cũ', async () => {
    prisma.user.findUnique.mockResolvedValue(coachRow())
    prisma.user.findUniqueOrThrow.mockResolvedValue(coachRow({ coach: { coachCode: 'COA-99', bio: null, status: 'ON_LEAVE', hiredAt: null } }))

    const response = await request(app).patch('/staff/7').set('Authorization', auth()).send({ staffCode: 'COA-99', coachStatus: 'ON_LEAVE' })

    expect(response.status).toBe(200)
    expect(response.body.coachStatus).toBe('ON_LEAVE')
    expect(prisma.coach.update).toHaveBeenCalledWith({ where: { userId: 7 }, data: { coachCode: 'COA-99', status: 'ON_LEAVE' } })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'STAFF_UPDATED',
      oldData: { staffCode: 'COA-07', coachStatus: 'ACTIVE' },
    })
  })

  it('không cho đổi role/email, không sửa Member qua API này', async () => {
    const role = await request(app).patch('/staff/7').set('Authorization', auth()).send({ role: 'CENTER_MANAGER' })
    expect(role.status).toBe(400)
    const email = await request(app).patch('/staff/7').set('Authorization', auth()).send({ email: 'x@y.vn' })
    expect(email.status).toBe(400)

    prisma.user.findUnique.mockResolvedValue(coachRow({ role: { name: 'MEMBER' }, coach: null }))
    const member = await request(app).patch('/staff/5').set('Authorization', auth()).send({ displayName: 'Tên mới' })
    expect(member.status).toBe(404)
  })

  it('Receptionist cũ chưa có hồ sơ: sửa ngày vào làm mà thiếu mã thì 400, có mã thì upsert', async () => {
    prisma.user.findUnique.mockResolvedValue(receptionistRow({ receptionist: null }))
    const missing = await request(app).patch('/staff/8').set('Authorization', auth()).send({ hiredAt: '2026-01-01' })
    expect(missing.body.code).toBe('STAFF_CODE_REQUIRED')

    prisma.user.findUniqueOrThrow.mockResolvedValue(receptionistRow())
    const ok = await request(app).patch('/staff/8').set('Authorization', auth()).send({ staffCode: 'rec-01', hiredAt: '2026-01-01' })
    expect(ok.status).toBe(200)
    expect(prisma.receptionist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 8 }, create: expect.objectContaining({ staffCode: 'REC-01' }) }),
    )

    const coachField = await request(app).patch('/staff/8').set('Authorization', auth()).send({ coachStatus: 'ON_LEAVE' })
    expect(coachField.body.code).toBe('FIELD_NOT_ALLOWED')
  })
})
