import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'

type RefundablePayment = {
  id: number
  amount: Prisma.Decimal
  channel: 'ONLINE' | 'COUNTER' | 'WALLET'
  adjustments: { type: string; amount: Prisma.Decimal }[]
}

/**
 * Trả về ví khoản đã thu của một đơn hết hạn. Chạy trong transaction của caller.
 * Trả về số tiền đã hoàn, bằng 0 khi không còn gì để hoàn hoặc đã xử lý trước đó.
 */
export async function refundExpiredOrderPayment(
  tx: Prisma.TransactionClient,
  input: { payment: RefundablePayment; orderId: number; memberId: number; reason: string },
) {
  const { payment, orderId, memberId, reason } = input
  const idempotencyKey = `EXPIRED_ORDER_REFUND:${payment.id}`
  if (await tx.walletTransaction.findUnique({ where: { idempotencyKey } })) return new Prisma.Decimal(0)

  const alreadyRefunded = payment.adjustments
    .filter((adjustment) => adjustment.type === 'REFUND')
    .reduce((sum, adjustment) => sum.plus(adjustment.amount), new Prisma.Decimal(0))
  const amount = payment.amount.minus(alreadyRefunded)
  if (amount.lessThanOrEqualTo(0)) return new Prisma.Decimal(0)

  // Worker không có người thao tác, còn createdById là bắt buộc nên ghi theo chủ đơn.
  await tx.paymentAdjustment.create({
    data: { paymentId: payment.id, createdById: memberId, type: 'REFUND', amount, reason },
  })
  await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } })

  const wallet = await tx.wallet.upsert({ where: { memberId }, create: { memberId }, update: {} })
  const balanceAfter = wallet.balance.plus(amount)
  const credited = await tx.wallet.updateMany({
    where: { id: wallet.id, version: wallet.version },
    data: { balance: balanceAfter, version: { increment: 1 } },
  })
  // Lỗi này rollback cả transaction; đơn vẫn chờ xử lý ở lượt worker kế tiếp.
  if (credited.count !== 1) throw new Error(`Wallet ${wallet.id} changed while refunding payment ${payment.id}`)

  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: payment.channel === 'WALLET' ? 'ORDER_DEBIT_REVERSAL' : 'REFUND_CREDIT',
      amount,
      balanceBefore: wallet.balance,
      balanceAfter,
      referenceType: 'ServiceOrder',
      referenceId: String(orderId),
      idempotencyKey,
      description: reason,
    },
  })
  await tx.auditLog.create({
    data: {
      action: 'AUTO_REFUND_EXPIRED_ORDER',
      entityType: 'Payment',
      entityId: String(payment.id),
      newData: { orderId, amount: amount.toString(), walletBalance: balanceAfter.toString() },
    },
  })
  return amount
}

/**
 * VNPay báo thành công cho giao dịch mà đơn đã hết hạn: chỗ đã trả lại cho người khác
 * nên không kích hoạt dịch vụ, nhưng tiền khách đã trả phải được ghi nhận và hoàn vào ví.
 */
export async function refundLateVnpayPayment(paymentId: number, params: Record<string, string>) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: 'CANCELLED', order: { status: 'EXPIRED' } },
      data: { status: 'SUCCESS', paidAt: new Date() },
    })
    if (claimed.count !== 1) return false

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { adjustments: true, order: { select: { id: true, memberId: true, orderNumber: true } } },
    })
    await tx.onlineTransaction.update({
      where: { paymentId },
      data: { providerTransactionId: params.vnp_TransactionNo, responsePayload: params, status: 'SUCCESS', processedAt: new Date() },
    })
    const amount = await refundExpiredOrderPayment(tx, {
      payment,
      orderId: payment.order.id,
      memberId: payment.order.memberId,
      reason: `Hoàn tiền do thanh toán sau khi đơn ${payment.order.orderNumber} đã hết hạn`,
    })
    await notify(tx, {
      userIds: [payment.order.memberId],
      type: NOTIFICATION_TYPES.REFUND,
      title: 'Đã hoàn khoản thanh toán muộn vào ví',
      content: `Đơn ${payment.order.orderNumber} đã hết hạn trước khi thanh toán hoàn tất. Số tiền ${Number(amount.toFixed(0)).toLocaleString('vi-VN')} đ đã được cộng vào ví Sportigo.`,
    })
    return true
  })
}
