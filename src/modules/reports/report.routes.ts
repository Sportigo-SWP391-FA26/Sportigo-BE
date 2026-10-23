import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import reportController from './report.controller.js';

const router = Router();

router.get('/reports/revenue', authenticate, authorize('CENTER_MANAGER'), reportController.getRevenue);
router.get('/reports/attendance', authenticate, authorize('CENTER_MANAGER'), reportController.getAttendance);

export default router;