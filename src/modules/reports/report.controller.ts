import { Request, Response, NextFunction } from 'express';
import reportService from './report.service.js';

export class ReportController {
  // GET /api/reports/revenue
  async getRevenue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      const report = await reportService.getRevenueReport(startDate, endDate);
      res.status(200).json({ success: true, data: report });
    } catch (error: unknown) {
      next(error);
    }
  }

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