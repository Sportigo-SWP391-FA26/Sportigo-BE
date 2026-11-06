import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import {
  createAssessment,
  listAssessableSessions,
  listAssessments,
} from './progress-assessment.controller.js'

// Gắn tại /api/progress-assessments
export const progressAssessmentRouter = Router()
progressAssessmentRouter.get(
  '/assessable-sessions',
  authenticate,
  authorize('COACH'),
  listAssessableSessions,
)
progressAssessmentRouter.get(
  '/',
  authenticate,
  authorize('COACH', 'CENTER_MANAGER'),
  listAssessments,
)
progressAssessmentRouter.post(
  '/',
  authenticate,
  authorize('COACH'),
  createAssessment,
)

export const coachAssessmentRouter = Router()
coachAssessmentRouter.get('/assessable-sessions', authenticate, authorize('COACH'), listAssessableSessions)
