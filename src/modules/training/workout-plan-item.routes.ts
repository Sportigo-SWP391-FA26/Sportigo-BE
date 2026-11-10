import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { requirePlanSport } from './workout-plan-access.js'
import {
  createItem,
  deleteItem,
  listItems,
  reorderItems,
  updateItem,
} from './workout-plan-item.controller.js'

const canRead = [authenticate, authorize('COACH', 'CENTER_MANAGER'), requirePlanSport]
const coachOnly = [authenticate, authorize('COACH'), requirePlanSport]

// Gắn tại /api/workout-plans/:id/items; mergeParams để đọc được :id
export const workoutPlanItemRouter = Router({ mergeParams: true })
workoutPlanItemRouter.get('/', ...canRead, listItems)
workoutPlanItemRouter.post('/', ...coachOnly, createItem)
// Khai báo /reorder trước /:itemId để "reorder" không bị hiểu là itemId
workoutPlanItemRouter.patch('/reorder', ...coachOnly, reorderItems)
workoutPlanItemRouter.patch('/:itemId', ...coachOnly, updateItem)
workoutPlanItemRouter.delete('/:itemId', ...coachOnly, deleteItem)
