import { Request, Response, NextFunction } from 'express';
import reportService from './report.service.js';

export class ReportController {
  // GET /api/reports/attendance
  async getAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { classId } = req.query as { classId?: string };
      const report = await reportService.getAttendanceReport(classId ? Number(classId) : undefined);
      res.status(200).json({ success: true, data: report });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new ReportController();
