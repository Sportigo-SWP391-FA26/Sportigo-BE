import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import coachController from './coach.controller.js';

const router = Router();

router.use(authenticate);
router.get('/:id/availability', authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'), coachController.getAvailability);
router.post('/:id/availability', authorize('CENTER_MANAGER'), coachController.addAvailability);

export default router;