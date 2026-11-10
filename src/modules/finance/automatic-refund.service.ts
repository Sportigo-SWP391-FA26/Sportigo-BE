import { Prisma, type PrismaClient } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'

type Db = Prisma.TransactionClient | PrismaClient

type AutomaticClassRefundInput = {
  registrationId: number
  memberId: number
  actorId: number
  reason: string
  idempotencyKey: string
  refundRate?: number
  ipAddress?: string
}

const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2)

/**
 * Completes an automatic class-cancellation refund inside the caller's transaction.
 * Booking owns cancellation/capacity; Finance owns every monetary mutation.
 */
export async function refundClassRegistrationToWallet(
  tx: Db,
  input: AutomaticClassRefundInput,
) {
  const existingCredit = await tx.walletTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  })
  if (existingCredit) {
    return { amount: Number(existingCredit.amount), alreadyProcessed: true }
  }

  const order = await tx.serviceOrder.findFirst({
    where: { items: { some: { classRegistrationId: input.registrationId } } },
    include: {
      items: { where: { classRegistrationId: input.registrationId }, include: { paymentAdjustments: { where: { type: 'REFUND' } } } },
      payments: { include: { adjustments: true } },
    },
  })
  if (!order || order.memberId !== input.memberId) {
    throw new HttpError(409, 'Không tìm thấy đơn hàng đã thanh toán của đăng ký lớp.', 'PAID_ORDER_NOT_FOUND')
  }
  const orderItem = order.items[0]
  if (!orderItem) throw new HttpError(409, 'Không tìm thấy dịch vụ cần hoàn trong đơn hàng.', 'ORDER_ITEM_NOT_FOUND')
  const alreadyRefundedForItem = orderItem.paymentAdjustments.reduce((sum, adjustment) => sum.plus(adjustment.amount), money(0))
  const itemRemaining = Prisma.Decimal.max(money(0), orderItem.finalAmount.minus(alreadyRefundedForItem))

  const refundablePayments = order.payments
    .filter((payment) => ['SUCCESS', 'PARTIALLY_REFUNDED'].includes(payment.status))
    .map((payment) => {
      const refunded = payment.adjustments
        .filter((adjustment) => adjustment.type === 'REFUND')
        .reduce((sum, adjustment) => sum.plus(adjustment.amount), money(0))
      return { payment, refundable: Prisma.Decimal.max(money(0), payment.amount.minus(refunded)) }
    })
    .filter(({ refundable }) => refundable.greaterThan(0))

  const refundAmount = Prisma.Decimal.min(itemRemaining, refundablePayments.reduce(
    (sum, item) => sum.plus(item.refundable),
    money(0),
  ), money(orderItem.finalAmount).mul(input.refundRate ?? 1).toDecimalPlaces(2))
  if (refundAmount.lessThanOrEqualTo(0)) {
    throw new HttpError(409, 'Đơn hàng không còn số tiền có thể hoàn.', 'ORDER_NOT_REFUNDABLE')
  }

  let unallocated = refundAmount
  for (const { payment, refundable } of refundablePayments) {
    if (unallocated.lessThanOrEqualTo(0)) break
    const allocation = Prisma.Decimal.min(unallocated, refundable)
    await tx.paymentAdjustment.create({
      data: {
        paymentId: payment.id,
        orderItemId: orderItem.id,
        createdById: input.actorId,
        type: 'REFUND',
        amount: allocation,
        reason: input.reason,
      },
    })
    unallocated = unallocated.minus(allocation)
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: allocation.equals(refundable) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    })
  }

  const wallet = await tx.wallet.upsert({
    where: { memberId: input.memberId },
    create: { memberId: input.memberId },
    update: {},
  })
  const balanceAfter = wallet.balance.plus(refundAmount)
  const credited = await tx.wallet.updateMany({
    where: { id: wallet.id, version: wallet.version },
    data: { balance: balanceAfter, version: { increment: 1 } },
  })
  if (credited.count !== 1) {
    throw new HttpError(409, 'Số dư ví vừa thay đổi, vui lòng thử lại.', 'WALLET_CONFLICT')
  }

  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      createdById: input.actorId,
      type: 'REFUND_CREDIT',
      amount: refundAmount,
      balanceBefore: wallet.balance,
      balanceAfter,
      referenceType: 'CLASS_CANCELLATION',
      referenceId: String(input.registrationId),
      idempotencyKey: input.idempotencyKey,
      description: input.reason,
    },
  })
  const totalRefunded = order.payments.reduce(
    (sum, payment) => sum.plus(payment.adjustments
      .filter((adjustment) => adjustment.type === 'REFUND')
      .reduce((paymentSum, adjustment) => paymentSum.plus(adjustment.amount), money(0))),
    money(0),
  ).plus(refundAmount)
  const orderRefunded = totalRefunded.greaterThanOrEqualTo(order.finalAmount)
  await tx.serviceOrder.update({
    where: { id: order.id },
    data: { status: orderRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  })
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: 'AUTO_REFUND_CLASS_CANCELLATION',
      entityType: 'ClassRegistration',
      entityId: String(input.registrationId),
      newData: {
        orderId: order.id,
        amount: refundAmount.toString(),
        refundRate: input.refundRate ?? 1,
        walletBalance: balanceAfter.toString(),
      },
      ipAddress: input.ipAddress,
    },
  })

  return { amount: Number(refundAmount), alreadyProcessed: false }
}
