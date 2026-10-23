import { PrismaClient, AttendanceStatus, RegistrationStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';

const prisma = new PrismaClient();

export class AttendanceService {
  /**
   * FR-29: Điểm danh hội viên cho một buổi học cụ thể
   */
  async checkInMember(data: { sessionId: number; memberId: number; markedById: number; status: AttendanceStatus; notes?: string }) {
    // 1. Kiểm tra buổi học có tồn tại không
    const session = await prisma.classSession.findUnique({
      where: { id: data.sessionId },
    });
    if (!session) {
      throw new HttpError(404, 'Buổi học không tồn tại.', 'SESSION_NOT_FOUND');
    }
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: session.classId },
      select: { coachId: true },
    });
    if (groupClass?.coachId !== data.markedById) {
      throw new HttpError(403, 'Bạn không được phân công phụ trách buổi học này.', 'FORBIDDEN');
    }

    // 2. Kiểm tra hội viên đã đăng ký lớp học này chưa (phải CONFIRMED)
    const registration = await prisma.classRegistration.findUnique({
      where: {
        memberId_classId: {
          memberId: data.memberId,
          classId: session.classId,
        },
      },
    });

    if (!registration || registration.status !== RegistrationStatus.CONFIRMED) {
      throw new HttpError(409, 'Hội viên chưa đăng ký hoặc đăng ký chưa được xác nhận cho lớp học này.', 'REGISTRATION_NOT_CONFIRMED');
    }

    // 3. Kiểm tra xem đã tồn tại bản ghi điểm danh (SessionAttendance) cho buổi này chưa
    // Lưu ý: Dựa theo schema, bảng có relation tới registrationId, nên ta kiểm tra theo classSessionId và registrationId
    const existingAttendance = await prisma.sessionAttendance.findFirst({
      where: {
        classSessionId: data.sessionId,
        registrationId: registration.id,
      },
    });

    if (existingAttendance) {
      // Cập nhật trạng thái điểm danh nếu đã có
      return await prisma.sessionAttendance.update({
        where: { id: existingAttendance.id },
        data: {
          status: data.status,
          checkedAt: new Date(),
          note: data.notes,
          markedById: data.markedById,
        },
      });
    }

    // Tạo mới bản ghi điểm danh
    return await prisma.sessionAttendance.create({
      data: {
        classSessionId: data.sessionId,
        registrationId: registration.id,
        status: data.status,
        checkedAt: new Date(),
        note: data.notes,
        markedById: data.markedById,
      },
    });
  }

  // Lấy danh sách điểm danh của một buổi học
  async getSessionAttendance(sessionId: number, requesterId: number, role: string) {
    const session = await prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new HttpError(404, 'Buổi học không tồn tại.', 'SESSION_NOT_FOUND');
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: session.classId },
      select: { coachId: true },
    });
    if (role === 'COACH' && groupClass?.coachId !== requesterId) {
      throw new HttpError(403, 'Bạn không được phân công phụ trách buổi học này.', 'FORBIDDEN');
    }
    return await prisma.sessionAttendance.findMany({
      where: { classSessionId: sessionId },
      include: {
        registration: {
          include: { member: true },
        },
        markedBy: {
          include: { user: true },
        },
      },
    });
  }
}

export default new AttendanceService();