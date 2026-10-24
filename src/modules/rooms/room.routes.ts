import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import roomController from './room.controller.js';

const router = Router();

router.use(authenticate);
router.get('/', authorize('CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'), roomController.getRooms);
router.post('/', authorize('CENTER_MANAGER'), roomController.createRoom);
router.put('/:id', authorize('CENTER_MANAGER'), roomController.updateRoom);
router.delete('/:id', authorize('CENTER_MANAGER'), roomController.deleteRoom);

export default router;