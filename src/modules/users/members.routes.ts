import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { createMember } from './members.controller.js'

// Gắn tại /api/members. FR-10 sẽ thêm GET /:id vào router này.
export const membersRouter = Router()

// FR-08: tạo hội viên tại quầy
membersRouter.post('/', authenticate, authorize('RECEPTIONIST', 'CENTER_MANAGER'), createMember)
