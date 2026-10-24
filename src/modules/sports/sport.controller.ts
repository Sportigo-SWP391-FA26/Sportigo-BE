import { Request, Response, NextFunction } from 'express';
import sportService from './sport.service.js';

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
      const sport = await sportService.createSport(req.body);
      res.status(201).json({ success: true, message: 'Tạo môn thể thao thành công', data: sport });
    } catch (error: unknown) {
      next(error);
    }
  }

  async updateSport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const sport = await sportService.updateSport(id, req.body);
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