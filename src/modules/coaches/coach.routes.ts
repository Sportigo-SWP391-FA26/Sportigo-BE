import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import coachController from './coach.controller.js';

const router = Router();

router.use(authenticate);
router.get('/:id/sports', authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'), coachController.listSports);
router.post('/:id/sports', authorize('CENTER_MANAGER'), coachController.addSport);
router.delete('/:id/sports/:sportId', authorize('CENTER_MANAGER'), coachController.removeSport);
router.get('/:id/schedule', authorize('CENTER_MANAGER', 'COACH'), coachController.getSchedule);
router.get('/:id/availability', authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'), coachController.getAvailability);
router.post('/:id/availability', authorize('CENTER_MANAGER'), coachController.addAvailability);
router.put('/:id/availability/:availabilityId', authorize('CENTER_MANAGER'), coachController.updateAvailability);
router.delete('/:id/availability/:availabilityId', authorize('CENTER_MANAGER'), coachController.deleteAvailability);

export default router;