import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import {
  approveAdjustment,
  cancelShift,
  clockIn,
  clockOut,
  createShift,
  listAdjustments,
  listMyShifts,
  listShifts,
  rejectAdjustment,
  requestAdjustment,
  updateShift,
} from './staff-shift.controller.js'

// FR-67: gắn tại /api/staff-shifts
export const staffShiftRouter = Router()
const manager = authorize('CENTER_MANAGER')
const receptionist = authorize('RECEPTIONIST')

staffShiftRouter.use(authenticate)
// note: các đường dẫn cố định (/me, /adjustments) phải đứng trước /:id
staffShiftRouter.get('/me', receptionist, listMyShifts)
staffShiftRouter.get('/adjustments', manager, listAdjustments)
staffShiftRouter.post('/adjustments/:id/approve', manager, approveAdjustment)
staffShiftRouter.post('/adjustments/:id/reject', manager, rejectAdjustment)
staffShiftRouter.get('/', manager, listShifts)
staffShiftRouter.post('/', manager, createShift)
staffShiftRouter.patch('/:id', manager, updateShift)
staffShiftRouter.post('/:id/cancel', manager, cancelShift)
staffShiftRouter.post('/:id/clock-in', receptionist, clockIn)
staffShiftRouter.post('/:id/clock-out', receptionist, clockOut)
staffShiftRouter.post('/:id/adjustments', receptionist, requestAdjustment)
