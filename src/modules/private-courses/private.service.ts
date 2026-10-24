import {
  EnrollmentStatus,
  OrderItemType,
  OrderStatus,
  Prisma,
  PrismaClient,
  ScheduleStatus,
} from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { FORBIDDEN_MESSAGE } from '../../middleware/auth.js';

const prisma = new PrismaClient();

type CourseInput = {
  sportId: number;
  name: string;
  description?: string;
  totalSessions: number;
  sessionDurationMinutes: number;
  validityDays: number;
  price: number;
};

type WeeklySlot = {
  dayOfWeek: number;
  startTime: string;
  roomId: number;
};

function parseTime(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, 'Giờ học phải có định dạng HH:mm.', 'INVALID_SCHEDULE_TIME');
  }
  return {
    hours: Number(value.slice(0, 2)),
    minutes: Number(value.slice(3, 5)),
  };
}

function timeOnDate(date: Date, time: { hours: number; minutes: number }) {
  const result = new Date(date);
  result.setUTCHours(time.hours, time.minutes, 0, 0);
  return result;
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

export class PrivateCourseService {
  async listActiveCourses(sportId?: number) {
    return prisma.privateCourse.findMany({
      where: { status: 'ACTIVE', sportId },
      include: {
        sport: true,
        coaches: {
          where: { isActive: true, coach: { status: 'ACTIVE' } },
          include: {
            coach: {
              include: {
                user: { select: { id: true, displayName: true } },
                availabilities: { where: { status: 'AVAILABLE' } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCourse(data: CourseInput) {
    this.validateCourseInput(data);
    const sport = await prisma.sport.findUnique({ where: { id: data.sportId } });
    if (!sport || !sport.isActive) {
      throw new HttpError(400, 'Môn thể thao không tồn tại hoặc đã ngừng hoạt động.', 'SPORT_INACTIVE');
    }
    return prisma.privateCourse.create({
      data: { ...data, name: data.name.trim(), status: 'DRAFT' },
    });
  }

  async updateCourse(id: number, data: Partial<CourseInput> & { status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' }) {
    if (Object.keys(data).length === 0) {
      throw new HttpError(400, 'Cần cung cấp ít nhất một trường cần cập nhật.', 'EMPTY_UPDATE');
    }
    if (
      data.sportId !== undefined && (!Number.isInteger(data.sportId) || data.sportId <= 0) ||
      data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim()) ||
      data.totalSessions !== undefined && data.totalSessions <= 1 ||
      data.sessionDurationMinutes !== undefined && data.sessionDurationMinutes <= 0 ||
      data.validityDays !== undefined && data.validityDays <= 0 ||
      data.price !== undefined && data.price <= 0
    ) {
      throw new HttpError(400, 'Thông tin khóa học không hợp lệ.', 'INVALID_COURSE');
    }
    if (
      data.status !== undefined &&
      !['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(data.status)
    ) {
      throw new HttpError(400, 'Trạng thái khóa học không hợp lệ.', 'INVALID_COURSE_STATUS');
    }
    const current = await prisma.privateCourse.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'Không tìm thấy khóa học 1-1.', 'PRIVATE_COURSE_NOT_FOUND');
    if (data.sportId !== undefined) {
      const sport = await prisma.sport.findUnique({ where: { id: data.sportId } });
      if (!sport || !sport.isActive) {
        throw new HttpError(400, 'Môn thể thao không tồn tại hoặc đã ngừng hoạt động.', 'SPORT_INACTIVE');
      }
    }
    const nextCourse = { ...current, ...data };
    if (
      nextCourse.status === 'ACTIVE' &&
      (nextCourse.totalSessions <= 1 ||
        nextCourse.sessionDurationMinutes <= 0 ||
        nextCourse.validityDays <= 0 ||
        Number(nextCourse.price) <= 0)
    ) {
      throw new HttpError(400, 'Chỉ mở bán khóa có ít nhất hai buổi và dữ liệu hợp lệ.', 'INVALID_COURSE');
    }
    const { sportId, ...fields } = data;
    if (fields.name !== undefined) fields.name = fields.name.trim();
    const updateData: Prisma.PrivateCourseUpdateInput = { ...fields };
    if (sportId !== undefined) updateData.sport = { connect: { id: sportId } };
    return prisma.privateCourse.update({ where: { id }, data: updateData });
  }

  private validateCourseInput(data: CourseInput) {
    if (
      !Number.isInteger(data.sportId) || data.sportId <= 0 ||
      typeof data.name !== 'string' || !data.name.trim() ||
      !Number.isInteger(data.totalSessions) || data.totalSessions <= 1 ||
      !Number.isInteger(data.sessionDurationMinutes) || data.sessionDurationMinutes <= 0 ||
      !Number.isInteger(data.validityDays) || data.validityDays <= 0 ||
      !Number.isFinite(data.price) || data.price <= 0
    ) {
      throw new HttpError(400, 'Khóa học phải có từ hai buổi trở lên và thông tin hợp lệ.', 'INVALID_COURSE');
    }
  }

  async assignCoach(courseId: number, coachId: number, customPrice?: number) {
    const course = await prisma.privateCourse.findUnique({ where: { id: courseId } });
    if (!course) throw new HttpError(404, 'Không tìm thấy khóa học 1-1.', 'PRIVATE_COURSE_NOT_FOUND');
    if (customPrice !== undefined && (!Number.isFinite(customPrice) || customPrice <= 0)) {
      throw new HttpError(400, 'Giá riêng phải lớn hơn 0.', 'INVALID_COACH_PRICE');
    }

    const coach = await prisma.coach.findUnique({
      where: { userId: coachId },
      include: { coachSports: true },
    });
    if (
      !coach || coach.status !== 'ACTIVE' ||
      !coach.coachSports.some((item) => item.sportId === course.sportId)
    ) {
      throw new HttpError(400, 'Coach phải đang hoạt động và có chuyên môn phù hợp.', 'COACH_NOT_QUALIFIED');
    }
    return prisma.coachPrivateCourse.upsert({
      where: { coachId_privateCourseId: { coachId, privateCourseId: courseId } },
      create: { coachId, privateCourseId: courseId, customPrice, isActive: true },
      update: { customPrice, isActive: true },
    });
  }

  async unassignCoach(courseId: number, coachId: number) {
    const result = await prisma.coachPrivateCourse.updateMany({
      where: { coachId, privateCourseId: courseId, isActive: true },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new HttpError(404, 'Không tìm thấy phân công Coach đang hoạt động.', 'COACH_ASSIGNMENT_NOT_FOUND');
    }
  }

  async createEnrollment(data: {
    memberId: number;
    coachId: number;
    privateCourseId: number;
    startDate: string;
    schedules: WeeklySlot[];
  }) {
    const course = await prisma.privateCourse.findUnique({
      where: { id: data.privateCourseId },
    });
    if (!course || course.status !== 'ACTIVE') {
      throw new HttpError(404, 'Khóa học cá nhân không tồn tại hoặc không ở trạng thái hoạt động.', 'PRIVATE_COURSE_UNAVAILABLE');
    }
    if (
      course.totalSessions <= 1 || course.sessionDurationMinutes <= 0 ||
      course.validityDays <= 0 || Number(course.price) <= 0
    ) {
      throw new HttpError(400, 'Thông tin khóa học không hợp lệ.', 'INVALID_COURSE');
    }
    if (!Array.isArray(data.schedules) || data.schedules.length === 0) {
      throw new HttpError(400, 'Cần chọn ít nhất một lịch cố định hàng tuần.', 'SCHEDULE_REQUIRED');
    }

    const assignment = await prisma.coachPrivateCourse.findFirst({
      where: { coachId: data.coachId, privateCourseId: data.privateCourseId, isActive: true },
    });
    const coach = await prisma.coach.findUnique({
      where: { userId: data.coachId },
      include: { coachSports: true },
    });
    if (
      !assignment || !coach || coach.status !== 'ACTIVE' ||
      !coach.coachSports.some((item) => item.sportId === course.sportId)
    ) {
      throw new HttpError(400, 'Coach không hoạt động hoặc không được gán cho khóa học này.', 'COACH_NOT_ASSIGNED');
    }

    const startDate = parseDateOnly(data.startDate);
    if (!startDate) {
      throw new HttpError(400, 'Ngày bắt đầu không hợp lệ.', 'INVALID_START_DATE');
    }
    const effectiveFrom = startDate;
    const expiryDate = new Date(effectiveFrom);
    expiryDate.setUTCDate(expiryDate.getUTCDate() + course.validityDays);
    const expiryBoundary = new Date(expiryDate);
    expiryBoundary.setUTCDate(expiryBoundary.getUTCDate() + 1);

    const slots = data.schedules.map((slot) => {
      if (!Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
        throw new HttpError(400, 'dayOfWeek phải nằm trong khoảng 0 đến 6.', 'INVALID_DAY_OF_WEEK');
      }
      if (!Number.isSafeInteger(slot.roomId) || slot.roomId <= 0) {
        throw new HttpError(400, 'roomId không hợp lệ.', 'INVALID_ROOM_ID');
      }
      const startTime = parseTime(slot.startTime);
      const end = {
        hours: startTime.hours,
        minutes: startTime.minutes + course.sessionDurationMinutes,
      };
      end.hours += Math.floor(end.minutes / 60);
      end.minutes %= 60;
      if (end.hours > 23) {
        throw new HttpError(400, 'Thời lượng buổi học vượt quá một ngày.', 'INVALID_SESSION_DURATION');
      }
      return {
        ...slot,
        start: startTime,
        end,
        startTimeDate: new Date(`1970-01-01T${slot.startTime}:00.000Z`),
        endTimeDate: new Date(`1970-01-01T${String(end.hours).padStart(2, '0')}:${String(end.minutes).padStart(2, '0')}:00.000Z`),
      };
    });

    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const left = slots[i]!;
        const right = slots[j]!;
        if (
          left.dayOfWeek === right.dayOfWeek &&
          overlaps(
            timeOnDate(effectiveFrom, left.start),
            timeOnDate(effectiveFrom, left.end),
            timeOnDate(effectiveFrom, right.start),
            timeOnDate(effectiveFrom, right.end),
          )
        ) {
          throw new HttpError(409, 'Các khung giờ đã chọn bị chồng lấn.', 'SCHEDULE_CONFLICT');
        }
      }
    }

    const availability = await prisma.coachAvailability.findMany({
      where: {
        coachId: data.coachId,
        dayOfWeek: { in: slots.map((slot) => slot.dayOfWeek) },
        status: 'AVAILABLE',
        effectiveFrom: { lte: expiryDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
    });
    const rooms = await prisma.room.findMany({
      where: { id: { in: slots.map((slot) => slot.roomId) } },
    });
    if (rooms.length !== new Set(slots.map((slot) => slot.roomId)).size ||
      rooms.some((room) => room.status !== 'AVAILABLE')) {
      throw new HttpError(409, 'Phòng học không tồn tại hoặc không khả dụng.', 'ROOM_UNAVAILABLE');
    }

    const occurrences: Array<{ slot: (typeof slots)[number]; start: Date; end: Date }> = [];
    for (const slot of slots) {
      const occurrence = new Date(effectiveFrom);
      const daysUntilSlot = (slot.dayOfWeek - occurrence.getUTCDay() + 7) % 7;
      occurrence.setUTCDate(occurrence.getUTCDate() + daysUntilSlot);
      while (occurrence <= expiryDate) {
        const start = timeOnDate(occurrence, slot.start);
        const end = timeOnDate(occurrence, slot.end);
        const hasAvailability = availability.some((item) => {
          const availabilityFrom = dateOnly(new Date(item.effectiveFrom));
          const availabilityTo = item.effectiveTo
            ? dateOnly(new Date(item.effectiveTo))
            : expiryDate;
          const availableStart = {
            hours: item.startTime.getUTCHours(),
            minutes: item.startTime.getUTCMinutes(),
          };
          const availableEnd = {
            hours: item.endTime.getUTCHours(),
            minutes: item.endTime.getUTCMinutes(),
          };
          return item.dayOfWeek === slot.dayOfWeek &&
            occurrence >= availabilityFrom &&
            occurrence <= availabilityTo &&
            timeOnDate(occurrence, slot.start) >= timeOnDate(occurrence, availableStart) &&
            timeOnDate(occurrence, slot.end) <= timeOnDate(occurrence, availableEnd);
        });
        if (!hasAvailability) {
          throw new HttpError(409, 'Coach không khả dụng trong toàn bộ thời hạn đã chọn.', 'COACH_UNAVAILABLE');
        }
        occurrences.push({ slot, start, end });
        occurrence.setUTCDate(occurrence.getUTCDate() + 7);
      }
    }

    const existingPrivateSchedules = await prisma.privateCourseSchedule.findMany({
      where: {
        status: ScheduleStatus.ACTIVE,
        dayOfWeek: { in: slots.map((slot) => slot.dayOfWeek) },
        effectiveFrom: { lte: expiryDate },
        effectiveTo: { gte: effectiveFrom },
        OR: [
          { enrollment: { coachId: data.coachId } },
          { enrollment: { memberId: data.memberId } },
          { roomId: { in: slots.map((slot) => slot.roomId) } },
        ],
      },
      include: { enrollment: { select: { coachId: true, memberId: true } } },
    });
    for (const occurrence of occurrences) {
      const conflict = existingPrivateSchedules.some((existing) => {
        if (
          existing.dayOfWeek !== occurrence.slot.dayOfWeek ||
          dateOnly(occurrence.start) < dateOnly(new Date(existing.effectiveFrom)) ||
          dateOnly(occurrence.start) > dateOnly(new Date(existing.effectiveTo))
        ) {
          return false;
        }
        const existingStart = timeOnDate(occurrence.start, {
          hours: existing.startTime.getUTCHours(),
          minutes: existing.startTime.getUTCMinutes(),
        });
        const existingEnd = timeOnDate(occurrence.start, {
          hours: existing.endTime.getUTCHours(),
          minutes: existing.endTime.getUTCMinutes(),
        });
        const relatedConflict =
          existing.enrollment.coachId === data.coachId ||
          existing.enrollment.memberId === data.memberId ||
          occurrence.slot.roomId === existing.roomId;
        return relatedConflict && overlaps(occurrence.start, occurrence.end, existingStart, existingEnd);
      });
      if (conflict) {
        throw new HttpError(409, 'Lịch Coach, Member hoặc phòng bị chồng lấn.', 'SCHEDULE_CONFLICT');
      }
    }

    const classSessions = await prisma.classSession.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { lt: expiryBoundary },
        endsAt: { gt: effectiveFrom },
        OR: [
          { groupClass: { coachId: data.coachId } },
          { roomId: { in: slots.map((slot) => slot.roomId) } },
          { groupClass: { registrations: { some: { memberId: data.memberId, status: 'CONFIRMED' } } } },
        ],
      },
      include: {
        groupClass: {
          select: {
            coachId: true,
            registrations: {
              where: { memberId: data.memberId, status: 'CONFIRMED' },
              select: { memberId: true },
            },
          },
        },
      },
    });
    for (const occurrence of occurrences) {
      if (classSessions.some((session) =>
        (session.groupClass.coachId === data.coachId ||
          session.groupClass.registrations.length > 0 ||
          session.roomId === occurrence.slot.roomId) &&
        overlaps(occurrence.start, occurrence.end, session.startsAt, session.endsAt)
      )) {
        throw new HttpError(409, 'Lịch Coach, Member hoặc phòng bị chồng lấn với buổi lớp nhóm.', 'SCHEDULE_CONFLICT');
      }
    }

    const schedules = slots.map((slot) => ({
      roomId: slot.roomId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTimeDate,
      endTime: slot.endTimeDate,
      effectiveFrom,
      effectiveTo: expiryDate,
      status: ScheduleStatus.ACTIVE,
    }));
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const enrollment = await tx.privateCourseEnrollment.create({
        data: {
          memberId: data.memberId,
          coachId: data.coachId,
          privateCourseId: data.privateCourseId,
          purchasedSessions: course.totalSessions,
          remainingSessions: course.totalSessions,
          purchasedPrice: assignment.customPrice ?? course.price,
          startDate: effectiveFrom,
          expiryDate,
          status: EnrollmentStatus.PENDING_PAYMENT,
          schedules: { create: schedules },
        },
      });
      const order = await tx.serviceOrder.create({
        data: {
          memberId: data.memberId,
          orderNumber: `ORD-PC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          originalAmount: assignment.customPrice ?? course.price,
          finalAmount: assignment.customPrice ?? course.price,
          status: OrderStatus.PENDING_PAYMENT,
          expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        },
      });
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          privateEnrollmentId: enrollment.id,
          itemType: OrderItemType.PRIVATE_COURSE,
          itemNameSnapshot: course.name,
          unitPrice: assignment.customPrice ?? course.price,
          finalAmount: assignment.customPrice ?? course.price,
        },
      });
      return { enrollment, order };
    });
  }

  async addCourseSchedule(
    enrollmentId: number,
    data: {
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      effectiveFrom: string;
      effectiveTo: string;
      roomId: number;
    },
    memberId: number,
  ) {
    const enrollment = await prisma.privateCourseEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) {
      throw new HttpError(404, 'Không tìm thấy đăng ký khóa học.', 'ENROLLMENT_NOT_FOUND');
    }
    if (enrollment.memberId !== memberId) {
      throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN');
    }
    if (enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new HttpError(409, 'Đăng ký khóa học chưa ở trạng thái hoạt động.', 'ENROLLMENT_NOT_ACTIVE');
    }

    const start = parseTime(data.startTime);
    const end = parseTime(data.endTime);
    const dayOfWeek = data.dayOfWeek;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new HttpError(400, 'dayOfWeek phải nằm trong khoảng 0 đến 6.', 'INVALID_DAY_OF_WEEK');
    }
    const startDateTime = timeOnDate(new Date('1970-01-01T00:00:00Z'), start);
    const endDateTime = timeOnDate(new Date('1970-01-01T00:00:00Z'), end);
    if (startDateTime >= endDateTime) {
      throw new HttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu.', 'INVALID_TIME_RANGE');
    }
    const effectiveFrom = parseDateOnly(data.effectiveFrom);
    const effectiveTo = parseDateOnly(data.effectiveTo);
    if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) {
      throw new HttpError(400, 'Khoảng ngày áp dụng không hợp lệ.', 'INVALID_DATE_RANGE');
    }
    const enrollmentStart = dateOnly(enrollment.startDate);
    const enrollmentExpiry = dateOnly(enrollment.expiryDate);
    if (effectiveFrom < enrollmentStart || effectiveTo > enrollmentExpiry) {
      throw new HttpError(409, 'Lịch phải nằm trong thời hạn đăng ký khóa học.', 'SCHEDULE_OUTSIDE_ENROLLMENT');
    }

    const room = await prisma.room.findUnique({ where: { id: data.roomId } });
    if (!room || room.status !== 'AVAILABLE') {
      throw new HttpError(409, 'Phòng học không tồn tại hoặc không khả dụng.', 'ROOM_UNAVAILABLE');
    }
    const availability = await prisma.coachAvailability.findMany({
      where: {
        coachId: enrollment.coachId,
        dayOfWeek,
        status: 'AVAILABLE',
        effectiveFrom: { lte: effectiveTo },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
    });
    const occurrences: Date[] = [];
    const firstOccurrence = new Date(effectiveFrom);
    firstOccurrence.setUTCDate(
      firstOccurrence.getUTCDate() + (dayOfWeek - firstOccurrence.getUTCDay() + 7) % 7,
    );
    for (const occurrence = new Date(firstOccurrence); occurrence <= effectiveTo; occurrence.setUTCDate(occurrence.getUTCDate() + 7)) {
      const occurrenceStart = timeOnDate(occurrence, start);
      const occurrenceEnd = timeOnDate(occurrence, end);
      const covered = availability.some((item) => {
        const availabilityFrom = dateOnly(item.effectiveFrom);
        const availabilityTo = item.effectiveTo ? dateOnly(item.effectiveTo) : effectiveTo;
        return occurrence >= availabilityFrom &&
          occurrence <= availabilityTo &&
          occurrenceStart >= timeOnDate(occurrence, {
            hours: item.startTime.getUTCHours(),
            minutes: item.startTime.getUTCMinutes(),
          }) &&
          occurrenceEnd <= timeOnDate(occurrence, {
            hours: item.endTime.getUTCHours(),
            minutes: item.endTime.getUTCMinutes(),
          });
      });
      if (!covered) {
        throw new HttpError(409, 'Coach không khả dụng trong toàn bộ lịch đã chọn.', 'COACH_UNAVAILABLE');
      }
      occurrences.push(new Date(occurrence));
    }
    if (occurrences.length === 0) {
      throw new HttpError(400, 'Khoảng ngày không chứa lần học nào theo thứ đã chọn.', 'NO_RECURRENCE_OCCURRENCES');
    }
    const existingSchedules = await prisma.privateCourseSchedule.findMany({
      where: {
        OR: [
          { enrollment: { coachId: enrollment.coachId } },
          { enrollment: { memberId: enrollment.memberId } },
          { roomId: data.roomId },
        ],
        dayOfWeek,
        status: ScheduleStatus.ACTIVE,
        effectiveFrom: { lte: effectiveTo },
        effectiveTo: { gte: effectiveFrom },
      },
      include: { enrollment: { select: { coachId: true, memberId: true } } },
    });
    if (existingSchedules.some((slot) => {
      const slotStart = { hours: slot.startTime.getUTCHours(), minutes: slot.startTime.getUTCMinutes() };
      const slotEnd = { hours: slot.endTime.getUTCHours(), minutes: slot.endTime.getUTCMinutes() };
      const relatedConflict =
        slot.roomId === data.roomId ||
        slot.enrollment.coachId === enrollment.coachId ||
        slot.enrollment.memberId === enrollment.memberId;
      return relatedConflict && occurrences.some((date) =>
        date >= dateOnly(slot.effectiveFrom) &&
        date <= dateOnly(slot.effectiveTo) &&
        overlaps(
          timeOnDate(date, start),
          timeOnDate(date, end),
          timeOnDate(date, slotStart),
          timeOnDate(date, slotEnd),
        ),
      );
    })) {
      throw new HttpError(409, 'Khung giờ lịch cố định bị chồng lấn.', 'SCHEDULE_CONFLICT');
    }
    const expiryBoundary = new Date(effectiveTo);
    expiryBoundary.setUTCDate(expiryBoundary.getUTCDate() + 1);
    const classSessions = await prisma.classSession.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { lt: expiryBoundary },
        endsAt: { gt: effectiveFrom },
        OR: [
          { groupClass: { coachId: enrollment.coachId } },
          { groupClass: { registrations: { some: { memberId: enrollment.memberId, status: 'CONFIRMED' } } } },
          { roomId: data.roomId },
        ],
      },
      include: {
        groupClass: {
          select: {
            coachId: true,
            registrations: {
              where: { memberId: enrollment.memberId, status: 'CONFIRMED' },
              select: { memberId: true },
            },
          },
        },
      },
    });
    const classConflict = occurrences.some((date) => {
      const occurrenceStart = timeOnDate(date, start);
      const occurrenceEnd = timeOnDate(date, end);
      return classSessions.some((session) =>
        (session.groupClass.coachId === enrollment.coachId ||
          session.groupClass.registrations.length > 0 ||
          session.roomId === data.roomId) &&
        overlaps(occurrenceStart, occurrenceEnd, session.startsAt, session.endsAt),
      );
    });
    if (classConflict) {
      throw new HttpError(409, 'Lịch Coach, Member hoặc phòng bị chồng lấn với buổi lớp nhóm.', 'SCHEDULE_CONFLICT');
    }
    return prisma.privateCourseSchedule.create({
      data: {
        enrollmentId,
        roomId: data.roomId,
        dayOfWeek,
        startTime: startDateTime,
        endTime: endDateTime,
        effectiveFrom,
        effectiveTo,
        status: ScheduleStatus.ACTIVE,
      },
    });
  }

  async getEnrollment(id: number, userId: number, role: string) {
    const enrollment = await prisma.privateCourseEnrollment.findUnique({
      where: { id },
      include: {
        member: { select: { userId: true, memberCode: true } },
        coach: { include: { user: { select: { id: true, displayName: true } } } },
        privateCourse: { include: { sport: true } },
        schedules: {
          include: {
            room: true,
            attendances: { orderBy: { sessionDate: 'asc' } },
          },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
      },
    });
    if (!enrollment) throw new HttpError(404, 'Không tìm thấy đăng ký khóa học.', 'ENROLLMENT_NOT_FOUND');
    if (
      (role === 'MEMBER' && enrollment.memberId !== userId) ||
      (role === 'COACH' && enrollment.coachId !== userId) ||
      !['MEMBER', 'COACH', 'RECEPTIONIST', 'CENTER_MANAGER'].includes(role)
    ) {
      throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN');
    }
    return {
      ...enrollment,
      completedSessions: enrollment.purchasedSessions - enrollment.remainingSessions,
    };
  }

  async recordCompletedSession(
    scheduleId: number,
    sessionDateInput: string,
    coachId: number,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDateInput)) {
      throw new HttpError(400, 'sessionDate phải có định dạng YYYY-MM-DD.', 'INVALID_SESSION_DATE');
    }
    const sessionDate = new Date(`${sessionDateInput}T00:00:00.000Z`);
    if (!Number.isFinite(sessionDate.getTime()) || sessionDate.toISOString().slice(0, 10) !== sessionDateInput) {
      throw new HttpError(400, 'Ngày buổi học không hợp lệ.', 'INVALID_SESSION_DATE');
    }
    const schedule = await prisma.privateCourseSchedule.findUnique({
      where: { id: scheduleId },
      include: { enrollment: true },
    });
    if (!schedule) throw new HttpError(404, 'Không tìm thấy lịch khóa học.', 'SCHEDULE_NOT_FOUND');
    if (schedule.enrollment.coachId !== coachId) {
      throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN');
    }
    if (
      schedule.status !== ScheduleStatus.ACTIVE ||
      schedule.enrollment.status !== EnrollmentStatus.ACTIVE ||
      schedule.enrollment.remainingSessions <= 0 ||
      dateOnly(new Date()) > dateOnly(schedule.enrollment.expiryDate)
    ) {
      throw new HttpError(409, 'Đăng ký không còn buổi học có thể ghi nhận.', 'NO_SESSIONS_REMAINING');
    }
    const date = dateOnly(sessionDate);
    if (
      date < dateOnly(schedule.effectiveFrom) ||
      date > dateOnly(schedule.effectiveTo) ||
      date < dateOnly(schedule.enrollment.startDate) ||
      date > dateOnly(schedule.enrollment.expiryDate) ||
      date.getUTCDay() !== schedule.dayOfWeek
    ) {
      throw new HttpError(400, 'Ngày không thuộc lịch cố định đã đăng ký.', 'SESSION_DATE_OUT_OF_RANGE');
    }
    const startsAt = timeOnDate(date, {
      hours: schedule.startTime.getUTCHours(),
      minutes: schedule.startTime.getUTCMinutes(),
    });
    const endsAt = timeOnDate(date, {
      hours: schedule.endTime.getUTCHours(),
      minutes: schedule.endTime.getUTCMinutes(),
    });
    if (endsAt > new Date()) {
      throw new HttpError(409, 'Chỉ có thể ghi nhận buổi học sau khi buổi học kết thúc.', 'SESSION_NOT_COMPLETED');
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.privateCourseAttendance.createMany({
        data: [{
          scheduleId,
          sessionDate,
          startsAt,
          endsAt,
          markedById: coachId,
        }],
        skipDuplicates: true,
      });
      if (created.count === 0) {
        const existing = await tx.privateCourseAttendance.findUnique({
          where: { scheduleId_sessionDate: { scheduleId, sessionDate } },
        });
        const currentEnrollment = await tx.privateCourseEnrollment.findUniqueOrThrow({
          where: { id: schedule.enrollmentId },
          select: { remainingSessions: true },
        });
        return {
          attendance: existing,
          remainingSessions: currentEnrollment.remainingSessions,
          alreadyRecorded: true,
        };
      }

      const consumed = await tx.privateCourseEnrollment.updateMany({
        where: {
          id: schedule.enrollmentId,
          status: EnrollmentStatus.ACTIVE,
          remainingSessions: { gt: 0 },
        },
        data: { remainingSessions: { decrement: 1 } },
      });
      if (consumed.count !== 1) {
        throw new HttpError(409, 'Khóa học không còn buổi học hợp lệ.', 'NO_SESSIONS_REMAINING');
      }
      const updated = await tx.privateCourseEnrollment.findUniqueOrThrow({
        where: { id: schedule.enrollmentId },
        select: { remainingSessions: true },
      });
      if (updated.remainingSessions === 0) {
        await tx.privateCourseEnrollment.update({
          where: { id: schedule.enrollmentId },
          data: { status: EnrollmentStatus.COMPLETED },
        });
      }
      const attendance = await tx.privateCourseAttendance.findUniqueOrThrow({
        where: { scheduleId_sessionDate: { scheduleId, sessionDate } },
      });
      return {
        attendance,
        remainingSessions: updated.remainingSessions,
        alreadyRecorded: false,
      };
    });
  }

  async getEnrollments(userId: number, role: string) {
    let where: { memberId?: number; coachId?: number } | undefined;
    switch (role) {
      case 'MEMBER':
        where = { memberId: userId };
        break;
      case 'COACH':
        where = { coachId: userId };
        break;
      case 'RECEPTIONIST':
      case 'CENTER_MANAGER':
        break;
      default:
        throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN');
    }
    return prisma.privateCourseEnrollment.findMany({
      ...(where ? { where } : {}),
      include: {
        member: { select: { userId: true, memberCode: true } },
        coach: { include: { user: { select: { id: true, displayName: true } } } },
        privateCourse: { include: { sport: true } },
        schedules: true,
      },
      orderBy: { id: 'desc' },
    });
  }
}

export default new PrivateCourseService();
