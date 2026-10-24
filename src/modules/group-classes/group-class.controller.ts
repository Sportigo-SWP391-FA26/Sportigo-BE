import { Request, Response, NextFunction } from 'express';
import groupClassService from './group-class.service.js';
import { ClassStatus } from '@prisma/client';

export class GroupClassController {
  async getGroupClasses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classes = await groupClassService.getAllGroupClasses();
      res.status(200).json({ success: true, data: classes });
    } catch (error: unknown) {
      next(error);
    }
  }

  async createGroupClass(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const newClass = await groupClassService.createGroupClass(req.body);
      res.status(201).json({ success: true, message: 'Tạo bản nháp lớp nhóm thành công', data: newClass });
    } catch (error: unknown) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const { status } = req.body; // OPEN, CLOSED, CANCELLED...
      const updated = await groupClassService.updateClassStatus(id, status as ClassStatus);
      res.status(200).json({ success: true, message: 'Cập nhật trạng thái lớp thành công', data: updated });
    } catch (error: unknown) {
      next(error);
    }
  }

  async assignCoach(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const { coachId } = req.body;
      const updated = await groupClassService.assignCoach(id, Number(coachId));
      res.status(200).json({ success: true, message: 'Phân công Huấn luyện viên thành công', data: updated });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new GroupClassController();