import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (arg: unknown): Promise<unknown> =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
    supportRequest: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    supportMessage: { create: vi.fn() },
    requestAssignment: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { createMany: vi.fn(async () => ({ count: 1 })) },
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

const RECEPTIONIST = 3
const OTHER_RECEPTIONIST = 4
const MANAGER = 1
const MEMBER = 5
const auth = (role: string, userId: number) => `Bearer ${createAccessToken({ userId, role })}`
const asReceptionist = auth('RECEPTIONIST', RECEPTIONIST)
const asManager = auth('CENTER_MANAGER', MANAGER)

const access = (status = 'OPEN', assignedToId?: number) => ({
  id: 11,
  requesterId: MEMBER,
  status,
  subject: 'Không thanh toán được',
  assignments: assignedToId ? [{ assignedToId }] : [],
})

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  subject: 'Không thanh toán được',
  category: 'PAYMENT',
  priority: 'HIGH',
  status: 'ASSIGNED',
  createdAt: new Date('2026-10-25T03:00:00Z'),
  resolvedAt: null,
  description: 'Thanh toán VNPay bị lỗi',
  requester: { id: MEMBER, displayName: 'Trần Bình', role: { name: 'MEMBER' } },
  assignments: [],
  _count: { messages: 1 },
  messages: [],
  ...overrides,
})

// note: findUnique lần 1 = kiểm tra quyền, lần 2 = lấy chi tiết sau khi cập nhật
function mockRequest(status: string, assignedToId?: number, after: Record<string, unknown> = {}) {
  prisma.supportRequest.findUnique.mockResolvedValueOnce(access(status, assignedToId)).mockResolvedValueOnce(detailRow(after))
}

const patch = (body: object, token = asReceptionist) => request(app).patch('/support-requests/11').set('Authorization', token).send(body)

