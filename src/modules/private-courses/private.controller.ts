
import type { Request, Response, NextFunction } from 'express';
import privateCourseService from './private.service.js';
import { getAuthUser } from '../../middleware/auth.js';

export class PrivateCourseController {
  async getCourse(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const course = await privateCourseService.getCourse(Number(req.params.id));
      res.status(200).json({ success: true, data: course });
    } catch (error: unknown) {
      next(error);
    }
  }

  async getCourses(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const sportId = req.query.sportId === undefined
        ? undefined
        : Number(req.query.sportId);
      const courses = await privateCourseService.listActiveCourses(sportId);
      res.status(200).json({ success: true, data: courses });
    } catch (error: unknown) {
      next(error);
    }
  }

  async createCourse(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const course = await privateCourseService.createCourse(req.body);
      res.status(201).json({ success: true, data: course });
    } catch (error: unknown) {
      next(error);
    }
  }

  async updateCourse(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const courseId = Number(req.params.id);
      const course = await privateCourseService.updateCourse(courseId, req.body);
      res.status(200).json({ success: true, data: course });
    } catch (error: unknown) {
      next(error);
    }
  }

  async assignCoach(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const courseId = Number(req.params.id);
      const { coachId, customPrice } = req.body;
      const assignment = await privateCourseService.assignCoach(
        courseId,
        Number(coachId),
        customPrice === undefined ? undefined : Number(customPrice),
      );
      res.status(200).json({ success: true, data: assignment });
    } catch (error: unknown) {
      next(error);
    }
  }

  async unassignCoach(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const courseId = Number(req.params.id);
      const coachId = Number(req.params.coachId);
      await privateCourseService.unassignCoach(courseId, coachId);
      res.status(200).json({ success: true, message: 'Đã ngừng phân công Coach.' });
    } catch (error: unknown) {
      next(error);
    }
  }

  async getEnrollments(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = getAuthUser(req);
      const list = await privateCourseService.getEnrollments(
        user.id,
        user.role,
      );

      res.status(200).json({ success: true, data: list });
    } catch (error: unknown) {
      next(error);
    }
  }

  async createEnrollment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = getAuthUser(req);
      const { coachId, privateCourseId: bodyCourseId, startDate, schedules } = req.body;
      const privateCourseId = req.params.id === undefined
        ? bodyCourseId
        : Number(req.params.id);

      if (
        !Number.isInteger(coachId) ||
        !Number.isInteger(privateCourseId) ||
        typeof startDate !== 'string' ||
        !Array.isArray(schedules)
      ) {
        res.status(400).json({
          success: false,
          message: 'Cần coachId, privateCourseId, startDate và danh sách schedules hợp lệ.',
        });
        return;
      }

      const enrollment = await privateCourseService.createEnrollment({
        memberId: user.id,
        coachId,
        privateCourseId,
        startDate,
        schedules,
      });

      res.status(201).json({
        success: true,
        message: 'Đăng ký khóa học cá nhân thành công.',
        data: enrollment,
      });
    } catch (error: unknown) {
      next(error);
    }
  }

  async getEnrollment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = getAuthUser(req);
      const enrollmentId = Number(req.params.id);
      const enrollment = await privateCourseService.getEnrollment(
        enrollmentId,
        user.id,
        user.role,
      );
      res.status(200).json({ success: true, data: enrollment });
    } catch (error: unknown) {
      next(error);
    }
  }

  async recordCompletedSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id: coachId } = getAuthUser(req);
      const scheduleId = Number(req.params.scheduleId);
      const { sessionDate } = req.body;
      if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0 || typeof sessionDate !== 'string') {
        res.status(400).json({ success: false, message: 'Lịch hoặc ngày buổi học không hợp lệ.' });
        return;
      }
      const result = await privateCourseService.recordCompletedSession(
        scheduleId,
        sessionDate,
        coachId,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }

  async changeOccurrence(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id: memberId } = getAuthUser(req);
      const { sessionDate } = req.params;
      if (typeof sessionDate !== 'string') {
        res.status(400).json({ success: false, message: 'Ngày buổi học không hợp lệ.' });
        return;
      }
      const result = await privateCourseService.changePrivateCourseOccurrence(
        Number(req.params.id),
        Number(req.params.scheduleId),
        sessionDate,
        memberId,
        req.body,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      next(error);
    }
  }

  async addSchedule(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const user = getAuthUser(req);
      const enrollmentId = Number(req.params.id);

      if (!Number.isSafeInteger(enrollmentId) || enrollmentId <= 0) {
        res.status(400).json({
          success: false,
          message: 'ID đăng ký không hợp lệ.',
        });
        return;
      }

      const schedule = await privateCourseService.addCourseSchedule(
        enrollmentId,
        req.body,
        user.id,
      );

      res.status(201).json({
        success: true,
        message: 'Thêm lịch cố định thành công.',
        data: schedule,
      });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new PrivateCourseController();
