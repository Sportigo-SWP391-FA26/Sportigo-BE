import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { changePassword, getMe, updateMe } from './users.controller.js'

// Gắn tại /api/users. Route /me phải khai báo trước /:id (FR-06, FR-09) để "me" không bị hiểu là id.
export const usersRouter = Router()
usersRouter.get('/me', authenticate, getMe)
usersRouter.patch('/me', authenticate, updateMe)
usersRouter.put('/me/password', authenticate, changePassword)
