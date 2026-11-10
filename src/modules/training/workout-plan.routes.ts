import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { requirePlanSport } from './workout-plan-access.js'
import {
  changePlanStatus,
  createPlan,
  deletePlan,
  getPlan,
  listPlans,
  updatePlan,
} from './workout-plan.controller.js'

// Giáo án dùng chung: mọi Coach được tạo và sửa, Center Manager chỉ xem.
const canRead = [authenticate, authorize('COACH', 'CENTER_MANAGER')]
const coachOnly = [authenticate, authorize('COACH')]

// Gắn tại /api/workout-plans
export const workoutPlanRouter = Router()
workoutPlanRouter.get('/', ...canRead, listPlans)
workoutPlanRouter.post('/', ...coachOnly, createPlan)
workoutPlanRouter.get('/:id', ...canRead, requirePlanSport, getPlan)
workoutPlanRouter.patch('/:id', ...coachOnly, requirePlanSport, updatePlan)
workoutPlanRouter.patch('/:id/status', ...coachOnly, requirePlanSport, changePlanStatus)
workoutPlanRouter.delete('/:id', ...coachOnly, requirePlanSport, deletePlan)
