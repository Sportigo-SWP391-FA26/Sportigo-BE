import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import waitlistController from './waitlist.controller.js';

const router = Router();
export const waitlistReadRouter = Router();

router.post('/:id/waitlist', authenticate, authorize('MEMBER'), waitlistController.joinWaitlist);
router.post('/:id/waitlist/respond', authenticate, authorize('MEMBER'), waitlistController.respondToOffer);

waitlistReadRouter.get('/me', authenticate, authorize('MEMBER'), waitlistController.getMyWaitlists);
waitlistReadRouter.get('/', authenticate, authorize('CENTER_MANAGER'), waitlistController.listWaitlists);
waitlistReadRouter.get('/:id/history', authenticate, authorize('CENTER_MANAGER'), waitlistController.getWaitlistHistory);

export default router;