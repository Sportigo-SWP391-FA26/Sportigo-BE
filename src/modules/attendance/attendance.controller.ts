import { Request, Response, NextFunction } from 'express';
import attendanceService from './attendance.service.js';
import { getAuthUser } from '../../middleware/auth.js';

export class AttendanceController {
  async checkIn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId = Number(req.params.sessionId);
      const { id: markedById } = getAuthUser(req);
      const result = await attendanceService.checkInMember({
        ...req.body,
        sessionId,
        markedById,
      });
      res.status(200).json({ success: true, message: 'Điểm danh thành công', data: result });
    } catch (error: unknown) {
      next(error);
    }
  }

  async getAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId = Number(req.params.sessionId);
      const { id, role } = getAuthUser(req);
      const list = await attendanceService.getSessionAttendance(sessionId, id, role);
      res.status(200).json({ success: true, data: list });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new AttendanceController();