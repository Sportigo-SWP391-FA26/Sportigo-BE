import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import bookingController from './booking.controller.js';

const router = Router();

router.get('/classes', bookingController.getPublicClasses);
router.get('/classes/:id', bookingController.getClassDetail);
router.post('/classes/:id/register', authenticate, authorize('MEMBER'), bookingController.registerClass);
router.post('/registrations/:id/cancel', authenticate, authorize('MEMBER', 'RECEPTIONIST'), bookingController.cancelRegistration);

export default router;