import { PrismaClient, AvailabilityStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';

const prisma = new PrismaClient();

export class CoachService {
  // Thêm lịch khả dụng (Chặn chồng chéo thời gian - FR-14)
  async addAvailability(
    coachId: number,
    data: { dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string; effectiveTo?: string }
  ) {
    if (!Number.isInteger(data.dayOfWeek) || data.dayOfWeek < 0 || data.dayOfWeek > 6) {
      throw new HttpError(400, 'Ngày trong tuần phải nằm trong khoảng 0 đến 6.', 'INVALID_DAY_OF_WEEK');
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.startTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.endTime)) {
      throw new HttpError(400, 'Giờ khả dụng phải có định dạng HH:mm.', 'INVALID_AVAILABILITY_TIME');
    }
    const startDateTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    const endDateTime = new Date(`1970-01-01T${data.endTime}:00Z`);

    if (startDateTime >= endDateTime) {
      throw new HttpError(400, 'Thời gian kết thúc phải lớn hơn thời gian bắt đầu.', 'INVALID_TIME_RANGE');
    }
    const effectiveFrom = new Date(data.effectiveFrom);
    const effectiveTo = data.effectiveTo ? new Date(data.effectiveTo) : null;
    if (
      !Number.isFinite(effectiveFrom.getTime()) ||
      (effectiveTo && (!Number.isFinite(effectiveTo.getTime()) || effectiveTo < effectiveFrom))
    ) {
      throw new HttpError(400, 'Khoảng ngày hiệu lực không hợp lệ.', 'INVALID_EFFECTIVE_DATE_RANGE');
    }

    const existingSlots = await prisma.coachAvailability.findMany({
      where: {
        coachId,
        dayOfWeek: data.dayOfWeek,
        status: AvailabilityStatus.AVAILABLE,
      },
    });

    for (const slot of existingSlots) {
      const existingStart = new Date(`1970-01-01T${slot.startTime.toISOString().substring(11, 19)}Z`);
      const existingEnd = new Date(`1970-01-01T${slot.endTime.toISOString().substring(11, 19)}Z`);

      // Kiểm tra giao nhau giữa 2 khoảng thời gian
      const existingFrom = slot.effectiveFrom
        ? new Date(slot.effectiveFrom)
        : effectiveFrom;
      const existingTo = slot.effectiveTo
        ? new Date(slot.effectiveTo)
        : null;
      const datesOverlap =
        (!effectiveTo || existingFrom <= effectiveTo) &&
        (!existingTo || existingTo >= effectiveFrom);
      if (datesOverlap && startDateTime < existingEnd && endDateTime > existingStart) {
        throw new HttpError(409, 'Khoảng thời gian khả dụng bị chồng chéo với lịch đã tồn tại.', 'AVAILABILITY_CONFLICT');
      }
    }

    return await prisma.coachAvailability.create({
      data: {
        coachId,
        dayOfWeek: data.dayOfWeek,
        startTime: startDateTime,
        endTime: endDateTime,
        effectiveFrom,
        effectiveTo,
      },
    });
  }

  async isAvailableForSession(coachId: number, startsAt: Date, endsAt: Date) {
    if (startsAt.toISOString().slice(0, 10) !== endsAt.toISOString().slice(0, 10)) {
      return false;
    }
    const sessionDate = new Date(Date.UTC(
      startsAt.getUTCFullYear(),
      startsAt.getUTCMonth(),
      startsAt.getUTCDate(),
    ));
    const dayOfWeek = startsAt.getUTCDay();
    const availabilities = await prisma.coachAvailability.findMany({
      where: {
        coachId,
        dayOfWeek,
        status: AvailabilityStatus.AVAILABLE,
        effectiveFrom: { lte: sessionDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: sessionDate } }],
      },
    });
    const timeStart = new Date(`1970-01-01T${startsAt.toISOString().slice(11, 19)}Z`);
    const timeEnd = new Date(`1970-01-01T${endsAt.toISOString().slice(11, 19)}Z`);
    return availabilities.some((slot) => {
      const availableStart = new Date(`1970-01-01T${slot.startTime.toISOString().slice(11, 19)}Z`);
      const availableEnd = new Date(`1970-01-01T${slot.endTime.toISOString().slice(11, 19)}Z`);
      return timeStart >= availableStart && timeEnd <= availableEnd;
    });
  }

  async getCoachAvailability(coachId: number) {
    return await prisma.coachAvailability.findMany({
      where: { coachId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }
}

export default new CoachService();