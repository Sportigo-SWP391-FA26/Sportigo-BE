import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import attendanceController from './attendance.controller.js';

const router = Router();

router.get(
  '/sessions/:sessionId/attendance',
  authenticate,
  authorize('COACH', 'CENTER_MANAGER'),
  attendanceController.getAttendance,
);
router.post(
  '/sessions/:sessionId/check-in',
  authenticate,
  authorize('COACH'),
  attendanceController.checkIn,
);

export default router;