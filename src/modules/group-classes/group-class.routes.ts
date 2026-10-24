import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import bookingController from '../bookings/booking.controller.js';
import sessionController from '../class-sessions/session.controller.js';
import groupClassController from './group-class.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', authorize('CENTER_MANAGER'), groupClassController.getGroupClasses);
router.post('/', authorize('CENTER_MANAGER'), groupClassController.createGroupClass);
router.patch('/:id/status', authorize('CENTER_MANAGER'), groupClassController.updateStatus);
router.patch('/:id/coach', authorize('CENTER_MANAGER'), groupClassController.assignCoach);
router.get(
  '/:id/sessions',
  authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'),
  sessionController.getClassSessions,
);
router.post(
  '/:id/sessions/recurring',
  authorize('CENTER_MANAGER'),
  sessionController.createRecurringSessions,
);
router.post('/:id/sessions', authorize('CENTER_MANAGER'), sessionController.createSession);
router.post('/:id/cancel', authorize('CENTER_MANAGER'), bookingController.cancelGroupClass);
router.post(
  '/:id/register-on-behalf',
  authorize('RECEPTIONIST'),
  bookingController.registerClassOnBehalf,
);

export default router;