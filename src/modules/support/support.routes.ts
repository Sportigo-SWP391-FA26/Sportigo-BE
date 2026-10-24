import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import {
  cancelSupportRequest,
  createSupportRequest,
  getSupportRequest,
  listSupportRequests,
  sendMessage,
  updateSupportRequest,
} from './support.controller.js'

// Gắn tại /api/support-requests
export const supportRouter = Router()

const memberOnly = [authenticate, authorize('MEMBER')]
// FR-56: Receptionist xử lý, Manager giám sát/giao việc
const staffOnly = [authenticate, authorize('RECEPTIONIST', 'CENTER_MANAGER')]
const memberOrStaff = [authenticate, authorize('MEMBER', 'RECEPTIONIST', 'CENTER_MANAGER')]

supportRouter.post('/', ...memberOnly, createSupportRequest)
supportRouter.get('/', ...memberOrStaff, listSupportRequests)
supportRouter.get('/:id', ...memberOrStaff, getSupportRequest)
supportRouter.patch('/:id', ...staffOnly, updateSupportRequest)
supportRouter.post('/:id/messages', ...memberOrStaff, sendMessage)
supportRouter.post('/:id/cancel', ...memberOnly, cancelSupportRequest)
