import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { createMember, getMemberProfile } from './members.controller.js'

// Gắn tại /api/members
export const membersRouter = Router()

// FR-08: tạo hội viên tại quầy
membersRouter.post('/', authenticate, authorize('RECEPTIONIST', 'CENTER_MANAGER'), createMember)

// FR-10: hồ sơ tổng hợp; Coach bị giới hạn trong service
membersRouter.get('/:id', authenticate, authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH'), getMemberProfile)
