
import { Router } from 'express';
import sessionController from './session.controller.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();

router.post('/', authenticate, authorize('CENTER_MANAGER'), sessionController.createSession);

// FR-20: Chỉ Center Manager đã đăng nhập được đổi lịch.
router.post(
  '/:id/change',
  authenticate,
  authorize('CENTER_MANAGER'),
  sessionController.changeSession
);

export default router;
