import { ClassStatus, WaitlistStatus, RegistrationStatus, OrderStatus, OrderItemType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { lockGroupClass } from '../../lib/group-class-lock.js';
import { prisma } from '../../lib/prisma.js';

const OFFER_DURATION_MS = 2 * 60 * 60 * 1000;

export class WaitlistService {
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
      return tx.classWaitlist.create({ data: { memberId, classId, status: WaitlistStatus.WAITING } });
    });
  }

  async offerNextInTransaction(tx: Prisma.TransactionClient, classId: number, now: Date) {
    await tx.classWaitlist.updateMany({
      where: {
        classId,
        status: WaitlistStatus.OFFERED,
        offerExpiresAt: { lte: now },
      },
      data: { status: WaitlistStatus.EXPIRED },
    });

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
    const classIds = [...new Set(dueOffers.map((offer) => offer.classId))];
    let expiredCount = 0;
    for (const classId of classIds) {
      expiredCount += await prisma.$transaction(async (tx) => {
        if (!await lockGroupClass(tx, classId)) return 0;
        const expired = await tx.classWaitlist.updateMany({
          where: {
            classId,
            status: WaitlistStatus.OFFERED,
            offerExpiresAt: { lte: now },
          },
          data: { status: WaitlistStatus.EXPIRED },
        });
        await this.offerNextInTransaction(tx, classId, now);
        return expired.count;
      });
    }
    return { expiredCount, processedClasses: classIds.length };
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
        await this.offerNextInTransaction(tx, classId, now);
        return { expired: true as const };
      }

      if (!accept) {
        const declined = await tx.classWaitlist.updateMany({
          where: { id: offer.id, status: WaitlistStatus.OFFERED, offerExpiresAt: { gt: now } },
          data: { status: WaitlistStatus.CANCELLED },
        });
        if (declined.count !== 1) return { expired: true as const };
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
    return result;
  }
}

export default new WaitlistService();
