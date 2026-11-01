import { RoomStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { ReadCache } from '../../lib/read-cache.js';

const roomsCache = new ReadCache(() => prisma.room.findMany({ orderBy: { createdAt: 'desc' } }), 60_000);

export class RoomService {
  async getAllRooms() {
    return roomsCache.get();
  }

  async createRoom(data: { code: string; name: string; capacity: number; location?: string; status?: RoomStatus }) {
    if (data.capacity <= 0) {
      throw new HttpError(400, 'Sức chứa của phòng phải lớn hơn 0.', 'INVALID_ROOM_CAPACITY');
    }

    const existing = await prisma.room.findUnique({ where: { code: data.code } });
    if (existing) {
      throw new HttpError(409, 'Mã phòng (Room Code) đã tồn tại.', 'ROOM_CODE_CONFLICT');
    }

    const created = await prisma.room.create({
      data: {
        code: data.code,
        name: data.name,
        capacity: data.capacity,
        location: data.location,
        status: data.status || RoomStatus.AVAILABLE,
      },
    });
    roomsCache.invalidate();
    return created;
  }

  async updateRoom(id: number, data: { name?: string; capacity?: number; location?: string; status?: RoomStatus }) {
    if (data.capacity !== undefined && data.capacity <= 0) {
      throw new HttpError(400, 'Sức chứa của phòng phải lớn hơn 0.', 'INVALID_ROOM_CAPACITY');
    }
    const updated = await prisma.room.update({ where: { id }, data });
    roomsCache.invalidate();
    return updated;
  }

  async deleteRoom(id: number) {
    const activeSessions = await prisma.classSession.count({
      where: { roomId: id, status: 'SCHEDULED' },
    });
    if (activeSessions > 0) {
      throw new HttpError(409, 'Không thể xóa phòng đang có lịch học sắp diễn ra.', 'ROOM_HAS_SCHEDULED_SESSIONS');
    }
    const deleted = await prisma.room.delete({ where: { id } });
    roomsCache.invalidate();
    return deleted;
  }
}

export default new RoomService();
