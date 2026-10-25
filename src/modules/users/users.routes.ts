import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { changeUserStatus, listUsers } from './user-admin.controller.js'
import { changePassword, confirmEmailChange, getMe, requestEmailChange, updateMe } from './users.controller.js'

// Gắn tại /api/users. Route /me phải khai báo trước /:id để "me" không bị hiểu là id.
export const usersRouter = Router()
usersRouter.get('/me', authenticate, getMe)
usersRouter.patch('/me', authenticate, updateMe)
usersRouter.put('/me/password', authenticate, changePassword)
// note: FR-05 đổi email 2 bước (gửi OTP tới email mới → xác nhận), mọi role đều dùng được
usersRouter.post('/me/email-change', authenticate, requestEmailChange)
usersRouter.post('/me/email-change/confirm', authenticate, confirmEmailChange)

// FR-09: quản trị người dùng
const staffOnly = [authenticate, authorize('CENTER_MANAGER', 'RECEPTIONIST')]
usersRouter.get('/', ...staffOnly, listUsers)

// FR-06: chỉ Center Manager được khóa/mở khóa
const managerOnly = [authenticate, authorize('CENTER_MANAGER')]
usersRouter.patch('/:id/status', ...managerOnly, changeUserStatus)