describe('FR-56 Receptionist xử lý yêu cầu hỗ trợ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.supportRequest.updateMany.mockResolvedValue({ count: 1 })
    prisma.requestAssignment.findMany.mockResolvedValue([])
    prisma.user.findFirst.mockResolvedValue({ id: RECEPTIONIST })
  })

  it('Member và Coach không gọi được PATCH', async () => {
    expect((await patch({ status: 'IN_PROGRESS' }, auth('MEMBER', MEMBER))).status).toBe(403)
    expect((await patch({ status: 'IN_PROGRESS' }, auth('COACH', 7))).status).toBe(403)
  })

  it('hàng đợi của Receptionist chỉ gồm yêu cầu chưa phân công hoặc giao cho mình; Manager thấy tất cả', async () => {
    prisma.supportRequest.findMany.mockResolvedValue([])
    prisma.supportRequest.count.mockResolvedValue(0)

    await request(app).get('/support-requests?priority=HIGH').set('Authorization', asReceptionist)
    const receptionistWhere = prisma.supportRequest.findMany.mock.calls[0][0].where
    expect(receptionistWhere.AND).toContainEqual({ priority: 'HIGH' })
    expect(receptionistWhere.AND).toContainEqual({
      OR: [
        { assignments: { none: { status: 'ACTIVE' } } },
        { assignments: { some: { status: 'ACTIVE', assignedToId: RECEPTIONIST } } },
      ],
    })

    await request(app).get('/support-requests').set('Authorization', asManager)
    expect(prisma.supportRequest.findMany.mock.calls[1][0].where).toEqual({ AND: [] })
  })

  it('Receptionist tự nhận yêu cầu OPEN: tạo phân công, chuyển ASSIGNED, audit và báo Member', async () => {
    mockRequest('OPEN')

    const response = await patch({ assigneeId: RECEPTIONIST })

    expect(response.status).toBe(200)
    expect(prisma.requestAssignment.create).toHaveBeenCalledWith({
      data: { requestId: 11, assignedToId: RECEPTIONIST, assignedById: RECEPTIONIST, note: undefined },
    })
    expect(prisma.supportRequest.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: 'OPEN' }, data: { status: 'ASSIGNED' } })
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'SUPPORT_ASSIGNED', entityType: 'SupportRequest' })
    expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: MEMBER, type: 'SUPPORT' })] })
  })

  it('Receptionist không giao việc cho người khác; Manager giao được cho Receptionist', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access('OPEN'))
    expect((await patch({ assigneeId: OTHER_RECEPTIONIST })).status).toBe(403)

    mockRequest('ASSIGNED', RECEPTIONIST)
    prisma.user.findFirst.mockResolvedValue({ id: OTHER_RECEPTIONIST })
    const reassigned = await patch({ assigneeId: OTHER_RECEPTIONIST, note: 'Chuyển ca' }, asManager)
    expect(reassigned.status).toBe(200)
    // note: phân công cũ bị kết thúc
    expect(prisma.requestAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 11, status: 'ACTIVE' }, data: expect.objectContaining({ status: 'CANCELLED' }) }),
    )
  })

  it('giao cho người không phải Receptionist đang hoạt động thì 400', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access('OPEN'))
    prisma.user.findFirst.mockResolvedValue(null)
    const response = await patch({ assigneeId: 99 }, asManager)
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_ASSIGNEE')
  })

  it('Receptionist không xem được yêu cầu đang giao cho người khác (404)', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access('IN_PROGRESS', OTHER_RECEPTIONIST))
    const response = await request(app).get('/support-requests/11').set('Authorization', asReceptionist)
    expect(response.status).toBe(404)
  })

  it('chuyển trạng thái hợp lệ: IN_PROGRESS → RESOLVED ghi resolvedAt', async () => {
    mockRequest('IN_PROGRESS', RECEPTIONIST, { status: 'RESOLVED' })
    const response = await patch({ status: 'RESOLVED' })
    expect(response.status).toBe(200)
    const call = prisma.supportRequest.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 11, status: 'IN_PROGRESS' })
    expect(call.data.status).toBe('RESOLVED')
    expect(call.data.resolvedAt).toBeInstanceOf(Date)
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'SUPPORT_STATUS_CHANGED', oldData: { status: 'IN_PROGRESS' } })
  })

  it('đóng yêu cầu thì hoàn tất phân công', async () => {
    mockRequest('RESOLVED', RECEPTIONIST, { status: 'CLOSED' })
    await patch({ status: 'CLOSED' })
    expect(prisma.requestAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 11, status: 'ACTIVE' }, data: expect.objectContaining({ status: 'COMPLETED' }) }),
    )
  })

  it('chuyển trạng thái sai thì 409 INVALID_STATUS_TRANSITION', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access('ASSIGNED', RECEPTIONIST))
    const skip = await patch({ status: 'CLOSED' })
    expect(skip.status).toBe(409)
    expect(skip.body.code).toBe('INVALID_STATUS_TRANSITION')

    prisma.supportRequest.findUnique.mockResolvedValueOnce(access('OPEN'))
    const notAssigned = await patch({ status: 'IN_PROGRESS' })
    expect(notAssigned.body.code).toBe('REQUEST_NOT_ASSIGNED')
    expect(prisma.supportRequest.updateMany).not.toHaveBeenCalled()
  })

  it('PATCH vừa nhận việc vừa chuyển IN_PROGRESS', async () => {
    mockRequest('OPEN', undefined, { status: 'IN_PROGRESS' })
    const response = await patch({ assigneeId: RECEPTIONIST, status: 'IN_PROGRESS' })
    expect(response.status).toBe(200)
    expect(prisma.supportRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, status: 'ASSIGNED' },
      data: { status: 'IN_PROGRESS', resolvedAt: null },
    })
  })

  it('trả lời công khai: tự chuyển IN_PROGRESS và báo Member; ghi chú nội bộ thì không báo', async () => {
    mockRequest('ASSIGNED', RECEPTIONIST)
    const reply = await request(app).post('/support-requests/11/messages').set('Authorization', asReceptionist).send({ content: 'Bạn gửi mã đơn giúp mình' })
    expect(reply.status).toBe(201)
    expect(prisma.supportRequest.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: 'ASSIGNED' }, data: { status: 'IN_PROGRESS' } })
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    prisma.requestAssignment.findMany.mockResolvedValue([])
    mockRequest('IN_PROGRESS', RECEPTIONIST)
    await request(app).post('/support-requests/11/messages').set('Authorization', asReceptionist).send({ content: 'Đơn này lỗi VNPay', isInternal: true })
    expect(prisma.supportMessage.create).toHaveBeenCalledWith({
      data: { requestId: 11, senderId: RECEPTIONIST, content: 'Đơn này lỗi VNPay', isInternal: true },
      select: { id: true },
    })
    expect(prisma.notification.createMany).not.toHaveBeenCalled()
  })

  it('chưa nhận việc thì không được trả lời công khai; Member không gửi được isInternal', async () => {
    prisma.supportRequest.findUnique.mockResolvedValueOnce(access('OPEN'))
    const reply = await request(app).post('/support-requests/11/messages').set('Authorization', asReceptionist).send({ content: 'Chào bạn' })
    expect(reply.body.code).toBe('REQUEST_NOT_ASSIGNED')

    const fromMember = await request(app)
      .post('/support-requests/11/messages')
      .set('Authorization', auth('MEMBER', MEMBER))
      .send({ content: 'x', isInternal: true })
    expect(fromMember.status).toBe(400)
  })

  it('chi tiết cho nhân viên lấy cả tin nội bộ và lịch sử phân công', async () => {
    mockRequest('IN_PROGRESS', RECEPTIONIST)
    const person = (id: number, name: string) => ({ id, displayName: name, role: { name: 'RECEPTIONIST' } })
    prisma.requestAssignment.findMany.mockResolvedValue([
      { id: 1, status: 'ACTIVE', note: null, assignedAt: new Date(), unassignedAt: null, assignedTo: person(RECEPTIONIST, 'Mai'), assignedBy: person(RECEPTIONIST, 'Mai') },
    ])

    const response = await request(app).get('/support-requests/11').set('Authorization', asReceptionist)

    expect(response.status).toBe(200)
    expect(response.body.history).toHaveLength(1)
    expect(prisma.supportRequest.findUnique.mock.calls[1][0].select.messages.where).toEqual({})
  })
})
