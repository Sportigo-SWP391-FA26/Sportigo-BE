import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import sportService from './sport.service.js';

const passingScoreSchema = z.object({ passingScore: z.number().min(0).max(100).nullable().optional() });
const withValidScore = (body: Request['body']) => ({ ...body, ...passingScoreSchema.parse(body) });

export class SportController {
  async getSports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sports = await sportService.getAllSports();
      res.status(200).json({ success: true, data: sports });
    } catch (error: unknown) {
      next(error);
    }
  }

  async createSport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sport = await sportService.createSport(withValidScore(req.body));
      res.status(201).json({ success: true, message: 'Tạo môn thể thao thành công', data: sport });
    } catch (error: unknown) {
      next(error);
    }
  }

  async updateSport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const sport = await sportService.updateSport(id, withValidScore(req.body));
      res.status(200).json({ success: true, message: 'Cập nhật thành công', data: sport });
    } catch (error: unknown) {
      next(error);
    }
  }

  async deleteSport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      await sportService.deleteSport(id);
      res.status(200).json({ success: true, message: 'Xóa môn thể thao thành công' });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new SportController();