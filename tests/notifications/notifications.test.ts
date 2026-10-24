import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  },
}))
vi.mock('../../src/lib/prisma.js', () => ({ prisma }))

import { errorHandler } from '../../src/middleware/error-handler.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { notificationsRouter } from '../../src/modules/notifications/notifications.routes.js'
import { notify } from '../../src/modules/notifications/notify.js'

const app = express()
app.use(express.json())
app.use('/notifications', notificationsRouter)
app.use(errorHandler)

const auth = (userId: number, role = 'MEMBER') => `Bearer ${createAccessToken({ userId, role })}`

describe('FR-54 Thông báo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('chưa đăng nhập thì 401', async () => {
    const response = await request(app).get('/notifications')
    expect(response.status).toBe(401)
  })

  it('chỉ lấy thông báo của người đang đăng nhập, kèm số chưa đọc', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 1, title: 'A', isRead: false }])
    prisma.notification.count.mockResolvedValueOnce(1).mockResolvedValueOnce(3)

    const response = await request(app).get('/notifications?page=1&pageSize=10').set('Authorization', auth(7))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ total: 1, unreadCount: 3, page: 1, pageSize: 10 })
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 }, skip: 0, take: 10 }),
    )
  })

  it('unread=true chỉ lọc thông báo chưa đọc; unread=false không lọc', async () => {
    prisma.notification.findMany.mockResolvedValue([])
    prisma.notification.count.mockResolvedValue(0)

    await request(app).get('/notifications?unread=true').set('Authorization', auth(7))
    expect(prisma.notification.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: 7, isRead: false } }))

    await request(app).get('/notifications?unread=false').set('Authorization', auth(7))
    expect(prisma.notification.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: 7 } }))
  })

  // note: errorHandler trên develop trả 400 VALIDATION_ERROR cho lỗi Zod
  it('tham số lạ hoặc pageSize quá lớn thì 400 VALIDATION_ERROR', async () => {
    const tooBig = await request(app).get('/notifications?pageSize=500').set('Authorization', auth(7))
    expect(tooBig.status).toBe(400)
    expect(tooBig.body.code).toBe('VALIDATION_ERROR')
    expect((await request(app).get('/notifications?userId=9').set('Authorization', auth(7))).status).toBe(400)
  })

  it('đánh dấu đã đọc luôn kèm userId; thông báo của người khác trả 404', async () => {
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 1 })
    const ok = await request(app).patch('/notifications/5/read').set('Authorization', auth(7))
    expect(ok.status).toBe(200)
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({ where: { id: 5, userId: 7 }, data: { isRead: true } })

    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 })
    const other = await request(app).patch('/notifications/6/read').set('Authorization', auth(7))
    expect(other.status).toBe(404)
    expect(other.body.code).toBe('NOTIFICATION_NOT_FOUND')
  })

  it('đánh dấu tất cả đã đọc', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 4 })
    const response = await request(app).patch('/notifications/read-all').set('Authorization', auth(7))
    expect(response.body).toEqual({ updated: 4 })
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({ where: { userId: 7, isRead: false }, data: { isRead: true } })
  })

  it('notify bỏ người nhận trùng và không ghi khi danh sách rỗng', async () => {
    prisma.notification.createMany.mockResolvedValue({ count: 2 })
    const db = prisma as unknown as Parameters<typeof notify>[0]

    await notify(db, { userIds: [3, 3, 4], type: 'REFUND', title: 'T', content: 'C' })
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 3, type: 'REFUND', title: 'T', content: 'C' },
        { userId: 4, type: 'REFUND', title: 'T', content: 'C' },
      ],
    })

    prisma.notification.createMany.mockClear()
    expect(await notify(db, { userIds: [], type: 'REFUND', title: 'T', content: 'C' })).toBe(0)
    expect(prisma.notification.createMany).not.toHaveBeenCalled()
  })
})
