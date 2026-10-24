import { Request, Response, NextFunction } from 'express';
import waitlistService from './waitlist.service.js';
import { getAuthUser } from '../../middleware/auth.js';

export class WaitlistController {
  // POST /api/group-classes/:id/waitlist (FR-25)
  async joinWaitlist(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id);
      const { id: memberId } = getAuthUser(req);

      const result = await waitlistService.joinWaitlist(memberId, classId);
      res.status(201).json({
        success: true,
        message: 'Đã thêm vào danh sách chờ (Waitlist) thành công.',
        data: result,
      });
    } catch (error: unknown) {
      next(error);
    }
  }

  async respondToOffer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id);
      const { id: memberId } = getAuthUser(req);
      const { accept } = req.body as { accept?: unknown };
      if (typeof accept !== 'boolean') {
        res.status(400).json({ success: false, message: 'accept phải là giá trị boolean.' });
        return;
      }

      const result = await waitlistService.respondToOffer(memberId, classId, accept);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new WaitlistController();