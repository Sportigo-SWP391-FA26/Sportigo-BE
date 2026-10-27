
import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import privateController from './private.controller.js';

const router = Router();

router.get(
  '/',
  authenticate,
  authorize('MEMBER', 'COACH', 'RECEPTIONIST', 'CENTER_MANAGER'),
  privateController.getCourses,
);
router.post(
  '/',
  authenticate,
  authorize('CENTER_MANAGER'),
  privateController.createCourse,
);
router.patch(
  '/:id',
  authenticate,
  authorize('CENTER_MANAGER'),
  privateController.updateCourse,
);
router.post(
  '/:id/coaches',
  authenticate,
  authorize('CENTER_MANAGER'),
  privateController.assignCoach,
);
router.delete(
  '/:id/coaches/:coachId',
  authenticate,
  authorize('CENTER_MANAGER'),
  privateController.unassignCoach,
);
router.post(
  '/:id/enroll',
  authenticate,
  authorize('MEMBER'),
  privateController.createEnrollment,
);

// Xem danh sách đăng ký: dữ liệu sẽ được lọc theo role trong service.
router.get(
  '/enrollments',
  authenticate,
  authorize('MEMBER', 'COACH', 'RECEPTIONIST', 'CENTER_MANAGER'),
  privateController.getEnrollments,
);

// Thành viên tự đăng ký khóa học cho tài khoản của mình.
router.post(
  '/enrollments',
  authenticate,
  authorize('MEMBER'),
  privateController.createEnrollment,
);
router.get(
  '/enrollments/:id',
  authenticate,
  authorize('MEMBER', 'COACH', 'RECEPTIONIST', 'CENTER_MANAGER'),
  privateController.getEnrollment,
);
router.post(
  '/enrollments/:id/schedules/:scheduleId/attendance',
  authenticate,
  authorize('COACH'),
  privateController.recordCompletedSession,
);
router.patch(
  '/enrollments/:id/schedules/:scheduleId/occurrences/:sessionDate',
  authenticate,
  authorize('MEMBER'),
  privateController.changeOccurrence,
);

// Thành viên chỉ được thêm lịch cho enrollment của chính mình.
router.post(
  '/enrollments/:id/schedules',
  authenticate,
  authorize('MEMBER'),
  privateController.addSchedule,
);
router.get(
  '/:id',
  authenticate,
  authorize('MEMBER', 'COACH', 'RECEPTIONIST', 'CENTER_MANAGER'),
  privateController.getCourse,
);

export default router;
