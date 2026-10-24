import { Request, Response, NextFunction } from 'express';
import bookingService from './booking.service.js';
import { getAuthUser } from '../../middleware/auth.js';

export class BookingController {
  // GET /api/bookings/classes (FR-21)
  async getPublicClasses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await bookingService.getPublicClasses(req.query);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }

  // GET /api/bookings/classes/:id (FR-22)
  async getClassDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id);
      const detail = await bookingService.getClassDetail(classId);
      res.status(200).json({ success: true, data: detail });
    } catch (error: unknown) {
      next(error);
    }
  }

  // POST /api/bookings/classes/:id/register (FR-23, FR-24)
  async registerClass(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id);
      const { id: memberId } = getAuthUser(req);

      const orderResult = await bookingService.registerClass(memberId, classId);
      res.status(201).json({
        success: true,
        message: 'Đăng ký lớp nhóm thành công. Vui lòng hoàn tất thanh toán để xác nhận chỗ.',
        data: orderResult,
      });
    } catch (error: unknown) {
      next(error);
    }
  }

  async registerClassOnBehalf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id);
      const memberId = Number(req.body.memberId);
      if (!Number.isSafeInteger(memberId) || memberId <= 0) {
        res.status(400).json({ success: false, message: 'memberId không hợp lệ.' });
        return;
      }

      const result = await bookingService.registerClassOnBehalf(memberId, classId);
      res.status(201).json({
        success: true,
        message: 'Đăng ký lớp cho hội viên thành công.',
        data: result,
      });
    } catch (error: unknown) {
      next(error);
    }
  }

  // POST /api/class-registrations/:id/cancel (FR-28)
  async cancelRegistration(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const registrationId = Number(req.params.id);
      const user = getAuthUser(req);

      const result = await bookingService.cancelClassRegistration(registrationId, user);
      res.status(200).json({
        success: true,
        message: 'Hủy đăng ký lớp thành công',
        data: result,
      });
    } catch (error: unknown) {
      next(error);
    }
  }

  async cancelGroupClass(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id);
      const { id: actorUserId } = getAuthUser(req);
      const result = await bookingService.cancelGroupClass(classId, actorUserId);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new BookingController();