import { PrismaClient, ClassStatus, RegistrationStatus, OrderStatus, OrderItemType, Prisma  } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { lockGroupClass } from '../../lib/group-class-lock.js';
import waitlistService from '../waitlist/waitlist.service.js';
import { assertClassRegistrationCancellable } from './cancellation-policy.js';

const prisma = new PrismaClient();

export class BookingService {
  /**
   * FR-21: Lọc và tìm kiếm lớp nhóm công khai (Phân trang)
   */
  async getPublicClasses(filters: {
    sportId?: number;
    coachId?: number;
    status?: ClassStatus;
    date?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ? Number(filters.page) : 1;
    const limit = filters.limit ? Number(filters.limit) : 10;
    const skip = (page - 1) * limit;

    const where: Prisma.GroupClassWhereInput = {
      status: ClassStatus.OPEN,
    };

    if (filters.sportId) where.sportId = Number(filters.sportId);
    if (filters.coachId) where.coachId = Number(filters.coachId);
    if (filters.date) {
      const targetDate = new Date(filters.date);
      where.startDate = { lte: targetDate };
      where.endDate = { gte: targetDate };
    }

    const [classes, total] = await Promise.all([
      prisma.groupClass.findMany({
        where,
        include: {
          sport: true,
          coach: { include: { user: { select: { id: true, displayName: true } } } },
          _count: {
            select: {
              registrations: { where: { status: RegistrationStatus.CONFIRMED } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { startDate: 'asc' },
      }),
      prisma.groupClass.count({ where }),
    ]);

    return {
      data: classes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * FR-22: Xem chi tiết lớp nhóm, lịch buổi học, học phí và số chỗ còn lại
   */
  async getClassDetail(classId: number) {
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: classId, status: ClassStatus.OPEN },
      include: {
        sport: true,
        coach: { include: { user: { select: { id: true, displayName: true } } } },
        sessions: {
          include: { room: true },
          orderBy: { startsAt: 'asc' },
        },
        _count: {
          select: {
            registrations: { where: { status: RegistrationStatus.CONFIRMED } },
          },
        },
      },
    });

    if (!groupClass) {
      throw new HttpError(404, 'Không tìm thấy thông tin lớp học.', 'CLASS_NOT_FOUND');
    }

    const confirmedCount = groupClass._count.registrations;
    const pendingCount = await prisma.classRegistration.count({
      where: { classId, status: RegistrationStatus.PENDING_PAYMENT },
    });
    const occupiedCount = confirmedCount + pendingCount;
    const remainingSeats = groupClass.capacity - occupiedCount;

    return {
      ...groupClass,
      confirmedCount,
      remainingSeats,
    };
  }

  private async validateMemberSchedule(memberId: number, classId: number) {
    const proposedSessions = await prisma.classSession.findMany({
      where: { classId, status: 'SCHEDULED' },
      select: { startsAt: true, endsAt: true },
    });
    if (proposedSessions.length === 0) return;

    const firstStart = new Date(
      Math.min(...proposedSessions.map((session) => session.startsAt.getTime())),
    );
    const lastEnd = new Date(
      Math.max(...proposedSessions.map((session) => session.endsAt.getTime())),
    );
    const [confirmedSessions, privateSchedules] = await Promise.all([
      prisma.classSession.findMany({
        where: {
          status: 'SCHEDULED',
          groupClass: {
            registrations: {
              some: { memberId, status: RegistrationStatus.CONFIRMED },
            },
          },
          startsAt: { lt: lastEnd },
          endsAt: { gt: firstStart },
        },
        select: { startsAt: true, endsAt: true },
      }),
      prisma.privateCourseSchedule.findMany({
        where: {
          status: 'ACTIVE',
          enrollment: { memberId, status: 'ACTIVE' },
          effectiveFrom: { lte: lastEnd },
          effectiveTo: { gte: firstStart },
        },
        select: {
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      }),
    ]);

    const overlaps = proposedSessions.some((candidate) => {
      if (confirmedSessions.some(
        (existing) =>
          candidate.startsAt < existing.endsAt &&
          candidate.endsAt > existing.startsAt,
      )) {
        return true;
      }

      return privateSchedules.some((schedule) => {
        const date = new Date(Date.UTC(
          candidate.startsAt.getUTCFullYear(),
          candidate.startsAt.getUTCMonth(),
          candidate.startsAt.getUTCDate(),
        ));
        const effectiveFrom = new Date(schedule.effectiveFrom);
        const effectiveTo = new Date(schedule.effectiveTo);
        if (
          date.getUTCDay() !== schedule.dayOfWeek ||
          date < effectiveFrom ||
          date > effectiveTo
        ) {
          return false;
        }

        const scheduledStart = new Date(date);
        scheduledStart.setUTCHours(
          schedule.startTime.getUTCHours(),
          schedule.startTime.getUTCMinutes(),
          schedule.startTime.getUTCSeconds(),
          0,
        );
        const scheduledEnd = new Date(date);
        scheduledEnd.setUTCHours(
          schedule.endTime.getUTCHours(),
          schedule.endTime.getUTCMinutes(),
          schedule.endTime.getUTCSeconds(),
          0,
        );
        return candidate.startsAt < scheduledEnd && candidate.endsAt > scheduledStart;
      });
    });

    if (overlaps) {
      throw new HttpError(409, 'Lịch học của hội viên bị chồng lấn.', 'MEMBER_SCHEDULE_CONFLICT');
    }
  }

  /**
   * FR-23 & FR-24: Đăng ký lớp nhóm, kiểm tra cửa sổ đăng ký, chỉ tiêu và tạo Order thanh toán
   */
  async registerClass(memberId: number, classId: number) {
    const now = new Date();

    // 1. Lấy thông tin lớp học kèm số lượng đã đăng ký (CONFIRMED hoặc PENDING_PAYMENT giữ chỗ)
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: classId },
      include: {
        _count: {
          select: {
            registrations: {
              where: {
                status: { in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT] },
              },
            },
          },
        },
      },
    });

    if (!groupClass) {
      throw new HttpError(404, 'Lớp học không tồn tại trong hệ thống.', 'CLASS_NOT_FOUND');
    }

    // FR-24: Kiểm tra trạng thái lớp học
    if (groupClass.status !== ClassStatus.OPEN) {
      throw new HttpError(409, `Lớp học này hiện không mở đăng ký (Trạng thái: ${groupClass.status}).`, 'CLASS_NOT_OPEN');
    }

    // FR-24: Kiểm tra cửa sổ đăng ký (Registration Window)
    if (now < groupClass.registrationOpenAt) {
      throw new HttpError(409, 'Chưa đến thời gian mở đăng ký cho lớp học này.', 'REGISTRATION_NOT_OPEN');
    }
    if (now > groupClass.registrationCloseAt) {
      throw new HttpError(409, 'Đã quá thời hạn đóng đăng ký lớp học này.', 'REGISTRATION_CLOSED');
    }
    if (now >= groupClass.startDate) {
      throw new HttpError(409, 'Lớp học đã bắt đầu diễn ra, không thể đăng ký mới.', 'CLASS_ALREADY_STARTED');
    }

    // FR-24: Kiểm tra sức chứa & số chỗ còn lại (Capacity check)
    const currentOccupied = groupClass._count.registrations;
    if (currentOccupied >= groupClass.capacity) {
      throw new HttpError(409, 'Lớp học đã hết chỗ (Fully booked). Bạn có thể tham gia danh sách chờ (Waitlist).', 'CLASS_FULL');
    }

    // Ngăn chặn đăng ký trùng lặp (Member-class uniqueness)
    const existingRegistration = await prisma.classRegistration.findUnique({
      where: { memberId_classId: { memberId, classId } },
    });

    if (existingRegistration) {
      if (existingRegistration.status === RegistrationStatus.CONFIRMED) {
        throw new HttpError(409, 'Bạn đã đăng ký thành công lớp học này rồi.', 'ALREADY_REGISTERED');
      }
      if (existingRegistration.status === RegistrationStatus.PENDING_PAYMENT) {
        throw new HttpError(409, 'Bạn đã có một đơn đăng ký đang chờ thanh toán cho lớp học này.', 'REGISTRATION_PENDING_PAYMENT');
      }
    }

    await this.validateMemberSchedule(memberId, classId);

    // Thực hiện Transaction: Tạo Order thanh toán + Bản ghi đăng ký PENDING_PAYMENT
    return await prisma.$transaction(async (tx) => {
      if (!await lockGroupClass(tx, classId)) {
        throw new HttpError(404, 'Lớp học không tồn tại trong hệ thống.', 'CLASS_NOT_FOUND');
      }
      await waitlistService.offerNextInTransaction(tx, classId, now);
      const activeOffer = await tx.classWaitlist.findFirst({
        where: { classId, status: 'OFFERED', offerExpiresAt: { gt: now } },
      });
      const lockedClass = await tx.groupClass.findUnique({
        where: { id: classId },
        include: {
          _count: {
            select: {
              registrations: {
                where: {
                  status: { in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT] },
                },
              },
            },
          },
        },
      });
      if (!lockedClass) throw new HttpError(404, 'Lớp học không tồn tại trong hệ thống.', 'CLASS_NOT_FOUND');
      if (
        lockedClass.status !== ClassStatus.OPEN ||
        now < lockedClass.registrationOpenAt ||
        now > lockedClass.registrationCloseAt ||
        now >= lockedClass.startDate
      ) {
        throw new HttpError(409, 'Lớp học hiện không thể nhận đăng ký.', 'CLASS_NOT_OPEN');
      }
      if (lockedClass._count.registrations + Number(Boolean(activeOffer)) >= lockedClass.capacity) {
        throw new HttpError(409, 'Lớp học đã hết chỗ. Bạn có thể tham gia danh sách chờ (Waitlist).', 'CLASS_FULL');
      }
      const lockedExistingRegistration = await tx.classRegistration.findUnique({
        where: { memberId_classId: { memberId, classId } },
      });
      if (
        lockedExistingRegistration &&
        lockedExistingRegistration.status !== RegistrationStatus.CANCELLED
      ) {
        throw new HttpError(409, 'Bạn đã có đăng ký đang hoạt động cho lớp học này.', 'ALREADY_REGISTERED');
      }
      const member = await tx.member.findUnique({ where: { userId: memberId }, select: { userId: true } });
      if (!member) throw new HttpError(404, 'Không tìm thấy hội viên.', 'MEMBER_NOT_FOUND');

      const orderNumber = `ORD-GC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Tạo ServiceOrder (Giữ chỗ trong 15 phút)
      const order = await tx.serviceOrder.create({
        data: {
          memberId,
          orderNumber,
          originalAmount: lockedClass.tuitionFee,
          finalAmount: lockedClass.tuitionFee,
          status: OrderStatus.PENDING_PAYMENT,
          expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        },
      });


      // Tạo ClassRegistration
      const registration = lockedExistingRegistration
        ? await tx.classRegistration.update({
            where: { id: lockedExistingRegistration.id },
            data: {
              status: RegistrationStatus.PENDING_PAYMENT,
              registeredAt: now,
              cancelledAt: null,
              price: lockedClass.tuitionFee,
            },
          })
        : await tx.classRegistration.create({
            data: {
              memberId,
              classId,
              status: RegistrationStatus.PENDING_PAYMENT,
              price: lockedClass.tuitionFee,
            },
          });

      // Tạo OrderItem liên kết
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          classRegistrationId: registration.id,
          itemType: OrderItemType.GROUP_CLASS,
          itemNameSnapshot: `Đăng ký lớp nhóm: ${lockedClass.name}`,
          unitPrice: lockedClass.tuitionFee,
          finalAmount: lockedClass.tuitionFee,
        },
      });
      

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: order.finalAmount,
        expiresAt: order.expiresAt,
        registrationId: registration.id,
        status: registration.status,
      };
    });
  }

  async registerClassOnBehalf(memberId: number, classId: number) {
    const member = await prisma.member.findUnique({
      where: { userId: memberId },
      select: { userId: true },
    });
    if (!member) {
      throw new HttpError(404, 'Không tìm thấy hội viên.', 'MEMBER_NOT_FOUND');
    }
    return this.registerClass(member.userId, classId);
  }
  /**
   * FR-28: Hủy đăng ký theo thời hạn cấu hình tập trung
   */
  async cancelClassRegistration(
    registrationId: number,
    actor: { id: number; role: string },
  ) {
    // 1. Lấy thông tin đăng ký kèm thông tin lớp nhóm và buổi học đầu tiên
    const registration = await prisma.classRegistration.findUnique({
      where: { id: registrationId },
      include: {
        groupClass: {
          include: {
            sessions: {
              orderBy: { startsAt: 'asc' },
              take: 1, // Lấy buổi học đầu tiên của lớp
            },
          },
        },
        member: {
          include: { wallet: true },
        },
      },
    });

    if (!registration) {
      throw new HttpError(404, 'Không tìm thấy thông tin đăng ký lớp học.', 'REGISTRATION_NOT_FOUND');
    }

    if (actor.role === 'MEMBER' && registration.memberId !== actor.id) {
      throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.', 'FORBIDDEN');
    }
    if (!['MEMBER', 'RECEPTIONIST'].includes(actor.role)) {
      throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.', 'FORBIDDEN');
    }

    if (registration.status === RegistrationStatus.CANCELLED) {
      throw new HttpError(409, 'Đăng ký này đã bị hủy trước đó rồi.', 'REGISTRATION_ALREADY_CANCELLED');
    }

    const firstSession = registration.groupClass.sessions[0];
    if (!firstSession) {
      throw new HttpError(409, 'Lớp học này chưa có lịch trình các buổi học.', 'CLASS_HAS_NO_SESSIONS');
    }

    const now = new Date();
    assertClassRegistrationCancellable(firstSession.startsAt, actor.role, now)

    const classId = registration.groupClass.id;
    const memberId = registration.memberId;

    return await prisma.$transaction(async (tx) => {
      if (!await lockGroupClass(tx, classId)) {
        throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND');
      }
      const currentRegistration = await tx.classRegistration.findUnique({
        where: { id: registrationId },
        include: {
          groupClass: {
            include: { sessions: { orderBy: { startsAt: 'asc' }, take: 1 } },
          },
          member: { include: { wallet: true } },
        },
      });
      if (!currentRegistration) {
        throw new HttpError(404, 'Không tìm thấy thông tin đăng ký lớp học.', 'REGISTRATION_NOT_FOUND');
      }
      if (currentRegistration.status === RegistrationStatus.CANCELLED) {
        throw new HttpError(409, 'Đăng ký này đã bị hủy trước đó rồi.', 'REGISTRATION_ALREADY_CANCELLED');
      }

      const currentFirstSession = currentRegistration.groupClass.sessions[0];
      if (!currentFirstSession) {
        throw new HttpError(409, 'Lớp học này chưa có lịch trình các buổi học.', 'CLASS_HAS_NO_SESSIONS');
      }
      assertClassRegistrationCancellable(currentFirstSession.startsAt, actor.role, new Date())

      const refundAmount = currentRegistration.status === RegistrationStatus.CONFIRMED
        ? Number(currentRegistration.price)
        : 0;
      const cancelled = await tx.classRegistration.updateMany({
        where: { id: registrationId, status: currentRegistration.status },
        data: {
          status: RegistrationStatus.CANCELLED,
          cancelledAt: now,
        },
      });
      if (cancelled.count !== 1) {
        throw new HttpError(409, 'Đăng ký đã được cập nhật đồng thời.', 'REGISTRATION_STATE_CHANGED');
      }

      if (refundAmount > 0) {
        let wallet = currentRegistration.member.wallet;
        if (!wallet) {
          wallet = await tx.wallet.create({
            data: { memberId, balance: 0 },
          });
        }

        const balanceBefore = Number(wallet.balance);
        const balanceAfter = balanceBefore + refundAmount;
        const idempotencyKey = `REFUND-GC-${registrationId}-${Date.now()}`;

        // Cập nhật số dư ví
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter, version: { increment: 1 } },
        });

        // Ghi nhận giao dịch ví
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            createdById: actor.id,
            type: 'REFUND_CREDIT',
            amount: refundAmount,
            balanceBefore,
            balanceAfter,
            referenceType: 'CLASS_CANCELLATION',
            referenceId: String(registrationId),
            idempotencyKey,
            description: `Hoàn tiền 100% do hủy lớp nhóm: ${currentRegistration.groupClass.name}`,
          },
        });
      }

      if (currentRegistration.status === RegistrationStatus.PENDING_PAYMENT) {
        await tx.serviceOrder.updateMany({
          where: {
            status: OrderStatus.PENDING_PAYMENT,
            items: { some: { classRegistrationId: registrationId } },
          },
          data: { status: OrderStatus.CANCELLED },
        });
      }

      await waitlistService.offerNextInTransaction(tx, classId, now);
      return {
        registrationId,
        status: RegistrationStatus.CANCELLED,
        refundedAmount: refundAmount,
        message: 'Hủy đăng ký lớp thành công và đã hoàn tiền vào ví.',
      };
    });
  }

  async cancelGroupClass(classId: number, actorUserId: number) {
    return prisma.$transaction(async (tx) => {
      if (!await lockGroupClass(tx, classId)) {
        throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND');
      }
      const groupClass = await tx.groupClass.findUnique({
        where: { id: classId },
        include: {
          registrations: {
            where: {
              status: {
                in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT],
              },
            },
          },
        },
      });
      if (!groupClass) {
        throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND');
      }
      if (groupClass.status === ClassStatus.CANCELLED) {
        throw new HttpError(409, 'Lớp học đã được hủy trước đó.', 'CLASS_ALREADY_CANCELLED');
      }

      await tx.groupClass.update({
        where: { id: classId },
        data: { status: ClassStatus.CANCELLED },
      });
      let refundedAmount = 0;
      for (const registration of groupClass.registrations) {
        if (registration.status === RegistrationStatus.CONFIRMED) {
          const amount = Number(registration.price);
          const wallet = await tx.wallet.upsert({
            where: { memberId: registration.memberId },
            create: { memberId: registration.memberId },
            update: {},
          });
          const balanceAfter = Number(wallet.balance) + amount;
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: amount }, version: { increment: 1 } },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              createdById: actorUserId,
              type: 'REFUND_CREDIT',
              amount,
              balanceBefore: wallet.balance,
              balanceAfter,
              referenceType: 'CLASS_CANCELLATION',
              referenceId: String(registration.id),
              idempotencyKey: `CLASS-CANCEL-${classId}-${registration.id}`,
              description: `Hoàn tiền 100% do trung tâm hủy lớp: ${groupClass.name}`,
            },
          });
          refundedAmount += amount;
          await tx.classRegistration.update({
            where: { id: registration.id },
            data: { status: RegistrationStatus.REFUNDED, cancelledAt: new Date() },
          });
        } else {
          await tx.classRegistration.update({
            where: { id: registration.id },
            data: { status: RegistrationStatus.CANCELLED, cancelledAt: new Date() },
          });
        }
      }

      await tx.classWaitlist.updateMany({
        where: {
          classId,
          status: { in: ['WAITING', 'OFFERED'] },
        },
        data: { status: 'CANCELLED' },
      });
      await tx.serviceOrder.updateMany({
        where: {
          status: OrderStatus.PENDING_PAYMENT,
          items: { some: { classRegistrationId: { in: groupClass.registrations.map((item) => item.id) } } },
        },
        data: { status: OrderStatus.CANCELLED },
      });
      return {
        classId,
        status: ClassStatus.CANCELLED,
        refundedAmount,
        cancelledRegistrations: groupClass.registrations.length,
      };
    });
  }
}

export default new BookingService();