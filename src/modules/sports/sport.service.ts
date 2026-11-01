import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { ReadCache } from '../../lib/read-cache.js';

const sportsCache = new ReadCache(() => prisma.sport.findMany({ orderBy: { createdAt: 'desc' } }), 60_000);

export class SportService {
  async getAllSports() {
    return sportsCache.get();
  }

  async createSport(data: { name: string; description?: string; imageUrl?: string; isActive?: boolean }) {
    const existing = await prisma.sport.findUnique({ where: { name: data.name } });
    if (existing) {
      throw new HttpError(409, 'Tên môn thể thao đã tồn tại trong hệ thống.', 'SPORT_NAME_CONFLICT');
    }

    const created = await prisma.sport.create({
      data: {
        name: data.name,
        description: data.description,
        imageUrl: data.imageUrl,
        isActive: data.isActive ?? true,
      },
    });
    sportsCache.invalidate();
    return created;
  }

  async updateSport(id: number, data: { name?: string; description?: string; imageUrl?: string; isActive?: boolean }) {
    if (data.name) {
      const existing = await prisma.sport.findFirst({ where: { name: data.name, NOT: { id } } });
      if (existing) {
        throw new HttpError(409, 'Tên môn thể thao bị trùng với môn khác.', 'SPORT_NAME_CONFLICT');
      }
    }
    const updated = await prisma.sport.update({ where: { id }, data });
    sportsCache.invalidate();
    return updated;
  }

  async deleteSport(id: number) {
    const classCount = await prisma.groupClass.count({ where: { sportId: id } });
    const courseCount = await prisma.privateCourse.count({ where: { sportId: id } });

    if (classCount > 0 || courseCount > 0) {
      throw new HttpError(409, 'Không thể xóa môn thể thao này vì đang được sử dụng trong lớp nhóm hoặc khóa học 1-1.', 'SPORT_IN_USE');
    }
    const deleted = await prisma.sport.delete({ where: { id } });
    sportsCache.invalidate();
    return deleted;
  }
}

export default new SportService();
