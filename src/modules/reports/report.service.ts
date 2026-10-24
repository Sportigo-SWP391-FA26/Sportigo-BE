import { PrismaClient, AttendanceStatus, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export class ReportService {
  /**
   * Báo cáo Thống kê Điểm danh & Hiệu suất tham gia lớp (FR-36)
   */
  async getAttendanceReport(classId?: number) {
    const whereCondition: Prisma.SessionAttendanceWhereInput = {};
    if (classId) {
      whereCondition.classSession = {
        classId: Number(classId),
      };
    }

    const attendances = await prisma.sessionAttendance.findMany({
      where: whereCondition,
      include: {
        registration: { include: { member: true } },
        classSession: {
          include: { groupClass: true },
        },
      },
    });

    const totalCheckIns = attendances.length;
    const presentCount = attendances.filter((a) => a.status === AttendanceStatus.PRESENT).length;
    const absentCount = attendances.filter((a) => a.status === AttendanceStatus.ABSENT).length;
    const lateCount = attendances.filter((a) => a.status === AttendanceStatus.LATE).length;

    return {
      totalRecords: totalCheckIns,
      statistics: {
        present: presentCount,
        absent: absentCount,
        late: lateCount,
      },
      details: attendances,
    };
  }
}

export default new ReportService();
