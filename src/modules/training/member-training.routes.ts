import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { getMyTraining } from './member-training.controller.js'

// Gắn tại /api/members/me/training. Chỉ đọc: Member không có endpoint sửa.
export const memberTrainingRouter = Router()
memberTrainingRouter.get('/', authenticate, authorize('MEMBER'), getMyTraining)
