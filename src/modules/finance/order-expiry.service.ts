import { Prisma } from '@prisma/client'
import { lockGroupClass } from '../../lib/group-class-lock.js'
import { prisma } from '../../lib/prisma.js'
import { withTransactionRetry } from '../../lib/transaction-retry.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import waitlistService from '../waitlist/waitlist.service.js'
import { refundExpiredOrderPayment } from './expired-payment-refund.js'

const BATCH_SIZE = 200

async function expireOrder(orderId: number, classIds: number[], now: Date) {
  return withTransactionRetry(() => prisma.$transaction(async (tx) => {
    // Khóa theo thứ tự id tăng dần để hai đơn cùng lớp không deadlock.
    for (const classId of classIds) await lockGroupClass(tx, classId)

    const claimed = await tx.serviceOrder.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    })
    if (claimed.count !== 1) return false

    const order = await tx.serviceOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, payments: { include: { adjustments: true } } },
    })

    const pendingIds = order.payments.filter((payment) => payment.status === 'PENDING').map((payment) => payment.id)
    if (pendingIds.length > 0) {
      await tx.payment.updateMany({ where: { id: { in: pendingIds }, status: 'PENDING' }, data: { status: 'CANCELLED' } })
      await tx.onlineTransaction.updateMany({
        where: { paymentId: { in: pendingIds }, status: 'PENDING' },
        data: { status: 'CANCELLED', processedAt: now },
      })
    }

    const registrationIds = order.items.flatMap((item) => item.classRegistrationId ? [item.classRegistrationId] : [])
    if (registrationIds.length > 0) {
      await tx.classRegistration.updateMany({
        where: { id: { in: registrationIds }, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: now },
      })
    }
    const enrollmentIds = order.items.flatMap((item) => item.privateEnrollmentId ? [item.privateEnrollmentId] : [])
    if (enrollmentIds.length > 0) {
      await tx.privateCourseEnrollment.updateMany({
        where: { id: { in: enrollmentIds }, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })
      await tx.privateCourseSchedule.updateMany({
        where: { enrollmentId: { in: enrollmentIds }, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      })
    }
    const subscriptionIds = order.items.flatMap((item) => item.memberSubscriptionId ? [item.memberSubscriptionId] : [])
    if (subscriptionIds.length > 0) {
      await tx.memberSubscription.updateMany({
        where: { id: { in: subscriptionIds }, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })
    }
    await tx.promotionReservation.updateMany({ where: { orderId, status: 'ACTIVE' }, data: { status: 'RELEASED' } })

    // Đơn có thể đã trả một phần bằng ví trước khi hết hạn.
    let refunded = new Prisma.Decimal(0)
    for (const payment of order.payments) {
      if (payment.status !== 'SUCCESS' && payment.status !== 'PARTIALLY_REFUNDED') continue
      refunded = refunded.plus(await refundExpiredOrderPayment(tx, {
        payment,
        orderId,
        memberId: order.memberId,
        reason: `Hoàn tiền do đơn ${order.orderNumber} hết hạn thanh toán`,
      }))
    }

    for (const classId of classIds) await waitlistService.offerNextInTransaction(tx, classId, now)

    // Đơn nạp ví bỏ dở không giữ dịch vụ nào, không cần làm phiền hội viên.
    if (registrationIds.length > 0 || enrollmentIds.length > 0 || subscriptionIds.length > 0) {
      const refundText = refunded.greaterThan(0)
        ? ` Số tiền ${Number(refunded.toFixed(0)).toLocaleString('vi-VN')} đ đã trả được hoàn vào ví Sportigo.`
        : ''
      await notify(tx, {
        userIds: [order.memberId],
        type: NOTIFICATION_TYPES.PAYMENT_EXPIRED,
        title: 'Đơn hàng đã hết hạn thanh toán',
        content: `Đơn ${order.orderNumber} chưa được thanh toán đủ trong thời hạn nên đã được hủy.${refundText}`,
      })
    }
    return true
  }))
}

/** Hết hạn các đơn chờ thanh toán. Đơn từ lời mời waitlist do waitlistService.expireOffers xử lý. */
export async function expirePendingOrders(now = new Date()) {
  const due = await prisma.serviceOrder.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      expiresAt: { lte: now },
      OR: [
        { waitlistInvitation: { is: null } },
        { waitlistInvitation: { is: { status: { not: 'ACCEPTED' } } } },
      ],
    },
    select: { id: true, items: { select: { classRegistration: { select: { classId: true } } } } },
    orderBy: { expiresAt: 'asc' },
    take: BATCH_SIZE,
  })

  let expiredCount = 0
  let failedCount = 0
  for (const order of due) {
    const classIds = [...new Set(order.items.flatMap((item) => item.classRegistration ? [item.classRegistration.classId] : []))]
      .sort((left, right) => left - right)
    try {
      if (await expireOrder(order.id, classIds, now)) expiredCount += 1
    } catch (error) {
      // Một đơn lỗi không được chặn các đơn còn lại; lượt sau sẽ thử lại.
      failedCount += 1
      console.error(`Failed to expire order ${order.id}:`, error)
    }
  }
  return { expiredCount, failedCount }
}
