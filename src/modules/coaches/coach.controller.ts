import { Request, Response, NextFunction } from 'express';
import coachService from './coach.service.js';

export class CoachController {
  async addAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const coachId = Number(req.params.id);
      const availability = await coachService.addAvailability(coachId, req.body);
      res.status(201).json({ success: true, message: 'Thêm lịch khả dụng thành công', data: availability });
    } catch (error: unknown) {
      next(error);
    }
  }

  async getAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const coachId = Number(req.params.id);
      const list = await coachService.getCoachAvailability(coachId);
      res.status(200).json({ success: true, data: list });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new CoachController();