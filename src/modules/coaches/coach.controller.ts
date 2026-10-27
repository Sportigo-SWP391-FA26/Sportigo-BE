import { Request, Response, NextFunction } from 'express';
import coachService from './coach.service.js';
import { getAuthUser } from '../../middleware/auth.js';

export class CoachController {
  async listSports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sports = await coachService.listCoachSports(Number(req.params.id));
      res.status(200).json({ success: true, data: sports });
    } catch (error: unknown) {
      next(error);
    }
  }

  async addSport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const qualification = await coachService.addCoachSport(
        Number(req.params.id),
        Number(req.body.sportId),
        getAuthUser(req).id,
      );
      res.status(201).json({ success: true, data: qualification });
    } catch (error: unknown) {
      next(error);
    }
  }

  async removeSport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await coachService.removeCoachSport(
        Number(req.params.id),
        Number(req.params.sportId),
        getAuthUser(req).id,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }

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

  async getSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { from, to } = req.query;
      if (typeof from !== 'string' || typeof to !== 'string') {
        res.status(400).json({ success: false, message: 'Cần truyền from và to theo định dạng YYYY-MM-DD.' });
        return;
      }
      const user = getAuthUser(req);
      if (user.role === 'COACH' && user.id !== Number(req.params.id)) {
        res.status(403).json({ success: false, message: 'Coach chỉ được xem lịch của chính mình.' });
        return;
      }
      const schedule = await coachService.getCoachSchedule(Number(req.params.id), from, to);
      res.status(200).json({ success: true, data: schedule });
    } catch (error: unknown) {
      next(error);
    }
  }

  async updateAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const availability = await coachService.updateAvailability(
        Number(req.params.id),
        Number(req.params.availabilityId),
        req.body,
        getAuthUser(req).id,
      );
      res.status(200).json({ success: true, data: availability });
    } catch (error: unknown) {
      next(error);
    }
  }

  async deleteAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await coachService.deleteAvailability(
        Number(req.params.id),
        Number(req.params.availabilityId),
        getAuthUser(req).id,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new CoachController();