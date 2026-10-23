import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import paymentController from './payment.controller.js';

const router = Router();

router.post('/orders/:id/pay', authenticate, authorize('MEMBER'), paymentController.payOrder);

export default router;