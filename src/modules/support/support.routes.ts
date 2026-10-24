import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import { cancelSupportRequest, createSupportRequest, getSupportRequest, listSupportRequests, sendMessage } from './support.controller.js'

// Gắn tại /api/support-requests
export const supportRouter = Router()

// FR-55: phía Member (FR-56 sẽ thêm quyền cho Receptionist/Manager)
const memberOnly = [authenticate, authorize('MEMBER')]
supportRouter.post('/', ...memberOnly, createSupportRequest)
supportRouter.get('/', ...memberOnly, listSupportRequests)
supportRouter.get('/:id', ...memberOnly, getSupportRequest)
supportRouter.post('/:id/messages', ...memberOnly, sendMessage)
supportRouter.post('/:id/cancel', ...memberOnly, cancelSupportRequest)
