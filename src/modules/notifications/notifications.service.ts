import { HttpError } from '../../lib/http-error.js'
import { listForUser, markAllRead, markRead } from './notifications.repository.js'
import type { ListNotificationsQuery } from './notifications.schema.js'

// FR-54
export async function listMyNotifications(userId: number, query: ListNotificationsQuery) {
  const [items, total, unreadCount] = await listForUser(userId, {
    unreadOnly: query.unread,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  })
  // note: unreadCount luôn tính trên toàn bộ thông báo để chuông hiển thị đúng, kể cả khi đang lọc
  return { items, page: query.page, pageSize: query.pageSize, total, unreadCount }
}

export async function markMyNotificationRead(userId: number, id: number) {
  const result = await markRead(userId, id)
  // note: không phân biệt "không tồn tại" và "của người khác" để không lộ id thông báo của người khác
  if (result.count === 0) throw new HttpError(404, 'Không tìm thấy thông báo', 'NOTIFICATION_NOT_FOUND')
  return { id, isRead: true }
}

export async function markAllMyNotificationsRead(userId: number) {
  const result = await markAllRead(userId)
  return { updated: result.count }
}
