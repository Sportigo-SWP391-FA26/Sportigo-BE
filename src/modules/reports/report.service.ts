import { PrismaClient, OrderStatus, AttendanceStatus, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export class ReportService {
  /**
   * Báo cáo Thống kê Doanh thu (FR-34 / FR-35)
   */
  async getRevenueReport(startDate?: string, endDate?: string) {
    const whereCondition: Prisma.ServiceOrderWhereInput = {
      status: OrderStatus.PAID,
    };

    if (startDate && endDate) {
      whereCondition.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Sử dụng đúng tên quan hệ 'items' từ schema
    const orders = await prisma.serviceOrder.findMany({
      where: whereCondition,
      include: {
        items: true,
      },
    });

    let totalRevenue = 0;
    const totalOrders = orders.length;

    orders.forEach((order) => {
      totalRevenue += Number(order.finalAmount);
    });

    return {
      period: {
        startDate: startDate || 'Tất cả',
        endDate: endDate || 'Tất cả',
      },
      totalOrders,
      totalRevenue,
      ordersSummary: orders.map((o) => ({
        orderNumber: o.orderNumber,
        amount: Number(o.finalAmount),
        paidAt: o.paidAt,
        itemsCount: o.items.length,
      })),
    };
  }

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