import { refundExpiredOrderPayment } from '../finance/expired-payment-refund.js';
import {
  ClassStatus,
  WaitlistStatus,
  WaitlistInvitationStatus,
  RegistrationStatus,
  OrderStatus,
  OrderItemType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { lockGroupClass } from '../../lib/group-class-lock.js';
import { prisma } from '../../lib/prisma.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js';

const OFFER_DURATION_MS = 2 * 60 * 60 * 1000;

type SettledPayment = Parameters<typeof refundExpiredOrderPayment>[1]['payment'] & { status: string };

/** Đơn waitlist không hoàn tất: phần đã trả (thường là ví) được hoàn lại vào ví ngay. */
async function refundSettledPayments(
  tx: Prisma.TransactionClient,
  order: { id: number; memberId: number; orderNumber: string; payments: SettledPayment[] },
  reason: string,
) {
  let refunded = 0;
  for (const payment of order.payments) {
    if (payment.status !== 'SUCCESS' && payment.status !== 'PARTIALLY_REFUNDED') continue;
    refunded += Number(await refundExpiredOrderPayment(tx, {
      payment,
      orderId: order.id,
      memberId: order.memberId,
      reason: `Hoàn tiền do đơn ${order.orderNumber} ${reason}`,
    }));
  }
  if (refunded > 0) {
    await notify(tx, {
      userIds: [order.memberId],
      type: NOTIFICATION_TYPES.REFUND,
      title: 'Đã hoàn tiền vào ví',
      content: `Đơn ${order.orderNumber} ${reason}. ${refunded.toLocaleString('vi-VN')} đ đã được hoàn vào ví Sportigo.`,
    });
  }
}

export class WaitlistService {
  async getMemberWaitlists(memberId: number) {
    return prisma.classWaitlist.findMany({
      where: { memberId },
      include: {
        groupClass: { select: { id: true, name: true, status: true, capacity: true } },
        invitations: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                expiresAt: true,
                payments: { select: { id: true, status: true, amount: true, paidAt: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async listWaitlists(filters: {
    classId?: number;
    status?: WaitlistStatus;
    page: number;
    limit: number;
  }) {
    const where = { classId: filters.classId, status: filters.status };
    const [items, total] = await Promise.all([
      prisma.classWaitlist.findMany({
        where,
        include: {
          member: { include: { user: { select: { id: true, displayName: true, email: true } } } },
          groupClass: { select: { id: true, name: true, status: true, capacity: true } },
          invitations: {
            include: {
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  status: true,
                  expiresAt: true,
                  payments: { select: { id: true, status: true, amount: true, paidAt: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.classWaitlist.count({ where }),
    ]);
    return { items, page: filters.page, limit: filters.limit, total };
  }

  async getWaitlistHistory(waitlistId: number) {
    const waitlist = await prisma.classWaitlist.findUnique({
      where: { id: waitlistId },
      select: {
        id: true,
        memberId: true,
        classId: true,
        status: true,
        joinedAt: true,
        offeredAt: true,
        offerExpiresAt: true,
        member: { select: { user: { select: { id: true, displayName: true, email: true } } } },
        groupClass: { select: { id: true, name: true, status: true } },
        invitations: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                expiresAt: true,
                payments: { select: { id: true, status: true, amount: true, paidAt: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!waitlist) throw new HttpError(404, 'Không tìm thấy bản ghi waitlist.', 'WAITLIST_NOT_FOUND');
    return waitlist;
  }

  private async transitionLatestInvitation(
    tx: Prisma.TransactionClient,
    waitlistId: number,
    status: WaitlistInvitationStatus,
    now: Date,
    extra: { orderId?: number; failureReason?: string } = {},
  ) {
    const invitation = await tx.classWaitlistInvitation.findFirst({
      where: { waitlistId, status: WaitlistInvitationStatus.OFFERED },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!invitation) return;
    await tx.classWaitlistInvitation.updateMany({
      where: { id: invitation.id, status: WaitlistInvitationStatus.OFFERED },
      data: { status, respondedAt: now, ...extra },
    });
  }

  async joinWaitlist(memberId: number, classId: number) {
    return prisma.$transaction(async (tx) => {
      if (!await lockGroupClass(tx, classId)) {
        throw new HttpError(404, 'Lớp học không tồn tại.', 'CLASS_NOT_FOUND');
      }
      const groupClass = await tx.groupClass.findUnique({
        where: { id: classId },
        include: {
          _count: {
            select: {
              registrations: {
                where: { status: { in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT] } },
              },
            },
          },
        },
      });
      if (!groupClass) throw new HttpError(404, 'Lớp học không tồn tại.', 'CLASS_NOT_FOUND');
      if (groupClass.status !== ClassStatus.OPEN) {
        throw new HttpError(409, 'Lớp học không mở đăng ký hoặc đã đóng.', 'CLASS_NOT_OPEN');
      }
      const now = new Date();
      if (
        now < groupClass.registrationOpenAt ||
        now > groupClass.registrationCloseAt ||
        now >= groupClass.startDate
      ) {
        throw new HttpError(409, 'Lớp học hiện không nằm trong thời gian đăng ký.', 'REGISTRATION_WINDOW_CLOSED');
      }
      await this.offerNextInTransaction(tx, classId, now);
      const activeOffer = await tx.classWaitlist.findFirst({
        where: { classId, status: WaitlistStatus.OFFERED, offerExpiresAt: { gt: now } },
      });
      if (groupClass._count.registrations + Number(Boolean(activeOffer)) < groupClass.capacity) {
        throw new HttpError(409, 'Lớp học vẫn còn chỗ trống. Vui lòng đăng ký trực tiếp thay vì vào danh sách chờ.', 'CLASS_HAS_SEATS');
      }

      const existingReg = await tx.classRegistration.findUnique({
        where: { memberId_classId: { memberId, classId } },
      });
      if (existingReg && existingReg.status !== RegistrationStatus.CANCELLED) {
        throw new HttpError(409, 'Bạn đã có bản ghi đăng ký chính thức cho lớp học này rồi.', 'ALREADY_REGISTERED');
      }
      const existingWaitlist = await tx.classWaitlist.findUnique({
        where: { memberId_classId: { memberId, classId } },
      });
      if (existingWaitlist?.status === WaitlistStatus.WAITING || existingWaitlist?.status === WaitlistStatus.OFFERED) {
        throw new HttpError(409, 'Bạn đã nằm trong danh sách chờ của lớp học này.', 'ALREADY_WAITLISTED');
      }
      if (existingWaitlist) {
        return tx.classWaitlist.update({
          where: { id: existingWaitlist.id },
          data: {
            status: WaitlistStatus.WAITING,
            joinedAt: now,
            offeredAt: null,
            offerExpiresAt: null,
          },
        });
      }
      return tx.classWaitlist.create({ data: { memberId, classId, status: WaitlistStatus.WAITING, joinedAt: now } });
    });
  }

  async offerNextInTransaction(tx: Prisma.TransactionClient, classId: number, now: Date) {
    const expiredOffers = await tx.classWaitlist.findMany({
      where: {
        classId,
        status: WaitlistStatus.OFFERED,
        offerExpiresAt: { lte: now },
      },
      select: { id: true },
    });
    if (expiredOffers.length > 0) {
      await tx.classWaitlist.updateMany({
        where: { id: { in: expiredOffers.map(({ id }) => id) }, status: WaitlistStatus.OFFERED },
        data: { status: WaitlistStatus.EXPIRED },
      });
      await tx.classWaitlistInvitation.updateMany({
        where: {
          waitlistId: { in: expiredOffers.map(({ id }) => id) },
          status: WaitlistInvitationStatus.OFFERED,
        },
        data: { status: WaitlistInvitationStatus.EXPIRED, respondedAt: now },
      });
    }

    const classInfo = await tx.groupClass.findUnique({
      where: { id: classId },
      include: {
        _count: {
          select: {
            registrations: {
              where: { status: { in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT] } },
            },
          },
        },
      },
    });
    if (
      !classInfo ||
      classInfo.status !== ClassStatus.OPEN ||
      now < classInfo.registrationOpenAt ||
      now > classInfo.registrationCloseAt ||
      now >= classInfo.startDate
    ) {
      return null;
    }

    const activeOffer = await tx.classWaitlist.findFirst({
      where: { classId, status: WaitlistStatus.OFFERED, offerExpiresAt: { gt: now } },
      orderBy: { joinedAt: 'asc' },
    });
    if (activeOffer) return activeOffer;
    if (classInfo._count.registrations >= classInfo.capacity) return null;

    const nextInLine = await tx.classWaitlist.findFirst({
      where: { classId, status: WaitlistStatus.WAITING },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    if (!nextInLine) return null;

    const offerExpiresAt = new Date(now.getTime() + OFFER_DURATION_MS);
    const claimed = await tx.classWaitlist.updateMany({
      where: { id: nextInLine.id, status: WaitlistStatus.WAITING },
      data: { status: WaitlistStatus.OFFERED, offeredAt: now, offerExpiresAt },
    });
    if (claimed.count !== 1) return null;
    await tx.classWaitlistInvitation.create({
      data: {
        waitlistId: nextInLine.id,
        status: WaitlistInvitationStatus.OFFERED,
        offeredAt: now,
        expiresAt: offerExpiresAt,
      },
    });
    // note(FR-54): báo cho người được mời trong cùng transaction; mời thất bại thì không có thông báo
    await notify(tx, {
      userIds: [nextInLine.memberId],
      type: NOTIFICATION_TYPES.WAITLIST_OFFER,
      title: 'Bạn được mời vào lớp từ danh sách chờ',
      content: `Lớp "${classInfo.name}" vừa có chỗ trống. Vui lòng xác nhận và thanh toán trước ${offerExpiresAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`,
    });
    return tx.classWaitlist.findUnique({
      where: { memberId_classId: { memberId: nextInLine.memberId, classId } },
    });
  }

  async processWaitlistOffer(classId: number) {
    return prisma.$transaction(async (tx) => {
      if (!await lockGroupClass(tx, classId)) return null;
      return this.offerNextInTransaction(tx, classId, new Date());
    });
  }

  async expireOffers(now = new Date()) {
    const dueOffers = await prisma.classWaitlist.findMany({
      where: {
        status: WaitlistStatus.OFFERED,
        offerExpiresAt: { lte: now },
      },
      select: { classId: true },
    });
    const duePayments = await prisma.serviceOrder.findMany({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt: { lte: now },
        waitlistInvitation: { is: { status: WaitlistInvitationStatus.ACCEPTED } },
      },
      select: { id: true, waitlistInvitation: { select: { waitlist: { select: { classId: true } } } } },
    });
    const classIds = [...new Set([
      ...dueOffers.map((offer) => offer.classId),
      ...duePayments.flatMap((order) => order.waitlistInvitation ? [order.waitlistInvitation.waitlist.classId] : []),
    ])];
    let expiredCount = 0;
    let expiredPaymentCount = 0;
    for (const classId of classIds) {
      const expiredInClass = await prisma.$transaction(async (tx) => {
        if (!await lockGroupClass(tx, classId)) return { offers: 0, payments: 0 };
        let offers = 0;
        let payments = 0;
        const dueEntries = await tx.classWaitlist.findMany({
          where: {
            classId,
            status: WaitlistStatus.OFFERED,
            offerExpiresAt: { lte: now },
          },
          select: { id: true },
        });
        if (dueEntries.length > 0) {
          const ids = dueEntries.map(({ id }) => id);
          const expired = await tx.classWaitlist.updateMany({
            where: { id: { in: ids }, status: WaitlistStatus.OFFERED, offerExpiresAt: { lte: now } },
            data: { status: WaitlistStatus.EXPIRED },
          });
          offers += expired.count;
          await tx.classWaitlistInvitation.updateMany({
            where: { waitlistId: { in: ids }, status: WaitlistInvitationStatus.OFFERED },
            data: { status: WaitlistInvitationStatus.EXPIRED, respondedAt: now },
          });
        }

        const dueClassOrders = await tx.serviceOrder.findMany({
          where: {
            status: OrderStatus.PENDING_PAYMENT,
            expiresAt: { lte: now },
            waitlistInvitation: { is: { status: WaitlistInvitationStatus.ACCEPTED, waitlist: { classId } } },
          },
          include: {
            waitlistInvitation: { include: { waitlist: true } },
            items: { select: { classRegistrationId: true } },
            payments: { where: { status: { in: ['PENDING', 'SUCCESS', 'PARTIALLY_REFUNDED'] } }, include: { adjustments: true } },
          },
        });
        for (const order of dueClassOrders) {
          const expired = await tx.serviceOrder.updateMany({
            where: { id: order.id, status: OrderStatus.PENDING_PAYMENT, expiresAt: { lte: now } },
            data: { status: OrderStatus.EXPIRED },
          });
          if (expired.count !== 1 || !order.waitlistInvitation) continue;

          const paymentIds = order.payments.filter((payment) => payment.status === 'PENDING').map(({ id }) => id);
          if (paymentIds.length > 0) {
            await tx.payment.updateMany({
              where: { id: { in: paymentIds }, status: 'PENDING' },
              data: { status: 'CANCELLED' },
            });
            await tx.onlineTransaction.updateMany({
              where: { paymentId: { in: paymentIds }, status: 'PENDING' },
              data: { status: 'CANCELLED', processedAt: now },
            });
          }
          const registrationIds = order.items.flatMap((item) => item.classRegistrationId ? [item.classRegistrationId] : []);
          if (registrationIds.length > 0) {
            await tx.classRegistration.updateMany({
              where: { id: { in: registrationIds }, status: RegistrationStatus.PENDING_PAYMENT },
              data: { status: RegistrationStatus.CANCELLED, cancelledAt: now },
            });
          }
          await refundSettledPayments(tx, order, 'hết hạn thanh toán');
          await tx.classWaitlistInvitation.updateMany({
            where: { id: order.waitlistInvitation.id, status: WaitlistInvitationStatus.ACCEPTED },
            data: {
              status: WaitlistInvitationStatus.PAYMENT_EXPIRED,
              respondedAt: now,
              failureReason: 'PAYMENT_EXPIRED',
            },
          });
          await tx.classWaitlist.updateMany({
            where: { id: order.waitlistInvitation.waitlistId, status: WaitlistStatus.ACCEPTED },
            data: { status: WaitlistStatus.EXPIRED },
          });
          payments += 1;
        }
        await this.offerNextInTransaction(tx, classId, now);
        return { offers, payments };
      });
      expiredCount += expiredInClass.offers;
      expiredPaymentCount += expiredInClass.payments;
    }
    return { expiredCount, expiredPaymentCount, processedClasses: classIds.length };
  }

  async respondToOffer(memberId: number, classId: number, accept: boolean) {
    const result = await prisma.$transaction(async (tx) => {
      if (!await lockGroupClass(tx, classId)) {
        throw new HttpError(404, 'Lớp học không tồn tại.', 'CLASS_NOT_FOUND');
      }
      const offer = await tx.classWaitlist.findUnique({
        where: { memberId_classId: { memberId, classId } },
      });
      if (offer?.status === WaitlistStatus.EXPIRED) {
        throw new HttpError(409, 'Lời mời vào lớp đã hết hạn.', 'WAITLIST_OFFER_EXPIRED');
      }
      if (!offer || offer.status !== WaitlistStatus.OFFERED) {
        throw new HttpError(404, 'Không tìm thấy lời mời còn hiệu lực.', 'WAITLIST_OFFER_NOT_FOUND');
      }

      const now = new Date();
      if (!offer.offerExpiresAt || offer.offerExpiresAt <= now) {
        await tx.classWaitlist.updateMany({
          where: { id: offer.id, status: WaitlistStatus.OFFERED },
          data: { status: WaitlistStatus.EXPIRED },
        });
        await this.transitionLatestInvitation(tx, offer.id, WaitlistInvitationStatus.EXPIRED, now);
        await this.offerNextInTransaction(tx, classId, now);
        return { expired: true as const };
      }

      if (!accept) {
        const declined = await tx.classWaitlist.updateMany({
          where: { id: offer.id, status: WaitlistStatus.OFFERED, offerExpiresAt: { gt: now } },
          data: { status: WaitlistStatus.CANCELLED },
        });
        if (declined.count !== 1) return { expired: true as const };
        await this.transitionLatestInvitation(tx, offer.id, WaitlistInvitationStatus.DECLINED, now);
        await this.offerNextInTransaction(tx, classId, now);
        return {
          declined: await tx.classWaitlist.findUnique({
            where: { memberId_classId: { memberId, classId } },
          }),
        };
      }

      const groupClass = await tx.groupClass.findUnique({
        where: { id: classId },
        include: {
          _count: {
            select: {
              registrations: {
                where: { status: { in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT] } },
              },
            },
          },
        },
      });
      if (
        !groupClass ||
        groupClass.status !== ClassStatus.OPEN ||
        now < groupClass.registrationOpenAt ||
        now > groupClass.registrationCloseAt ||
        now >= groupClass.startDate ||
        groupClass._count.registrations >= groupClass.capacity
      ) {
        throw new HttpError(409, 'Lớp hiện không còn chỗ hoặc đã đóng đăng ký.', 'WAITLIST_SEAT_UNAVAILABLE');
      }

      const existingRegistration = await tx.classRegistration.findUnique({
        where: { memberId_classId: { memberId, classId } },
      });
      if (existingRegistration && existingRegistration.status !== RegistrationStatus.CANCELLED) {
        throw new HttpError(409, 'Bạn đã có đăng ký đang hoạt động cho lớp này.', 'ALREADY_REGISTERED');
      }

      const order = await tx.serviceOrder.create({
        data: {
          memberId,
          orderNumber: `ORD-WL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          originalAmount: groupClass.tuitionFee,
          finalAmount: groupClass.tuitionFee,
          status: OrderStatus.PENDING_PAYMENT,
          expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        },
      });
      const registration = existingRegistration
        ? await tx.classRegistration.update({
            where: { id: existingRegistration.id },
            data: { status: RegistrationStatus.PENDING_PAYMENT, registeredAt: now, cancelledAt: null, price: groupClass.tuitionFee },
          })
        : await tx.classRegistration.create({
            data: { memberId, classId, status: RegistrationStatus.PENDING_PAYMENT, price: groupClass.tuitionFee },
          });
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          classRegistrationId: registration.id,
          itemType: OrderItemType.GROUP_CLASS,
          itemNameSnapshot: `Đăng ký lớp nhóm: ${groupClass.name}`,
          unitPrice: groupClass.tuitionFee,
          finalAmount: groupClass.tuitionFee,
        },
      });
      const accepted = await tx.classWaitlist.updateMany({
        where: { id: offer.id, status: WaitlistStatus.OFFERED, offerExpiresAt: { gt: now } },
        data: { status: WaitlistStatus.ACCEPTED },
      });
      if (accepted.count !== 1) {
        throw new HttpError(409, 'Lời mời vào lớp đã hết hạn.', 'WAITLIST_OFFER_EXPIRED');
      }
      await this.transitionLatestInvitation(
        tx,
        offer.id,
        WaitlistInvitationStatus.ACCEPTED,
        now,
        { orderId: order.id },
      );
      return {
        waitlist: await tx.classWaitlist.findUnique({
          where: { memberId_classId: { memberId, classId } },
        }),
        order,
        registration,
      };
    });
    if ('expired' in result) {
      throw new HttpError(409, 'Lời mời vào lớp đã hết hạn.', 'WAITLIST_OFFER_EXPIRED');
    }
    if ('declined' in result) return { waitlist: result.declined, order: null };
    if (Number(result.order.finalAmount) <= 0) {
      // Import động để tránh vòng phụ thuộc finance ↔ waitlist khi nạp module
      const { settleZeroAmountOrder } = await import('../finance/finance.service.js');
      await settleZeroAmountOrder(result.order.id);
    }
    return result;
  }

  async failAcceptedInvitationInTransaction(
    tx: Prisma.TransactionClient,
    orderId: number,
    now: Date,
  ) {
    const invitation = await tx.classWaitlistInvitation.findUnique({
      where: { orderId },
      include: { waitlist: true },
    });
    if (!invitation || invitation.status !== WaitlistInvitationStatus.ACCEPTED) return false;

    const cancelledOrder = await tx.serviceOrder.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
      data: { status: OrderStatus.CANCELLED },
    });
    if (cancelledOrder.count !== 1) return false;

    const classId = invitation.waitlist.classId;
    const failedOrder = await tx.serviceOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { payments: { where: { status: { in: ['SUCCESS', 'PARTIALLY_REFUNDED'] } }, include: { adjustments: true } } },
    });
    await refundSettledPayments(tx, failedOrder, 'thanh toán không thành công');
    await tx.classRegistration.updateMany({
      where: {
        memberId: invitation.waitlist.memberId,
        classId,
        status: RegistrationStatus.PENDING_PAYMENT,
      },
      data: { status: RegistrationStatus.CANCELLED, cancelledAt: now },
    });
    const pendingPayments = await tx.payment.findMany({
      where: { orderId, status: 'PENDING' },
      select: { id: true },
    });
    const paymentIds = pendingPayments.map(({ id }) => id);
    if (paymentIds.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: paymentIds }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await tx.onlineTransaction.updateMany({
        where: { paymentId: { in: paymentIds }, status: 'PENDING' },
        data: { status: 'CANCELLED', processedAt: now },
      });
    }
    await tx.classWaitlistInvitation.updateMany({
      where: { id: invitation.id, status: WaitlistInvitationStatus.ACCEPTED },
      data: {
        status: WaitlistInvitationStatus.PAYMENT_FAILED,
        respondedAt: now,
        failureReason: 'PAYMENT_FAILED',
      },
    });
    await tx.classWaitlist.updateMany({
      where: { id: invitation.waitlistId, status: WaitlistStatus.ACCEPTED },
      data: { status: WaitlistStatus.EXPIRED },
    });
    await this.offerNextInTransaction(tx, classId, now);
    return true;
  }

  async markInvitationFulfilled(tx: Prisma.TransactionClient, orderId: number, now: Date) {
    await tx.classWaitlistInvitation.updateMany({
      where: { orderId, status: WaitlistInvitationStatus.ACCEPTED },
      data: { status: WaitlistInvitationStatus.FULFILLED, respondedAt: now },
    });
  }
}

export default new WaitlistService();
