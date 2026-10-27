import { PrismaClient, AvailabilityStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { audit } from '../../lib/audit.js';

const prisma = new PrismaClient();

type ScheduleExceptionWithRoom = {
  sessionDate: Date;
  action: 'CANCELLED' | 'RESCHEDULED';
  rescheduledStartsAt: Date | null;
  rescheduledEndsAt: Date | null;
  newRoom: object | null;
};

export class CoachService {
  async listCoachSports(coachId: number) {
    const coach = await prisma.coach.findUnique({
      where: { userId: coachId },
      include: { coachSports: { include: { sport: true }, orderBy: { sportId: 'asc' } } },
    });
    if (!coach) throw new HttpError(404, 'Không tìm thấy Coach.', 'COACH_NOT_FOUND');
    return coach.coachSports.map((qualification) => qualification.sport);
  }

  async addCoachSport(coachId: number, sportId: number, actorId: number) {
    const [coach, sport] = await Promise.all([
      prisma.coach.findUnique({ where: { userId: coachId } }),
      prisma.sport.findUnique({ where: { id: sportId } }),
    ]);
    if (!coach) throw new HttpError(404, 'Không tìm thấy Coach.', 'COACH_NOT_FOUND');
    if (!sport || !sport.isActive) {
      throw new HttpError(409, 'Môn thể thao không tồn tại hoặc không hoạt động.', 'SPORT_INACTIVE');
    }

    return prisma.$transaction(async (tx) => {
      const qualification = await tx.coachSport.upsert({
        where: { coachId_sportId: { coachId, sportId } },
        create: { coachId, sportId },
        update: {},
      });
      await audit(tx, {
        actorId,
        action: 'COACH_SPORT_ASSIGNED',
        entityType: 'COACH_SPORT',
        entityId: `${coachId}:${sportId}`,
        newData: { coachId, sportId },
      });
      return qualification;
    });
  }

  async removeCoachSport(coachId: number, sportId: number, actorId: number) {
    const qualification = await prisma.coachSport.findUnique({
      where: { coachId_sportId: { coachId, sportId } },
    });
    if (!qualification) {
      throw new HttpError(404, 'Không tìm thấy chuyên môn của Coach.', 'COACH_SPORT_NOT_FOUND');
    }

    return prisma.$transaction(async (tx) => {
      await tx.coachSport.delete({ where: { coachId_sportId: { coachId, sportId } } });
      await audit(tx, {
        actorId,
        action: 'COACH_SPORT_REMOVED',
        entityType: 'COACH_SPORT',
        entityId: `${coachId}:${sportId}`,
        oldData: { coachId, sportId },
      });
      return { coachId, sportId, removed: true };
    });
  }

  private validateAvailabilityInput(data: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }) {
    if (!Number.isInteger(data.dayOfWeek) || data.dayOfWeek < 0 || data.dayOfWeek > 6) {
      throw new HttpError(400, 'Ngày trong tuần phải nằm trong khoảng 0 đến 6.', 'INVALID_DAY_OF_WEEK');
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.startTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.endTime)) {
      throw new HttpError(400, 'Giờ khả dụng phải có định dạng HH:mm.', 'INVALID_AVAILABILITY_TIME');
    }
    const startTime = new Date(`1970-01-01T${data.startTime}:00Z`);
    const endTime = new Date(`1970-01-01T${data.endTime}:00Z`);
    if (startTime >= endTime) {
      throw new HttpError(400, 'Thời gian kết thúc phải lớn hơn thời gian bắt đầu.', 'INVALID_TIME_RANGE');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.effectiveFrom)) {
      throw new HttpError(400, 'Ngày bắt đầu hiệu lực không hợp lệ.', 'INVALID_EFFECTIVE_DATE_RANGE');
    }
    const effectiveFrom = new Date(`${data.effectiveFrom}T00:00:00.000Z`);
    const effectiveTo = data.effectiveTo
      ? new Date(`${data.effectiveTo}T00:00:00.000Z`)
      : null;
    if (
      !Number.isFinite(effectiveFrom.getTime()) ||
      effectiveFrom.toISOString().slice(0, 10) !== data.effectiveFrom ||
      (data.effectiveTo != null &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(data.effectiveTo) ||
          !effectiveTo ||
          !Number.isFinite(effectiveTo.getTime()) ||
          effectiveTo.toISOString().slice(0, 10) !== data.effectiveTo ||
          effectiveTo < effectiveFrom))
    ) {
      throw new HttpError(400, 'Khoảng ngày hiệu lực không hợp lệ.', 'INVALID_EFFECTIVE_DATE_RANGE');
    }
    return { startTime, endTime, effectiveFrom, effectiveTo };
  }

  private async assertNoAvailabilityConflict(
    coachId: number,
    data: { dayOfWeek: number; startTime: Date; endTime: Date; effectiveFrom: Date; effectiveTo: Date | null },
    excludeId?: number,
  ) {
    const existingSlots = await prisma.coachAvailability.findMany({
      where: {
        coachId,
        dayOfWeek: data.dayOfWeek,
        status: AvailabilityStatus.AVAILABLE,
        id: excludeId ? { not: excludeId } : undefined,
      },
    });

    for (const slot of existingSlots) {
      const existingStart = new Date(`1970-01-01T${slot.startTime.toISOString().substring(11, 19)}Z`);
      const existingEnd = new Date(`1970-01-01T${slot.endTime.toISOString().substring(11, 19)}Z`);
      const existingFrom = new Date(slot.effectiveFrom);
      const existingTo = slot.effectiveTo ? new Date(slot.effectiveTo) : null;
      const datesOverlap =
        (!data.effectiveTo || existingFrom <= data.effectiveTo) &&
        (!existingTo || existingTo >= data.effectiveFrom);
      if (datesOverlap && data.startTime < existingEnd && data.endTime > existingStart) {
        throw new HttpError(409, 'Khoảng thời gian khả dụng bị chồng chéo với lịch đã tồn tại.', 'AVAILABILITY_CONFLICT');
      }
    }
  }

  // FR-14: Thêm lịch khả dụng, không cho phép trùng các khung đang hiệu lực.
  async addAvailability(
    coachId: number,
    data: { dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string; effectiveTo?: string }
  ) {
    const values = this.validateAvailabilityInput(data);
    const coach = await prisma.coach.findUnique({ where: { userId: coachId } });
    if (!coach) throw new HttpError(404, 'Không tìm thấy Coach.', 'COACH_NOT_FOUND');
    await this.assertNoAvailabilityConflict(coachId, { ...data, ...values });
    return prisma.coachAvailability.create({
      data: {
        coachId,
        dayOfWeek: data.dayOfWeek,
        ...values,
      },
    });
  }

  async updateAvailability(
    coachId: number,
    availabilityId: number,
    data: { dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string; effectiveTo?: string | null },
    actorId: number,
  ) {
    const current = await prisma.coachAvailability.findFirst({
      where: { id: availabilityId, coachId },
    });
    if (!current) throw new HttpError(404, 'Không tìm thấy lịch khả dụng.', 'AVAILABILITY_NOT_FOUND');
    const values = this.validateAvailabilityInput(data);
    await this.assertNoAvailabilityConflict(coachId, { ...data, ...values }, availabilityId);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.coachAvailability.update({
        where: { id: availabilityId },
        data: { dayOfWeek: data.dayOfWeek, ...values },
      });
      await audit(tx, {
        actorId,
        action: 'COACH_AVAILABILITY_UPDATED',
        entityType: 'COACH_AVAILABILITY',
        entityId: availabilityId,
        oldData: current,
        newData: updated,
      });
      return updated;
    });
  }

  async deleteAvailability(coachId: number, availabilityId: number, actorId: number) {
    const current = await prisma.coachAvailability.findFirst({
      where: { id: availabilityId, coachId },
    });
    if (!current) throw new HttpError(404, 'Không tìm thấy lịch khả dụng.', 'AVAILABILITY_NOT_FOUND');
    if (current.status === AvailabilityStatus.UNAVAILABLE) {
      throw new HttpError(409, 'Lịch khả dụng đã được ngừng trước đó.', 'AVAILABILITY_ALREADY_INACTIVE');
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.coachAvailability.update({
        where: { id: availabilityId },
        data: { status: AvailabilityStatus.UNAVAILABLE },
      });
      await audit(tx, {
        actorId,
        action: 'COACH_AVAILABILITY_DELETED',
        entityType: 'COACH_AVAILABILITY',
        entityId: availabilityId,
        oldData: current,
        newData: updated,
      });
      return { id: availabilityId, status: updated.status };
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

  async getCoachSchedule(coachId: number, fromInput: string, toInput: string) {
    const parseDay = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
        ? date
        : null;
    };
    const from = parseDay(fromInput);
    const to = parseDay(toInput);
    if (!from || !to || from > to) {
      throw new HttpError(400, 'Khoảng ngày xem lịch không hợp lệ.', 'INVALID_SCHEDULE_RANGE');
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > 90) {
      throw new HttpError(400, 'Không thể xem lịch quá 90 ngày trong một lần.', 'SCHEDULE_RANGE_TOO_LARGE');
    }
    const coach = await prisma.coach.findUnique({ where: { userId: coachId } });
    if (!coach) throw new HttpError(404, 'Không tìm thấy Coach.', 'COACH_NOT_FOUND');
    const endExclusive = new Date(to);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const [classSessions, schedules] = await Promise.all([
      prisma.classSession.findMany({
        where: {
          groupClass: { coachId },
          status: { in: ['SCHEDULED', 'CANCELLED'] },
          startsAt: { lt: endExclusive },
          endsAt: { gt: from },
        },
        include: {
          room: true,
          groupClass: { select: { id: true, name: true, status: true } },
        },
        orderBy: { startsAt: 'asc' },
      }),
      prisma.privateCourseSchedule.findMany({
        where: {
          status: 'ACTIVE',
          enrollment: {
            coachId,
            status: 'ACTIVE',
          },
          OR: [
            {
              enrollment: { startDate: { lte: to }, expiryDate: { gte: from } },
              effectiveFrom: { lte: to },
              effectiveTo: { gte: from },
            },
            {
              exceptions: {
                some: {
                  action: 'RESCHEDULED',
                  rescheduledStartsAt: { gte: from, lt: endExclusive },
                },
              },
            },
          ],
        },
        include: {
          room: true,
          enrollment: {
            include: {
              member: { include: { user: { select: { id: true, displayName: true } } } },
              privateCourse: { select: { id: true, name: true } },
            },
          },
          exceptions: {
            where: {
              OR: [
                { sessionDate: { gte: from, lte: to } },
                { action: 'RESCHEDULED', rescheduledStartsAt: { gte: from, lt: endExclusive } },
              ],
            },
            include: { newRoom: true },
          },
        },
      }),
    ]);

    const items: Array<Record<string, unknown>> = classSessions.map((session) => ({
      type: 'GROUP_CLASS',
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      room: session.room,
      groupClass: session.groupClass,
    }));
    for (const schedule of schedules) {
      const scheduleExceptions: ScheduleExceptionWithRoom[] = schedule.exceptions;
      const exceptions = new Map(
        scheduleExceptions.map((exception) => [
          exception.sessionDate.toISOString().slice(0, 10),
          exception,
        ]),
      );
      const generatedDates = new Set<string>();
      const effectiveFrom = new Date(Math.max(
        from.getTime(),
        schedule.effectiveFrom.getTime(),
        schedule.enrollment.startDate.getTime(),
      ));
      const effectiveTo = new Date(Math.min(to.getTime(), schedule.effectiveTo.getTime(), schedule.enrollment.expiryDate.getTime()));
      const occurrence = new Date(effectiveFrom);
      occurrence.setUTCDate(occurrence.getUTCDate() + (schedule.dayOfWeek - occurrence.getUTCDay() + 7) % 7);
      for (; occurrence <= effectiveTo; occurrence.setUTCDate(occurrence.getUTCDate() + 7)) {
        const originalDate = occurrence.toISOString().slice(0, 10);
        generatedDates.add(originalDate);
        const exception = exceptions.get(originalDate);
        const startsAt = exception?.action === 'RESCHEDULED' && exception.rescheduledStartsAt
          ? exception.rescheduledStartsAt
          : new Date(Date.UTC(
            occurrence.getUTCFullYear(),
            occurrence.getUTCMonth(),
            occurrence.getUTCDate(),
            schedule.startTime.getUTCHours(),
            schedule.startTime.getUTCMinutes(),
          ));
        const endsAt = exception?.action === 'RESCHEDULED' && exception.rescheduledEndsAt
          ? exception.rescheduledEndsAt
          : new Date(Date.UTC(
            occurrence.getUTCFullYear(),
            occurrence.getUTCMonth(),
            occurrence.getUTCDate(),
            schedule.endTime.getUTCHours(),
            schedule.endTime.getUTCMinutes(),
          ));
        if (startsAt < from || startsAt >= endExclusive) continue;
        items.push({
          type: 'PRIVATE_COURSE',
          id: schedule.id,
          startsAt,
          endsAt,
          originalDate,
          status: exception?.action ?? 'SCHEDULED',
          room: exception?.action === 'RESCHEDULED' && exception.newRoom
            ? exception.newRoom
            : schedule.room,
          enrollment: schedule.enrollment,
        });
      }
      for (const exception of scheduleExceptions) {
        const originalDate = exception.sessionDate.toISOString().slice(0, 10);
        if (
          generatedDates.has(originalDate) ||
          exception.action !== 'RESCHEDULED' ||
          !exception.rescheduledStartsAt ||
          !exception.rescheduledEndsAt ||
          exception.rescheduledStartsAt < from ||
          exception.rescheduledStartsAt >= endExclusive
        ) {
          continue;
        }
        items.push({
          type: 'PRIVATE_COURSE',
          id: schedule.id,
          startsAt: exception.rescheduledStartsAt,
          endsAt: exception.rescheduledEndsAt,
          originalDate,
          status: exception.action,
          room: exception.newRoom ?? schedule.room,
          enrollment: schedule.enrollment,
        });
      }
    }
    return items.sort((left, right) =>
      new Date(left.startsAt as Date).getTime() - new Date(right.startsAt as Date).getTime(),
    );
  }
}

export default new CoachService();