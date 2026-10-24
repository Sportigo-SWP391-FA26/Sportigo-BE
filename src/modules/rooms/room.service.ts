import { PrismaClient, RoomStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';

const prisma = new PrismaClient();

export class RoomService {
  async getAllRooms() {
    return await prisma.room.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createRoom(data: { code: string; name: string; capacity: number; location?: string; status?: RoomStatus }) {
    if (data.capacity <= 0) {
      throw new HttpError(400, 'Sức chứa của phòng phải lớn hơn 0.', 'INVALID_ROOM_CAPACITY');
    }

    const existing = await prisma.room.findUnique({ where: { code: data.code } });
    if (existing) {
      throw new HttpError(409, 'Mã phòng (Room Code) đã tồn tại.', 'ROOM_CODE_CONFLICT');
    }

    return await prisma.room.create({
      data: {
        code: data.code,
        name: data.name,
        capacity: data.capacity,
        location: data.location,
        status: data.status || RoomStatus.AVAILABLE,
      },
    });
  }

  async updateRoom(id: number, data: { name?: string; capacity?: number; location?: string; status?: RoomStatus }) {
    if (data.capacity !== undefined && data.capacity <= 0) {
      throw new HttpError(400, 'Sức chứa của phòng phải lớn hơn 0.', 'INVALID_ROOM_CAPACITY');
    }
    return await prisma.room.update({ where: { id }, data });
  }

  async deleteRoom(id: number) {
    const activeSessions = await prisma.classSession.count({
      where: { roomId: id, status: 'SCHEDULED' },
    });
    if (activeSessions > 0) {
      throw new HttpError(409, 'Không thể xóa phòng đang có lịch học sắp diễn ra.', 'ROOM_HAS_SCHEDULED_SESSIONS');
    }
    return await prisma.room.delete({ where: { id } });
  }
}

export default new RoomService();