import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { createStaff, listStaff, updateStaff } from './staff.controller.js'

// FR-07: gắn tại /api/staff, mọi route chỉ Center Manager
export const staffRouter = Router()
staffRouter.use(authenticate, authorize('CENTER_MANAGER'))
staffRouter.get('/', listStaff)
staffRouter.post('/', createStaff)
staffRouter.patch('/:id', updateStaff)
