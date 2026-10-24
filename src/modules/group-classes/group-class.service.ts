import { PrismaClient, ClassStatus, CoachStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import sessionService from '../class-sessions/session.service.js';
import coachService from '../coaches/coach.service.js';

const prisma = new PrismaClient();

export interface CreateGroupClassDto {
  sportId: number;
  coachId: number;
  name: string;
  description?: string;
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
  async assignCoach(classId: number, newCoachId: number) {
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: classId },
      include: { sessions: { where: { status: 'SCHEDULED' } } },
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

    return await prisma.groupClass.update({
      where: { id: classId },
      data: { coachId: newCoachId },
    });
  }
}

export default new GroupClassService();