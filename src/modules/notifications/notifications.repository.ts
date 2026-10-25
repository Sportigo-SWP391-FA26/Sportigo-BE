import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

const notificationSelect = {
  id: true,
  title: true,
  content: true,
  type: true,
  isRead: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect

export function listForUser(userId: number, options: { unreadOnly: boolean; skip: number; take: number }) {
  // note: luôn lọc theo userId lấy từ token → không bao giờ trả thông báo của người khác
  const where: Prisma.NotificationWhereInput = { userId, ...(options.unreadOnly ? { isRead: false } : {}) }
  return prisma.$transaction([
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: options.skip,
      take: options.take,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ])
}

export function markRead(userId: number, id: number) {
  // note: updateMany với cả id và userId → đánh dấu thông báo của người khác sẽ trả count = 0
  return prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } })
}

export function markAllRead(userId: number) {
  return prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } })
}
