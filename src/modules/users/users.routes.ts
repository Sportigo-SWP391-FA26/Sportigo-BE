import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { listUsers } from './user-admin.controller.js'
import { changePassword, getMe, updateMe } from './users.controller.js'

// Gắn tại /api/users. Route /me phải khai báo trước /:id để "me" không bị hiểu là id.
export const usersRouter = Router()
usersRouter.get('/me', authenticate, getMe)
usersRouter.patch('/me', authenticate, updateMe)
usersRouter.put('/me/password', authenticate, changePassword)

// FR-09: quản trị người dùng
const staffOnly = [authenticate, authorize('CENTER_MANAGER', 'RECEPTIONIST')]
usersRouter.get('/', ...staffOnly, listUsers)
