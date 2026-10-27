import { Request, Response, NextFunction } from 'express'
import sessionService from './session.service.js'
import { getAuthUser } from '../../middleware/auth.js';

export class SessionController {
  async createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = req.params.id === undefined
        ? req.body.classId
        : Number(req.params.id)
      const sessions = Array.isArray(req.body.sessions)
        ? await sessionService.createSessions(classId, req.body.sessions)
        : await sessionService.createSession({ ...req.body, classId })
      res
        .status(201)
        .json({
          success: true,
          message: 'Tạo buổi học thành công',
          data: sessions,
        })
    } catch (error: unknown) {
      next(error)
    }
  }

  async createRecurringSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id)
      const sessions = await sessionService.createRecurringSessions(classId, req.body)
      res.status(201).json({
        success: true,
        message: 'Đã tạo các buổi học theo lịch lặp.',
        data: sessions,
      })
    } catch (error: unknown) {
      next(error)
    }
  }

  async getClassSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const classId = Number(req.params.id)
      const sessions = await sessionService.getClassSessions(classId)
      res.status(200).json({ success: true, data: sessions })
    } catch (error: unknown) {
      next(error)
    }
  }

  async changeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId = Number(req.params.id)
      // Giả định middleware auth đã gắn thông tin user vào req.user (ví dụ req.user.id)
      const user = req.user

      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Bạn cần đăng nhập để đổi lịch buổi học.',
        })
        return
      }

   
      const changedById = getAuthUser(req).id;
      const updated = await sessionService.changeSession(
        sessionId,
        changedById,
        req.body,
      )
      res
        .status(200)
        .json({
          success: true,
          message: 'Đổi lịch buổi học thành công',
          data: updated,
        })
    } catch (error: unknown) {
      next(error)
    }
  }

  async cancelSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessionId = Number(req.params.id)
      const actorId = getAuthUser(req).id
      const { reason } = req.body as { reason?: unknown }
      if (typeof reason !== 'string' || !reason.trim()) {
        res.status(400).json({ success: false, message: 'Lý do hủy buổi học là bắt buộc.' })
        return
      }
      const cancelled = await sessionService.cancelSession(sessionId, actorId, reason)
      res.status(200).json({ success: true, data: cancelled })
    } catch (error: unknown) {
      next(error)
    }
  }
}

export default new SessionController()
