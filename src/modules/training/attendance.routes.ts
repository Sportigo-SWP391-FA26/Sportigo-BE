import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import {
  getSessionAttendance,
  listAttendance,
  markSessionAttendance,
} from './attendance.controller.js'

// Gắn tại /api/class-sessions (dùng chung tiền tố với module lịch học)
export const classSessionAttendanceRouter = Router()
classSessionAttendanceRouter.get(
  '/:id/attendance',
  authenticate,
  authorize('COACH', 'CENTER_MANAGER'),
  getSessionAttendance,
)
classSessionAttendanceRouter.put(
  '/:id/attendance',
  authenticate,
  authorize('COACH'),
  markSessionAttendance,
)

// Gắn tại /api/attendance
export const attendanceRouter = Router()
attendanceRouter.get(
  '/',
  authenticate,
  authorize('MEMBER', 'COACH', 'CENTER_MANAGER'),
  listAttendance,
)
