import { PrismaClient, ClassStatus, CoachStatus, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import sessionService from '../class-sessions/session.service.js';
import coachService from '../coaches/coach.service.js';
import { audit } from '../../lib/audit.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js';

const prisma = new PrismaClient();

export interface CreateGroupClassDto {
  sportId: number;
  coachId: number;
  name: string;
  description?: string | null;
  capacity: number;
  tuitionFee: number;
  registrationOpenAt: string | Date;
  registrationCloseAt: string | Date;
  startDate: string | Date;
  endDate: string | Date;
}

export class GroupClassService {
  // Lấy danh sách lớp nhóm
  async getAllGroupClasses() {
    return await prisma.groupClass.findMany({
      include: {
        sport: true,
        coach: {
          include: { user: { select: { id: true, displayName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // FR-15: Tạo lớp nhóm (Mặc định trạng thái là DRAFT)
  async createGroupClass(data: CreateGroupClassDto) {
    if (data.capacity <= 0) {
      throw new HttpError(400, 'Sức chứa của lớp học phải lớn hơn 0.', 'INVALID_CLASS_CAPACITY');
    }
    if (data.tuitionFee < 0) {
      throw new HttpError(400, 'Học phí không được nhỏ hơn 0.', 'INVALID_TUITION_FEE');
    }

    // Kiểm tra môn thể thao tồn tại và đang hoạt động
    const sport = await prisma.sport.findUnique({ where: { id: data.sportId } });
    if (!sport || !sport.isActive) {
      throw new HttpError(409, 'Môn thể thao không tồn tại hoặc đã ngừng hoạt động.', 'SPORT_INACTIVE');
    }

    // Kiểm tra Coach tồn tại, đang hoạt động và có chuyên môn dạy môn này (FR-16)
    const coach = await prisma.coach.findUnique({
      where: { userId: data.coachId },
      include: { coachSports: true },
    });
    if (!coach || coach.status !== CoachStatus.ACTIVE) {
      throw new HttpError(409, 'Huấn luyện viên không tồn tại hoặc không ở trạng thái hoạt động.', 'COACH_INACTIVE');
    }

    const hasSportSkill = coach.coachSports.some((cs) => cs.sportId === data.sportId);
    if (!hasSportSkill) {
      throw new HttpError(409, 'Huấn luyện viên này không có chuyên môn dạy môn thể thao của lớp học.', 'COACH_NOT_QUALIFIED');
    }

    return await prisma.groupClass.create({
      data: {
        sportId: data.sportId,
        coachId: data.coachId,
        name: data.name,
        description: data.description,
        capacity: data.capacity,
        tuitionFee: data.tuitionFee,
        registrationOpenAt: new Date(data.registrationOpenAt),
        registrationCloseAt: new Date(data.registrationCloseAt),
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        status: ClassStatus.DRAFT,
      },
    });
  }

  async updateGroupClass(classId: number, data: Partial<CreateGroupClassDto>, actorId: number) {
    if (Object.keys(data).length === 0) {
      throw new HttpError(400, 'Cần cung cấp ít nhất một trường cần cập nhật.', 'EMPTY_UPDATE');
    }
    const allowedFields = new Set([
      'sportId',
      'coachId',
      'name',
      'description',
      'capacity',
      'tuitionFee',
      'registrationOpenAt',
      'registrationCloseAt',
      'startDate',
      'endDate',
    ]);
    if (Object.keys(data).some((field) => !allowedFields.has(field))) {
      throw new HttpError(400, 'Có trường thông tin không được hỗ trợ.', 'UNKNOWN_UPDATE_FIELD');
    }
    if (
      data.sportId !== undefined && (!Number.isSafeInteger(data.sportId) || data.sportId <= 0) ||
      data.coachId !== undefined && (!Number.isSafeInteger(data.coachId) || data.coachId <= 0)
    ) {
      throw new HttpError(400, 'Môn thể thao hoặc Coach không hợp lệ.', 'INVALID_CLASS_REFERENCE');
    }
    if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) {
      throw new HttpError(400, 'Tên lớp không được để trống.', 'INVALID_CLASS_NAME');
    }
    if (data.capacity !== undefined && (!Number.isSafeInteger(data.capacity) || data.capacity <= 0)) {
      throw new HttpError(400, 'Sức chứa của lớp học phải lớn hơn 0.', 'INVALID_CLASS_CAPACITY');
    }
    if (data.tuitionFee !== undefined && (!Number.isFinite(data.tuitionFee) || data.tuitionFee < 0)) {
      throw new HttpError(400, 'Học phí không được nhỏ hơn 0.', 'INVALID_TUITION_FEE');
    }

    const current = await prisma.groupClass.findUnique({
      where: { id: classId },
      include: {
        registrations: {
          where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
          select: { id: true, memberId: true },
        },
        sessions: { where: { status: 'SCHEDULED' }, include: { room: true } },
      },
    });
    if (!current) throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND');
    if ((data.capacity ?? current.capacity) < current.registrations.length) {
      throw new HttpError(409, 'Sức chứa không thể thấp hơn số chỗ đã giữ.', 'CLASS_CAPACITY_BELOW_OCCUPANCY');
    }

    const parseDate = (value: string | Date | undefined, currentValue: Date) => {
      if (value === undefined) return currentValue;
      if (!(value instanceof Date) && typeof value !== 'string') {
        throw new HttpError(400, 'Ngày giờ lớp học không hợp lệ.', 'INVALID_CLASS_DATE');
      }
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) {
        throw new HttpError(400, 'Ngày giờ lớp học không hợp lệ.', 'INVALID_CLASS_DATE');
      }
      return parsed;
    };
    const registrationOpenAt = parseDate(data.registrationOpenAt, current.registrationOpenAt);
    const registrationCloseAt = parseDate(data.registrationCloseAt, current.registrationCloseAt);
    const startDate = parseDate(data.startDate, current.startDate);
    const endDate = parseDate(data.endDate, current.endDate);
    if (registrationOpenAt >= registrationCloseAt || startDate > endDate || registrationCloseAt > startDate) {
      throw new HttpError(400, 'Thời gian đăng ký và thời gian diễn ra lớp không hợp lệ.', 'INVALID_CLASS_DATE_RANGE');
    }
    const endExclusive = new Date(endDate);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    if (current.sessions.some((session) => session.startsAt < startDate || session.endsAt > endExclusive)) {
      throw new HttpError(409, 'Không thể đổi thời hạn lớp để loại bỏ buổi học đã lên lịch.', 'CLASS_HAS_SCHEDULED_SESSIONS');
    }

    if (data.sportId !== undefined) {
      const sport = await prisma.sport.findUnique({ where: { id: data.sportId } });
      if (!sport || !sport.isActive) {
        throw new HttpError(409, 'Môn thể thao không tồn tại hoặc đã ngừng hoạt động.', 'SPORT_INACTIVE');
      }
    }
    if (data.coachId !== undefined || data.sportId !== undefined) {
      const coachId = data.coachId ?? current.coachId;
      const sportId = data.sportId ?? current.sportId;
      const coach = await prisma.coach.findUnique({
        where: { userId: coachId },
        include: { coachSports: true },
      });
      if (!coach || coach.status !== CoachStatus.ACTIVE) {
        throw new HttpError(409, 'Huấn luyện viên không hoạt động.', 'COACH_INACTIVE');
      }
      if (!coach.coachSports.some((qualification) => qualification.sportId === sportId)) {
        throw new HttpError(409, 'Huấn luyện viên không có chuyên môn phù hợp.', 'COACH_NOT_QUALIFIED');
      }
      for (const session of current.sessions) {
        if (await sessionService.checkCoachConflict(coachId, session.startsAt, session.endsAt, session.id)) {
          throw new HttpError(409, 'Huấn luyện viên đã bị trùng lịch.', 'COACH_SCHEDULE_CONFLICT');
        }
        if (!await coachService.isAvailableForSession(coachId, session.startsAt, session.endsAt)) {
          throw new HttpError(409, 'Huấn luyện viên không khả dụng trong lịch đã lên.', 'COACH_UNAVAILABLE');
        }
      }
    }
    if ((data.capacity !== undefined) && current.sessions.some((session) => session.room.capacity < data.capacity!)) {
      throw new HttpError(409, 'Sức chứa phòng không đủ cho sức chứa lớp mới.', 'ROOM_CAPACITY_INSUFFICIENT');
    }

    const updateData: Prisma.GroupClassUpdateInput = {};
    for (const field of ['name', 'description', 'capacity', 'tuitionFee'] as const) {
      if (data[field] !== undefined) {
        if (field === 'name') updateData.name = data.name!.trim();
        else if (field === 'description') updateData.description = data.description;
        else if (field === 'capacity') updateData.capacity = data.capacity;
        else updateData.tuitionFee = data.tuitionFee;
      }
    }
    if (data.sportId !== undefined) updateData.sport = { connect: { id: data.sportId } };
    if (data.coachId !== undefined) updateData.coach = { connect: { userId: data.coachId } };
    if (data.registrationOpenAt !== undefined) updateData.registrationOpenAt = registrationOpenAt;
    if (data.registrationCloseAt !== undefined) updateData.registrationCloseAt = registrationCloseAt;
    if (data.startDate !== undefined) updateData.startDate = startDate;
    if (data.endDate !== undefined) updateData.endDate = endDate;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.groupClass.update({ where: { id: classId }, data: updateData });
      await audit(tx, {
        actorId,
        action: 'GROUP_CLASS_UPDATED',
        entityType: 'GROUP_CLASS',
        entityId: classId,
        oldData: current,
        newData: updated,
      });
      if (data.coachId !== undefined && data.coachId !== current.coachId) {
        await audit(tx, {
          actorId,
          action: 'GROUP_CLASS_COACH_CHANGED',
          entityType: 'GROUP_CLASS',
          entityId: classId,
          oldData: { coachId: current.coachId },
          newData: { coachId: data.coachId },
        });
        await notify(tx, {
          userIds: [current.coachId, data.coachId, ...current.registrations.map((registration) => registration.memberId)],
          type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
          title: 'Huấn luyện viên lớp học đã thay đổi',
          content: `Huấn luyện viên phụ trách lớp "${current.name}" đã được thay đổi.`,
        });
      }
      return updated;
    });
  }

  // Chuyển trạng thái lớp sang OPEN (Kiểm tra điều kiện hợp lệ)
  async updateClassStatus(id: number, status: ClassStatus) {
    const groupClass = await prisma.groupClass.findUnique({ where: { id } });
    if (!groupClass) {
      throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND');
    }

    if (status === ClassStatus.OPEN) {
      // Kiểm tra dữ liệu bắt buộc trước khi mở đăng ký
      if (!groupClass.name || !groupClass.capacity || !groupClass.tuitionFee) {
        throw new HttpError(409, 'Lớp học thiếu thông tin cơ bản (tên, sức chứa, học phí), không thể mở đăng ký.', 'CLASS_NOT_READY');
      }
    }

    return await prisma.groupClass.update({
      where: { id },
      data: { status },
    });
  }

  // FR-16: Phân công hoặc thay đổi Coach cho lớp nhóm
  async assignCoach(classId: number, newCoachId: number, actorId: number) {
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: classId },
      include: {
        sessions: { where: { status: 'SCHEDULED' } },
        registrations: { where: { status: 'CONFIRMED' }, select: { memberId: true } },
      },
    });
    if (!groupClass) {
      throw new HttpError(404, 'Không tìm thấy lớp nhóm.', 'CLASS_NOT_FOUND');
    }

    // Kiểm tra Coach mới có ACTIVE và đúng chuyên môn môn học không
    const coach = await prisma.coach.findUnique({
      where: { userId: newCoachId },
      include: { coachSports: true },
    });
    if (!coach || coach.status !== CoachStatus.ACTIVE) {
      throw new HttpError(409, 'Huấn luyện viên được chỉ định không hoạt động.', 'COACH_INACTIVE');
    }

    const hasSportSkill = coach.coachSports.some((cs) => cs.sportId === groupClass.sportId);
    if (!hasSportSkill) {
      throw new HttpError(409, 'Huấn luyện viên không có chuyên môn phụ trách môn thể thao này.', 'COACH_NOT_QUALIFIED');
    }

    for (const session of groupClass.sessions) {
      if (
        await sessionService.checkCoachConflict(
          newCoachId,
          session.startsAt,
          session.endsAt,
          session.id,
        )
      ) {
        throw new HttpError(409, 'Huấn luyện viên đã bị trùng lịch trong thời gian của lớp.', 'COACH_SCHEDULE_CONFLICT');
      }
      if (!await coachService.isAvailableForSession(newCoachId, session.startsAt, session.endsAt)) {
        throw new HttpError(409, 'Huấn luyện viên không khả dụng trong khoảng thời gian của lớp.', 'COACH_UNAVAILABLE');
      }
    }

    if (groupClass.coachId === newCoachId) return groupClass;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.groupClass.update({
        where: { id: classId },
        data: { coachId: newCoachId },
      });
      await audit(tx, {
        actorId,
        action: 'GROUP_CLASS_COACH_CHANGED',
        entityType: 'GROUP_CLASS',
        entityId: classId,
        oldData: { coachId: groupClass.coachId },
        newData: { coachId: newCoachId },
      });
      await notify(tx, {
        userIds: [groupClass.coachId, newCoachId, ...groupClass.registrations.map((item) => item.memberId)],
        type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Huấn luyện viên lớp học đã thay đổi',
        content: `Huấn luyện viên phụ trách lớp "${groupClass.name}" đã được thay đổi.`,
      });
      return updated;
    });
  }
}

export default new GroupClassService();