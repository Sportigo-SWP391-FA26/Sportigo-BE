import { Request, Response, NextFunction } from 'express';
import roomService from './room.service.js';

export class RoomController {
  async getRooms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rooms = await roomService.getAllRooms();
      res.status(200).json({ success: true, data: rooms });
    } catch (error: unknown) {
      next(error);
    }
  }

  async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const room = await roomService.createRoom(req.body);
      res.status(201).json({ success: true, message: 'Tạo phòng tập thành công', data: room });
    } catch (error: unknown) {
      next(error);
    }
  }

  async updateRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      const room = await roomService.updateRoom(id, req.body);
      res.status(200).json({ success: true, message: 'Cập nhật phòng thành công', data: room });
    } catch (error: unknown) {
      next(error);
    }
  }

  async deleteRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Number(req.params.id);
      await roomService.deleteRoom(id);
      res.status(200).json({ success: true, message: 'Xóa phòng thành công' });
    } catch (error: unknown) {
      next(error);
    }
  }
}

export default new RoomController();