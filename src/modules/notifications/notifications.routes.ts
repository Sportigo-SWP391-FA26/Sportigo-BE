import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from './notifications.controller.js'

// Gắn tại /api/notifications. Mọi role đều có thông báo của riêng mình.
// note: /read-all phải khai báo trước /:id/read để không bị hiểu nhầm là id
export const notificationsRouter = Router()
notificationsRouter.get('/', authenticate, listNotifications)
notificationsRouter.patch('/read-all', authenticate, markAllNotificationsRead)
notificationsRouter.patch('/:id/read', authenticate, markNotificationRead)
