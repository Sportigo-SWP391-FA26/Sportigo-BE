import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { assignPlan, listAssignments } from './plan-assignment.controller.js'

// Gắn tại /api/private-enrollments (dùng chung tiền tố với module khóa 1-1)
export const planAssignmentRouter = Router()
planAssignmentRouter.get(
  '/:id/plans',
  authenticate,
  authorize('COACH', 'MEMBER', 'CENTER_MANAGER'),
  listAssignments,
)
planAssignmentRouter.post(
  '/:id/plans',
  authenticate,
  authorize('COACH'),
  assignPlan,
)
