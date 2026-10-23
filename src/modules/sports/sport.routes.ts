import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import sportController from './sport.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'), sportController.getSports);
router.post('/', authorize('CENTER_MANAGER'), sportController.createSport);
router.put('/:id', authorize('CENTER_MANAGER'), sportController.updateSport);
router.delete('/:id', authorize('CENTER_MANAGER'), sportController.deleteSport);

export default router;