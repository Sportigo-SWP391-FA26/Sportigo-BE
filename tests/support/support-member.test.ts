import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    supportRequest: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    supportMessage: { create: vi.fn() },
  }
  return { prisma }
})
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { supportRouter } from '../../src/modules/support/support.routes.js'

const app = express()
app.use(express.json())
app.use('/support-requests', supportRouter)
app.use(errorHandler)

const MEMBER_ID = 5
const auth = (role = 'MEMBER', userId = MEMBER_ID) => `Bearer ${createAccessToken({ userId, role })}`

const memberPerson = { id: MEMBER_ID, displayName: 'Trần Bình', role: { name: 'MEMBER' } }
const detailRow = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  subject: 'Không thanh toán được',
  category: 'PAYMENT',
  priority: 'HIGH',
  status: 'OPEN',
  createdAt: new Date('2026-10-25T03:00:00Z'),
  resolvedAt: null,
  description: 'Thanh toán VNPay bị lỗi khi đăng ký lớp yoga',
  requester: memberPerson,
  assignments: [],
  _count: { messages: 0 },
  messages: [],
  ...overrides,
})

// note: lần findUnique đầu là kiểm tra quyền (findRequestAccess), lần sau là lấy chi tiết
const access = (overrides: Record<string, unknown> = {}) => ({ id: 11, requesterId: MEMBER_ID, status: 'OPEN', subject: 'x', ...overrides })

const newRequest = { subject: 'Không thanh toán được', category: 'PAYMENT', description: 'Thanh toán VNPay bị lỗi khi đăng ký lớp yoga', priority: 'HIGH' }

describe('FR-55 Member gửi yêu cầu hỗ trợ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.supportRequest.updateMany.mockResolvedValue({ count: 1 })
  })

  it('chỉ Member dùng được các API này', async () => {
    expect((await request(app).post('/support-requests').set('Authorization', auth('COACH', 7)).send(newRequest)).status).toBe(403)
    expect((await request(app).get('/support-requests')).status).toBe(401)
  })

  it('tạo yêu cầu gắn requester là người đăng nhập, không tin requesterId/status từ body', async () => {
    prisma.supportRequest.create.mockResolvedValue({ id: 11 })
    prisma.supportRequest.findUnique.mockResolvedValue(detailRow())

    const response = await request(app).post('/support-requests').set('Authorization', auth()).send(newRequest)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ id: 11, status: 'OPEN', requester: { id: MEMBER_ID, role: 'MEMBER' }, assignee: null })
    expect(prisma.supportRequest.create).toHaveBeenCalledWith({ data: { requesterId: MEMBER_ID, ...newRequest }, select: { id: true } })

    const injected = await request(app).post('/support-requests').set('Authorization', auth()).send({ ...newRequest, requesterId: 99 })
    expect(injected.status).toBe(400)
    const badCategory = await request(app).post('/support-requests').set('Authorization', auth()).send({ ...newRequest, category: 'XYZ' })
    expect(badCategory.status).toBe(400)
  })

  it('mức ưu tiên mặc định MEDIUM', async () => {
    prisma.supportRequest.create.mockResolvedValue({ id: 11 })
    prisma.supportRequest.findUnique.mockResolvedValue(detailRow())
    await request(app).post('/support-requests').set('Authorization', auth()).send({ ...newRequest, priority: undefined })
    expect(prisma.supportRequest.create.mock.calls[0][0].data.priority).toBe('MEDIUM')
  })

  it('danh sách chỉ lọc theo requester là chính mình', async () => {
    prisma.supportRequest.findMany.mockResolvedValue([detailRow()])
    prisma.supportRequest.count.mockResolvedValue(1)

    const response = await request(app).get('/support-requests?status=OPEN').set('Authorization', auth())

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(1)
    expect(prisma.supportRequest.findMany.mock.calls[0][0].where).toEqual({ requesterId: MEMBER_ID, status: 'OPEN' })
  })

  it('xem yêu cầu của người khác trả 404; chi tiết không lấy tin nhắn nội bộ', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access({ requesterId: 99 }))
    const other = await request(app).get('/support-requests/11').set('Authorization', auth())
    expect(other.status).toBe(404)
    expect(other.body.code).toBe('REQUEST_NOT_FOUND')

    prisma.supportRequest.findUnique.mockResolvedValueOnce(access()).mockResolvedValueOnce(detailRow())
    const own = await request(app).get('/support-requests/11').set('Authorization', auth())
    expect(own.status).toBe(200)
    expect(prisma.supportRequest.findUnique.mock.calls[2][0].select.messages.where).toEqual({ isInternal: false })
  })

  it('gửi tin nhắn vào yêu cầu của mình; yêu cầu đã đóng thì 409', async () => {
    prisma.supportRequest.findUnique
      .mockResolvedValueOnce(access({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(detailRow({ status: 'IN_PROGRESS' }))
    const sent = await request(app).post('/support-requests/11/messages').set('Authorization', auth()).send({ content: 'Em gửi thêm ảnh' })
    expect(sent.status).toBe(201)
    expect(prisma.supportMessage.create).toHaveBeenCalledWith({ data: { requestId: 11, senderId: MEMBER_ID, content: 'Em gửi thêm ảnh' }, select: { id: true } })

    prisma.supportRequest.findUnique.mockResolvedValueOnce(access({ status: 'CLOSED' }))
    const closed = await request(app).post('/support-requests/11/messages').set('Authorization', auth()).send({ content: 'Còn đó không?' })
    expect(closed.status).toBe(409)
    expect(closed.body.code).toBe('REQUEST_CLOSED')
  })

  it('hủy yêu cầu đang mở; đã giải quyết thì không hủy được', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access()).mockResolvedValueOnce(detailRow({ status: 'CANCELLED' }))
    const cancelled = await request(app).post('/support-requests/11/cancel').set('Authorization', auth())
    expect(cancelled.status).toBe(200)
    expect(prisma.supportRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED' },
    })

    prisma.supportRequest.findUnique.mockResolvedValueOnce(access({ status: 'RESOLVED' }))
    const resolved = await request(app).post('/support-requests/11/cancel').set('Authorization', auth())
    expect(resolved.body.code).toBe('INVALID_STATUS_TRANSITION')
  })
})
