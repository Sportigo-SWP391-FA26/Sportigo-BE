import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { assignSubstitute, listCandidates, listSessionCoaches, resetCoach } from './session-coach.controller.js'

// FR-66: gắn tại /api/session-coaches, chỉ Center Manager
export const sessionCoachRouter = Router()
sessionCoachRouter.use(authenticate, authorize('CENTER_MANAGER'))
sessionCoachRouter.get('/', listSessionCoaches)
sessionCoachRouter.get('/:sessionId/candidates', listCandidates)
sessionCoachRouter.put('/:sessionId/substitute', assignSubstitute)
sessionCoachRouter.delete('/:sessionId/substitute', resetCoach)
