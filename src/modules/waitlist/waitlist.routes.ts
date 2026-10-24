import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import waitlistController from './waitlist.controller.js';

const router = Router();

router.post('/:id/waitlist', authenticate, authorize('MEMBER'), waitlistController.joinWaitlist);
router.post('/:id/waitlist/respond', authenticate, authorize('MEMBER'), waitlistController.respondToOffer);

export default router;