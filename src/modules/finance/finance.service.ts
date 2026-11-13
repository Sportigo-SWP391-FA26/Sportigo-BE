import { randomUUID } from 'node:crypto'
import { Prisma, type OrderItemType, type PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { createPaymentUrl, type VnpayParams, verifyVnpay } from './vnpay.js'
import { calculateDiscount, calculateRefundable, calculateRemaining, isFullyRefunded, toMoney } from './finance.math.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import waitlistService from '../waitlist/waitlist.service.js'
import { lockGroupClass } from '../../lib/group-class-lock.js'
import { refundLateVnpayPayment } from './expired-payment-refund.js'
import { activateSubscription } from '../memberships/membership-activation.js'

// note(FR-54): định dạng tiền cho nội dung thông báo
const vnd = (value: Prisma.Decimal) => `${Number(value.toFixed(0)).toLocaleString('vi-VN')} đ`

type Db = Prisma.TransactionClient | PrismaClient
const money = toMoney
const asNumber = (value: Prisma.Decimal) => Number(value.toFixed(2))

async function audit(db: Db, input: { actorId?: number; action: string; entityType: string; entityId: string | number; oldData?: unknown; newData?: unknown; ipAddress?: string }) {
  await db.auditLog.create({ data: { actorId: input.actorId, action: input.action, entityType: input.entityType, entityId: String(input.entityId), oldData: input.oldData as Prisma.InputJsonValue | undefined, newData: input.newData as Prisma.InputJsonValue | undefined, ipAddress: input.ipAddress } })
}

const orderInclude = {
  items: { include: { classRegistration: true, privateEnrollment: true } },
  promotion: true, payments: { include: { paymentMethod: true, onlineTransaction: true, adjustments: true } }, invoice: true,
} satisfies Prisma.ServiceOrderInclude

async function requireOrder(id: number, user: { id: number; role: string }, db: Db = prisma) {
  const order = await db.serviceOrder.findUnique({ where: { id }, include: orderInclude })
  if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng', 'ORDER_NOT_FOUND')
  if (user.role === 'MEMBER' && order.memberId !== user.id) throw new HttpError(403, 'Bạn không có quyền truy cập đơn hàng này', 'FORBIDDEN')
  return order
}

function paidAmount(order: Awaited<ReturnType<typeof requireOrder>>) {
  return order.payments.filter((payment) => payment.status === 'SUCCESS' || payment.status === 'PARTIALLY_REFUNDED').reduce((sum, payment) => sum.plus(payment.amount), money(0))
}

function remaining(order: Awaited<ReturnType<typeof requireOrder>>) {
  return calculateRemaining(order.finalAmount, order.payments)
}

function assertPayable(order: Awaited<ReturnType<typeof requireOrder>>) {
  if (!['CART', 'PENDING_PAYMENT'].includes(order.status)) throw new HttpError(409, 'Đơn hàng không ở trạng thái chờ thanh toán', 'ORDER_NOT_PAYABLE')
  if (order.expiresAt && order.expiresAt <= new Date()) throw new HttpError(409, 'Đơn hàng đã hết hạn thanh toán', 'ORDER_EXPIRED')
}

type ServiceOrderItemInput = {
  itemType: OrderItemType
  itemName: string
  unitPrice: number
  classRegistrationId?: number
  privateEnrollmentId?: number
}

export async function createServiceOrderWithItems(input: { memberId: number; items: ServiceOrderItemInput[]; expiresAt?: Date }) {
  if (input.items.length === 0) throw new HttpError(400, 'Đơn hàng phải có ít nhất một dịch vụ', 'ORDER_ITEMS_REQUIRED')
  for (const item of input.items) {
    const refs = Number(Boolean(item.classRegistrationId)) + Number(Boolean(item.privateEnrollmentId))
    if (refs !== 1) throw new HttpError(400, 'Order Item phải tham chiếu đúng một dịch vụ', 'INVALID_ORDER_ITEM')
  }
  const originalAmount = input.items.reduce((sum, item) => sum.plus(item.unitPrice), money(0))
  return prisma.$transaction(async (tx) => tx.serviceOrder.create({
    data: {
      memberId: input.memberId, orderNumber: `SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      originalAmount, discountAmount: 0, finalAmount: originalAmount, status: 'PENDING_PAYMENT', expiresAt: input.expiresAt,
      items: {
        create: input.items.map((item) => ({
          itemType: item.itemType,
          itemNameSnapshot: item.itemName,
          unitPrice: money(item.unitPrice),
          finalAmount: money(item.unitPrice),
          classRegistrationId: item.classRegistrationId,
          privateEnrollmentId: item.privateEnrollmentId,
        })),
      },
    }, include: orderInclude,
  }))
}

export async function createServiceOrder(input: { memberId: number; itemType: OrderItemType; itemName: string; unitPrice: number; classRegistrationId?: number; privateEnrollmentId?: number; expiresAt?: Date }) {
  return createServiceOrderWithItems({
    memberId: input.memberId,
    expiresAt: input.expiresAt,
    items: [{
      itemType: input.itemType,
      itemName: input.itemName,
      unitPrice: input.unitPrice,
      classRegistrationId: input.classRegistrationId,
      privateEnrollmentId: input.privateEnrollmentId,
    }],
  })
}

export const getOrder = requireOrder

export async function applyPromotion(orderId: number, code: string, user: { id: number; role: string }) {
  const work = async (tx: Prisma.TransactionClient) => {
    const order = await requireOrder(orderId, user, tx)
    assertPayable(order)
    if (paidAmount(order).greaterThan(0)) throw new HttpError(409, 'Không thể đổi khuyến mãi sau khi đã thanh toán một phần', 'ORDER_PARTIALLY_PAID')
    const promotion = await tx.promotion.findUnique({ where: { code: code.toUpperCase() } })
    const now = new Date()
    if (!promotion || promotion.status !== 'ACTIVE' || promotion.startAt > now || promotion.endAt < now) throw new HttpError(400, 'Mã khuyến mãi không hợp lệ hoặc đã hết hạn', 'INVALID_PROMOTION')
    if (order.originalAmount.lessThan(promotion.minOrderAmount)) throw new HttpError(400, 'Đơn hàng chưa đạt giá trị tối thiểu', 'PROMOTION_MINIMUM_NOT_MET')
    const itemTypes = new Set(order.items.map((item) => item.itemType))
    if (itemTypes.has('WALLET_TOP_UP')) throw new HttpError(400, 'Mã khuyến mãi không áp dụng cho giao dịch nạp ví', 'PROMOTION_SCOPE_MISMATCH')
    if (promotion.applicableType !== 'ALL' && !itemTypes.has(promotion.applicableType)) throw new HttpError(400, 'Mã không áp dụng cho dịch vụ này', 'PROMOTION_SCOPE_MISMATCH')
    if (!order.expiresAt) throw new HttpError(409, 'Đơn hàng chưa có thời hạn giữ mã khuyến mãi', 'ORDER_EXPIRY_REQUIRED')
    await tx.promotionReservation.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, data: { status: 'RELEASED' } })
    const [totalUsed, memberUsed, totalReserved, memberReserved] = await Promise.all([
      tx.promotionUsage.count({ where: { promotionId: promotion.id, orderId: { not: order.id } } }),
      tx.promotionUsage.count({ where: { promotionId: promotion.id, memberId: order.memberId, orderId: { not: order.id } } }),
      tx.promotionReservation.count({ where: { promotionId: promotion.id, orderId: { not: order.id }, status: 'ACTIVE', expiresAt: { gt: now } } }),
      tx.promotionReservation.count({ where: { promotionId: promotion.id, memberId: order.memberId, orderId: { not: order.id }, status: 'ACTIVE', expiresAt: { gt: now } } }),
    ])
    if (promotion.totalUsageLimit && totalUsed + totalReserved >= promotion.totalUsageLimit || promotion.perMemberLimit && memberUsed + memberReserved >= promotion.perMemberLimit) throw new HttpError(409, 'Mã khuyến mãi đã hết lượt sử dụng', 'PROMOTION_USAGE_LIMIT')
    const eligibleItems = order.items.filter((item) => promotion.applicableType === 'ALL' || item.itemType === promotion.applicableType)
    const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum.plus(item.unitPrice), money(0))
    const discount = calculateDiscount({ originalAmount: eligibleSubtotal, discountType: promotion.discountType, discountValue: promotion.discountValue, maxDiscount: promotion.maxDiscount })
    const finalAmount = order.originalAmount.minus(discount)
    await tx.serviceOrder.update({ where: { id: order.id }, data: { promotionId: promotion.id, discountAmount: discount, finalAmount } })
    let allocated = money(0)
    for (const [index, item] of eligibleItems.entries()) {
      const itemDiscount = index === eligibleItems.length - 1
        ? discount.minus(allocated)
        : discount.mul(item.unitPrice).div(eligibleSubtotal).toDecimalPlaces(2)
      allocated = allocated.plus(itemDiscount)
      await tx.orderItem.update({ where: { id: item.id }, data: { discountAmount: itemDiscount, finalAmount: item.unitPrice.minus(itemDiscount) } })
    }
    await tx.orderItem.updateMany({ where: { orderId: order.id, id: { notIn: eligibleItems.map((item) => item.id) } }, data: { discountAmount: 0 } })
    for (const item of order.items.filter((candidate) => !eligibleItems.some((eligible) => eligible.id === candidate.id))) {
      await tx.orderItem.update({ where: { id: item.id }, data: { finalAmount: item.unitPrice } })
    }
    await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { amount: finalAmount } })
    await tx.promotionReservation.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, promotionId: promotion.id, memberId: order.memberId, expiresAt: order.expiresAt },
      update: { promotionId: promotion.id, memberId: order.memberId, expiresAt: order.expiresAt, status: 'ACTIVE' },
    })
    await audit(tx, { actorId: user.id, action: 'APPLY_PROMOTION', entityType: 'ServiceOrder', entityId: order.id, oldData: { promotionId: order.promotionId }, newData: { promotionId: promotion.id, discount: discount.toString() } })
    return requireOrder(order.id, user, tx)
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || attempt === 2) throw error }
  }
  throw new HttpError(409, 'Không thể giữ lượt khuyến mãi, vui lòng thử lại', 'PROMOTION_CONFLICT')
}

export async function listPromotions(user: { id: number; role: string }) {
  if (user.role === 'CENTER_MANAGER') return prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } })
  const now = new Date()
  const promotions = await prisma.promotion.findMany({
    where: { isPublic: true, status: 'ACTIVE', startAt: { lte: now }, endAt: { gte: now } },
    include: {
      _count: {
        select: {
          usages: true,
          reservations: { where: { status: 'ACTIVE', expiresAt: { gt: now } } },
        },
      },
      usages: { where: { memberId: user.id }, select: { id: true } },
      reservations: { where: { memberId: user.id, status: 'ACTIVE', expiresAt: { gt: now } }, select: { id: true } },
    },
    orderBy: { endAt: 'asc' },
  })
  return promotions
    .filter((promotion) => (!promotion.totalUsageLimit || promotion._count.usages + promotion._count.reservations < promotion.totalUsageLimit)
      && (!promotion.perMemberLimit || promotion.usages.length + promotion.reservations.length < promotion.perMemberLimit))
    .map((promotion) => ({
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      maxDiscount: promotion.maxDiscount,
      minOrderAmount: promotion.minOrderAmount,
      applicableType: promotion.applicableType,
      startAt: promotion.startAt,
      endAt: promotion.endAt,
    }))
}
export async function createPromotion(data: Prisma.PromotionCreateInput, actorId: number) {
  // BR-49: audit chung transaction, ghi log thất bại thì không tạo khuyến mãi
  return prisma.$transaction(async (tx) => {
    const created = await tx.promotion.create({ data })
    await audit(tx, { actorId, action: 'CREATE_PROMOTION', entityType: 'Promotion', entityId: created.id, newData: created })
    return created
  })
}
export async function updatePromotion(id: number, data: Prisma.PromotionUpdateInput, actorId: number) {
  const old = await prisma.promotion.findUnique({ where: { id } }); if (!old) throw new HttpError(404, 'Không tìm thấy khuyến mãi', 'PROMOTION_NOT_FOUND')
  return prisma.$transaction(async (tx) => {
    const updated = await tx.promotion.update({ where: { id }, data })
    await audit(tx, { actorId, action: 'UPDATE_PROMOTION', entityType: 'Promotion', entityId: id, oldData: old, newData: updated })
    return updated
  })
}

async function ensureMethod(db: Db, code: string, name: string, isOnline: boolean) {
  return db.paymentMethod.upsert({ where: { code }, create: { code, name, isOnline }, update: { name, isOnline, isActive: true } })
}

async function finalizePaidOrder(tx: Prisma.TransactionClient, orderId: number) {
  let order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude })
  const invitation = await tx.classWaitlistInvitation.findUnique({
    where: { orderId },
    include: { waitlist: { select: { classId: true } } },
  })
  if (invitation?.status === 'ACCEPTED') {
    if (!await lockGroupClass(tx, invitation.waitlist.classId)) {
      throw new HttpError(404, 'Lớp học không tồn tại', 'CLASS_NOT_FOUND')
    }
    order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude })
    if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
      throw new HttpError(409, 'Lời mời đã hết hạn hoặc bị hủy; khoản thanh toán không thể xác nhận đăng ký.', 'WAITLIST_PAYMENT_EXPIRED')
    }
  }
  // Worker có thể vừa hết hạn đơn trong lúc giao dịch này chạy: rollback để không xác nhận vượt chỗ đã trả lại.
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') throw new HttpError(409, 'Đơn hàng đã hết hạn hoặc bị hủy', 'ORDER_NOT_PAYABLE')
  if (remaining(order).greaterThan(0)) return order
  if (order.status !== 'PAID') await tx.serviceOrder.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } })
  for (const item of order.items) {
    if (item.classRegistrationId) await tx.classRegistration.update({ where: { id: item.classRegistrationId }, data: { status: 'CONFIRMED' } })
    if (item.privateEnrollmentId) await tx.privateCourseEnrollment.update({ where: { id: item.privateEnrollmentId }, data: { status: 'ACTIVE' } })
    if (item.memberSubscriptionId) await activateSubscription(tx, item.memberSubscriptionId, order.memberId)
  }
  await waitlistService.markInvitationFulfilled(tx, orderId, new Date())
  const topUpItem = order.items.find((item) => item.itemType === 'WALLET_TOP_UP')
  if (topUpItem) {
    const idempotencyKey = `WALLET_TOP_UP:${order.id}`
    const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey } })
    if (!existing) {
      const wallet = await tx.wallet.upsert({ where: { memberId: order.memberId }, create: { memberId: order.memberId }, update: {} })
      const balanceAfter = wallet.balance.plus(order.finalAmount)
      const credited = await tx.wallet.updateMany({ where: { id: wallet.id, version: wallet.version }, data: { balance: balanceAfter, version: { increment: 1 } } })
      if (credited.count !== 1) throw new HttpError(409, 'Số dư ví vừa thay đổi, vui lòng thử lại', 'WALLET_CONFLICT')
      await tx.walletTransaction.create({ data: { walletId: wallet.id, createdById: order.memberId, type: 'TOP_UP_CREDIT', amount: order.finalAmount, balanceBefore: wallet.balance, balanceAfter, referenceType: 'ServiceOrder', referenceId: String(order.id), idempotencyKey, description: `Nạp ví qua VNPay - ${order.orderNumber}` } })
      await audit(tx, { actorId: order.memberId, action: 'WALLET_TOP_UP', entityType: 'Wallet', entityId: wallet.id, newData: { orderId: order.id, amount: order.finalAmount.toString(), balanceAfter: balanceAfter.toString() } })
    }
  }
  if (order.promotionId) {
    await tx.promotionUsage.upsert({ where: { orderId }, create: { orderId, promotionId: order.promotionId, memberId: order.memberId }, update: {} })
    await tx.promotionReservation.updateMany({ where: { orderId, status: 'ACTIVE' }, data: { status: 'CONSUMED' } })
  }
  await tx.invoice.upsert({ where: { orderId }, create: { orderId, invoiceNumber: `INV-${Date.now()}-${orderId}`, subtotal: order.originalAmount, discountAmount: order.discountAmount, totalAmount: order.finalAmount }, update: {} })
  // note(FR-54): chỉ báo lần đầu đơn chuyển sang PAID, callback VNPay lặp lại không tạo thông báo trùng
  if (order.status !== 'PAID') await notify(tx, { userIds: [order.memberId], type: NOTIFICATION_TYPES.PAYMENT_SUCCESS, title: topUpItem ? 'Nạp ví thành công' : 'Thanh toán thành công', content: topUpItem ? `Ví Sportigo đã được cộng ${vnd(order.finalAmount)} từ đơn ${order.orderNumber}.` : `Đơn ${order.orderNumber} đã được thanh toán đủ ${vnd(order.finalAmount)}. Dịch vụ của bạn đã được kích hoạt.` })
  return tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude })
}

export async function createVnpayPayment(orderId: number, user: { id: number; role: string }, ipAddress: string) {
  return prisma.$transaction(async (tx) => {
    const order = await requireOrder(orderId, user, tx); assertPayable(order); const due = remaining(order)
    if (due.lessThanOrEqualTo(0)) throw new HttpError(409, 'Đơn hàng đã được thanh toán đủ', 'ORDER_ALREADY_PAID')
    const pending = await tx.payment.findFirst({ where: { orderId, channel: 'ONLINE', status: 'PENDING' } })
    if (pending) return { paymentId: pending.id, amount: asNumber(pending.amount), paymentUrl: createPaymentUrl({ reference: pending.reference, amount: asNumber(pending.amount), ipAddress, orderInfo: `Thanh toan don hang ${order.orderNumber}` }) }
    const method = await ensureMethod(tx, 'VNPAY', 'VNPay Sandbox', true); const reference = `VNP-${Date.now()}-${order.id}`
    const payment = await tx.payment.create({ data: { orderId, paymentMethodId: method.id, reference, amount: due, channel: 'ONLINE', status: 'PENDING', onlineTransaction: { create: { provider: 'VNPAY', requestPayload: { orderId, amount: due.toString() } } } } })
    return { paymentId: payment.id, amount: asNumber(due), paymentUrl: createPaymentUrl({ reference, amount: asNumber(due), ipAddress, orderInfo: `Thanh toan don hang ${order.orderNumber}` }) }
  })
}

export async function createWalletTopUp(memberId: number, amount: number, ipAddress: string) {
  const topUpAmount = money(amount)
  return prisma.$transaction(async (tx) => {
    const order = await tx.serviceOrder.create({
      data: {
        memberId,
        orderNumber: `TOPUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        originalAmount: topUpAmount,
        discountAmount: 0,
        finalAmount: topUpAmount,
        status: 'PENDING_PAYMENT',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        items: { create: { itemType: 'WALLET_TOP_UP', itemNameSnapshot: 'Nạp tiền vào ví Sportigo', unitPrice: topUpAmount, finalAmount: topUpAmount } },
      },
    })
    const method = await ensureMethod(tx, 'VNPAY', 'VNPay Sandbox', true)
    const reference = `VNP-${Date.now()}-${order.id}`
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        paymentMethodId: method.id,
        reference,
        amount: topUpAmount,
        channel: 'ONLINE',
        status: 'PENDING',
        onlineTransaction: { create: { provider: 'VNPAY', requestPayload: { orderId: order.id, amount: topUpAmount.toString(), purpose: 'WALLET_TOP_UP' } } },
      },
    })
    return {
      paymentId: payment.id,
      orderId: order.id,
      reference,
      amount: asNumber(topUpAmount),
      paymentUrl: createPaymentUrl({ reference, amount: asNumber(topUpAmount), ipAddress, orderInfo: `Nap vi Sportigo ${order.orderNumber}` }),
    }
  })
}

export async function searchCashOrders(query: string) {
  const orders = await prisma.serviceOrder.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { OR: [
          { orderNumber: { contains: query, mode: 'insensitive' } },
          { member: { memberCode: { contains: query, mode: 'insensitive' } } },
          { member: { user: { displayName: { contains: query, mode: 'insensitive' } } } },
        ] },
      ],
    },
    include: { member: { include: { user: { select: { displayName: true, email: true } } } }, items: true, payments: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  return orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    memberName: order.member.user.displayName,
    memberEmail: order.member.user.email,
    memberCode: order.member.memberCode,
    itemNames: order.items.map((item) => item.itemNameSnapshot),
    finalAmount: asNumber(order.finalAmount),
    remainingAmount: asNumber(calculateRemaining(order.finalAmount, order.payments)),
    expiresAt: order.expiresAt,
  }))
}

export async function processVnpayIpn(params: VnpayParams) {
  if (!verifyVnpay(params)) return { RspCode: '97', Message: 'Invalid signature' }
  const reference = params.vnp_TxnRef; const payment = await prisma.payment.findUnique({ where: { reference }, include: { onlineTransaction: true } })
  if (!payment) return { RspCode: '01', Message: 'Order not found' }
  if (!money(params.vnp_Amount ?? 0).div(100).equals(payment.amount)) return { RspCode: '04', Message: 'Invalid amount' }
  if (payment.status === 'SUCCESS') return { RspCode: '02', Message: 'Order already confirmed' }
  if (payment.status === 'CANCELLED' && params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00' && await refundLateVnpayPayment(payment.id, params)) {
    return { RspCode: '00', Message: 'Confirm Success' }
  }
  const invitation = await prisma.classWaitlistInvitation.findUnique({
    where: { orderId: payment.orderId },
    select: { status: true, waitlist: { select: { classId: true } } },
  })
  const processed = await prisma.$transaction(async (tx) => {
    const success = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00'
    if (!success && invitation?.status === 'ACCEPTED' && !await lockGroupClass(tx, invitation.waitlist.classId)) {
      throw new HttpError(404, 'Lớp học không tồn tại', 'CLASS_NOT_FOUND')
    }
    const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: success ? 'SUCCESS' : 'FAILED', paidAt: success ? new Date() : undefined } })
    if (claimed.count !== 1) return false
    await tx.onlineTransaction.update({ where: { paymentId: payment.id }, data: { providerTransactionId: params.vnp_TransactionNo, responsePayload: params, status: success ? 'SUCCESS' : 'FAILED', processedAt: new Date() } })
    await audit(tx, { action: success ? 'ONLINE_PAYMENT_SUCCESS' : 'ONLINE_PAYMENT_FAILED', entityType: 'Payment', entityId: payment.id, newData: { orderId: payment.orderId, amount: payment.amount.toString(), provider: 'VNPAY', transactionNo: params.vnp_TransactionNo, responseCode: params.vnp_ResponseCode } })
    if (success) await finalizePaidOrder(tx, payment.orderId)
    else if (invitation?.status === 'ACCEPTED') {
      await waitlistService.failAcceptedInvitationInTransaction(tx, payment.orderId, new Date())
    }
    return true
  })
  if (!processed) return { RspCode: '02', Message: 'Order already confirmed' }
  return { RspCode: '00', Message: 'Confirm Success' }
}

export async function processVnpayReturn(params: VnpayParams) {
  if (!verifyVnpay(params)) return { valid: false, confirmed: false, paymentStatus: 'INVALID', responseCode: params.vnp_ResponseCode, transactionStatus: params.vnp_TransactionStatus, reference: params.vnp_TxnRef }
  await processVnpayIpn(params)
  const payment = params.vnp_TxnRef ? await prisma.payment.findUnique({ where: { reference: params.vnp_TxnRef }, select: { status: true, orderId: true } }) : null
  return {
    valid: true,
    confirmed: payment?.status === 'SUCCESS',
    paymentStatus: payment?.status ?? 'NOT_FOUND',
    orderId: payment?.orderId,
    responseCode: params.vnp_ResponseCode,
    transactionStatus: params.vnp_TransactionStatus,
    reference: params.vnp_TxnRef,
  }
}

export async function payCash(orderId: number, actorId: number, receivedAmount: number, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    // BR-35: chỉ lễ tân đang hoạt động được ghi nhận tiền mặt
    const collector = await tx.user.findUnique({ where: { id: actorId }, select: { status: true, deletedAt: true, role: { select: { name: true } } } })
    if (!collector || collector.deletedAt || collector.status !== 'ACTIVE' || collector.role.name !== 'RECEPTIONIST') {
      throw new HttpError(403, 'Chỉ nhân viên lễ tân đang hoạt động được phép ghi nhận thanh toán tiền mặt tại quầy', 'CASH_COLLECTOR_NOT_ALLOWED')
    }
    const order = await requireOrder(orderId, { id: actorId, role: 'RECEPTIONIST' }, tx); assertPayable(order); const due = remaining(order)
    if (due.lessThanOrEqualTo(0)) throw new HttpError(409, 'Đơn hàng đã được thanh toán đủ', 'ORDER_ALREADY_PAID')
    if (!money(receivedAmount).equals(due)) throw new HttpError(400, 'Số tiền thu phải đúng bằng số tiền đơn hàng còn thiếu', 'CASH_AMOUNT_MISMATCH')
    const method = await ensureMethod(tx, 'CASH', 'Tiền mặt tại quầy', false)
    const payment = await tx.payment.create({ data: { orderId, paymentMethodId: method.id, collectedById: actorId, reference: `CASH-${Date.now()}-${orderId}`, amount: due, channel: 'COUNTER', status: 'SUCCESS', paidAt: new Date() } })
    await finalizePaidOrder(tx, orderId); await audit(tx, { actorId, action: 'COLLECT_CASH', entityType: 'Payment', entityId: payment.id, newData: { amount: due.toString() }, ipAddress })
    return payment
  })
}

export async function payWithWallet(orderId: number, amount: number, memberId: number) {
  return prisma.$transaction(async (tx) => {
    const order = await requireOrder(orderId, { id: memberId, role: 'MEMBER' }, tx); assertPayable(order); const due = remaining(order); const requested = money(amount)
    if (requested.greaterThan(due)) throw new HttpError(400, 'Số tiền ví vượt quá số tiền còn phải trả', 'WALLET_AMOUNT_EXCEEDS_DUE')
    const wallet = await tx.wallet.upsert({ where: { memberId }, create: { memberId }, update: {} })
    if (wallet.balance.lessThan(requested)) throw new HttpError(409, 'Số dư ví không đủ', 'INSUFFICIENT_WALLET_BALANCE')
    const after = wallet.balance.minus(requested); const key = `ORDER_DEBIT:${orderId}:${randomUUID()}`
    const debit = await tx.wallet.updateMany({ where: { id: wallet.id, version: wallet.version, balance: { gte: requested } }, data: { balance: after, version: { increment: 1 } } })
    if (debit.count !== 1) throw new HttpError(409, 'Số dư ví vừa thay đổi, vui lòng thử lại', 'WALLET_CONFLICT')
    await tx.walletTransaction.create({ data: { walletId: wallet.id, createdById: memberId, type: 'ORDER_DEBIT', amount: requested, balanceBefore: wallet.balance, balanceAfter: after, referenceType: 'ServiceOrder', referenceId: String(orderId), idempotencyKey: key, description: `Thanh toán ${order.orderNumber}` } })
    const method = await ensureMethod(tx, 'WALLET', 'Ví Sportigo', false)
    const payment = await tx.payment.create({ data: { orderId, paymentMethodId: method.id, reference: `WAL-${Date.now()}-${orderId}`, amount: requested, channel: 'WALLET', status: 'SUCCESS', paidAt: new Date() } })
    await audit(tx, { actorId: memberId, action: 'WALLET_PAYMENT', entityType: 'Payment', entityId: payment.id, newData: { orderId, amount: requested.toString(), walletBalance: after.toString() } })
    const updated = await finalizePaidOrder(tx, orderId)
    return { payment, walletBalance: asNumber(after), remainingAmount: asNumber(remaining(updated)) }
  })
}

// Tương thích client cũ: thanh toán toàn bộ số tiền còn lại bằng ví.
// Luồng ghi vẫn đi qua payWithWallet nên giữ nguyên optimistic lock,
// ledger, invoice và idempotency của implementation hiện tại.
export async function payRemainingWithWallet(orderId: number, memberId: number) {
  const order = await requireOrder(orderId, { id: memberId, role: 'MEMBER' })
  assertPayable(order)
  const due = remaining(order)
  if (due.lessThanOrEqualTo(0)) {
    throw new HttpError(409, 'Đơn hàng đã được thanh toán đủ', 'ORDER_ALREADY_PAID')
  }
  return payWithWallet(orderId, asNumber(due), memberId)
}

export async function getWallet(memberId: number, page: number, limit: number) {
  const wallet = await prisma.wallet.upsert({ where: { memberId }, create: { memberId }, update: {} })
  const [transactions, total] = await Promise.all([prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.walletTransaction.count({ where: { walletId: wallet.id } })])
  return { balance: asNumber(wallet.balance), transactions, page, limit, total }
}

export async function listPayments(user: { id: number; role: string }, query: { page: number; limit: number; from?: Date; to?: Date; status?: Prisma.EnumPaymentStatusFilter['equals']; channel?: Prisma.EnumPaymentChannelFilter['equals']; memberId?: number }) {
  const { page, limit } = query
  const where: Prisma.PaymentWhereInput = { status: query.status, channel: query.channel, createdAt: { gte: query.from, lte: query.to }, order: { memberId: user.role === 'MEMBER' ? user.id : query.memberId } }
  const [items, total] = await Promise.all([prisma.payment.findMany({ where, include: { order: { include: { invoice: true, items: true } }, paymentMethod: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.payment.count({ where })])
  return { items, page, limit, total }
}

function refundable(payment: { amount: Prisma.Decimal; adjustments: { amount: Prisma.Decimal; type: string }[] }) {
  return calculateRefundable(payment.amount, payment.adjustments)
}

export async function requestRefund(paymentId: number, memberId: number, requestedAmount: number, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { items: true } } } })
  if (!payment || payment.order.memberId !== memberId) throw new HttpError(404, 'Không tìm thấy giao dịch', 'PAYMENT_NOT_FOUND')
  if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw new HttpError(409, 'Giao dịch không đủ điều kiện hoàn', 'PAYMENT_NOT_REFUNDABLE')
  if (payment.order.items.length !== 1) throw new HttpError(409, 'Đơn hàng có nhiều dịch vụ, vui lòng chọn dịch vụ cần hoàn', 'ORDER_ITEM_REQUIRED')
  return requestOrderItemRefund(payment.order.items[0]!.id, memberId, requestedAmount, reason, paymentId)
}

export async function requestOrderItemRefund(orderItemId: number, memberId: number, requestedAmount: number, reason: string, legacyPaymentId?: number) {
  const work = async (tx: Prisma.TransactionClient) => {
    const item = await tx.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        classRegistration: true,
        privateEnrollment: true,
        paymentAdjustments: { where: { type: 'REFUND' } },
        refundRequests: { where: { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'] } } },
        order: {
          include: {
            payments: { where: { status: { in: ['SUCCESS', 'PARTIALLY_REFUNDED'] } }, include: { adjustments: true } },
            items: { include: { refundRequests: { where: { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'] } } } } },
          },
        },
      },
    })
    if (!item || item.order.memberId !== memberId) throw new HttpError(404, 'Không tìm thấy dịch vụ trong đơn hàng', 'ORDER_ITEM_NOT_FOUND')
    const cancelled = item.classRegistration?.status === 'CANCELLED' || item.privateEnrollment?.status === 'CANCELLED'
    if (!cancelled) throw new HttpError(409, 'Dịch vụ phải được hủy hợp lệ trước khi yêu cầu hoàn tiền', 'SERVICE_NOT_CANCELLED')
    if (item.refundRequests.length > 0) throw new HttpError(409, 'Dịch vụ đã có yêu cầu hoàn tiền đang xử lý', 'REFUND_ALREADY_PENDING')
    const alreadyRefunded = item.paymentAdjustments.reduce((sum, adjustment) => sum.plus(adjustment.amount), money(0))
    const available = Prisma.Decimal.max(money(0), item.finalAmount.minus(alreadyRefunded))
    const requested = money(requestedAmount)
    if (requested.greaterThan(available)) throw new HttpError(400, 'Số tiền yêu cầu vượt quá giá trị còn có thể hoàn của dịch vụ', 'REFUND_AMOUNT_EXCEEDED')
    const totalPaymentCapacity = item.order.payments.reduce((sum, payment) => sum.plus(refundable(payment)), money(0))
    const reservedForPendingRefunds = item.order.items.flatMap((orderItem) => orderItem.refundRequests).reduce((sum, request) => sum.plus(request.approvedAmount ?? request.requestedAmount), money(0))
    if (requested.greaterThan(Prisma.Decimal.max(money(0), totalPaymentCapacity.minus(reservedForPendingRefunds)))) throw new HttpError(409, 'Đơn hàng không còn đủ số tiền đã thanh toán để giữ cho yêu cầu hoàn', 'PAYMENT_REFUND_CAPACITY_EXCEEDED')
    return tx.refundRequest.create({ data: { paymentId: legacyPaymentId, orderItemId, memberId, requestedAmount: requested, reason }, include: { orderItem: true } })
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || attempt === 2) throw error }
  }
  throw new HttpError(409, 'Dữ liệu hoàn tiền vừa thay đổi, vui lòng thử lại', 'REFUND_CONFLICT')
}

export async function listRefunds() {
  return prisma.refundRequest.findMany({
    include: {
      payment: { include: { order: true } },
      orderItem: { include: { order: true } },
      adjustments: { include: { payment: true } },
      member: { include: { user: true } },
    },
    orderBy: { requestedAt: 'desc' },
  })
}
export async function reviewRefund(id: number, decision: 'REVIEW' | 'APPROVE' | 'REJECT', note: string, actorId: number, approvedAmount?: number) {
  const current = await prisma.refundRequest.findUnique({ where: { id } }); if (!current) throw new HttpError(404, 'Không tìm thấy yêu cầu hoàn tiền', 'REFUND_NOT_FOUND')
  // BR-40: REQUESTED → UNDER_REVIEW → APPROVED/REJECTED, không bỏ qua bước xét duyệt
  const allowed = decision === 'REVIEW' ? current.status === 'REQUESTED' : current.status === 'UNDER_REVIEW'
  if (!allowed) throw new HttpError(409, 'Trạng thái hoàn tiền không cho phép thao tác này', 'INVALID_REFUND_TRANSITION')
  const status = decision === 'REVIEW' ? 'UNDER_REVIEW' : decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  if (decision === 'APPROVE' && (!approvedAmount || money(approvedAmount).greaterThan(current.requestedAmount))) throw new HttpError(400, 'Số tiền duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu', 'INVALID_APPROVED_AMOUNT')
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.refundRequest.updateMany({ where: { id, status: current.status }, data: { status, approvedAmount: decision === 'APPROVE' ? money(approvedAmount!) : undefined, reviewedById: actorId, reviewedAt: new Date(), reviewNote: note } })
    if (changed.count !== 1) throw new HttpError(409, 'Trạng thái hoàn tiền không cho phép thao tác này', 'INVALID_REFUND_TRANSITION')
    const row = await tx.refundRequest.findUniqueOrThrow({ where: { id } })
    await audit(tx, { actorId, action: `${decision}_REFUND`, entityType: 'RefundRequest', entityId: id, oldData: current, newData: row })
    return row
  })
  // note(FR-54): báo Member khi yêu cầu hoàn tiền được duyệt hoặc bị từ chối (bước REVIEW chỉ là nội bộ)
  if (decision !== 'REVIEW') await notify(prisma, { userIds: [current.memberId], type: NOTIFICATION_TYPES.REFUND, title: decision === 'APPROVE' ? 'Yêu cầu hoàn tiền đã được duyệt' : 'Yêu cầu hoàn tiền bị từ chối', content: decision === 'APPROVE' ? `Yêu cầu hoàn tiền #${id} được duyệt ${vnd(updated.approvedAmount ?? current.requestedAmount)}. Tiền sẽ được cộng vào ví khi hoàn tất.` : `Yêu cầu hoàn tiền #${id} bị từ chối. Ghi chú: ${note}` })
  return updated
}

export async function completeRefund(id: number, actorId: number, ipAddress?: string) {
  const work = async (tx: Prisma.TransactionClient) => {
    const request = await tx.refundRequest.findUnique({
      where: { id },
      include: {
        adjustments: true,
        orderItem: {
          include: {
            paymentAdjustments: { where: { type: 'REFUND' } },
            order: { include: { items: { include: { paymentAdjustments: { where: { type: 'REFUND' } } } }, payments: { include: { adjustments: true }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] } } },
          },
        },
      },
    })
    if (!request) throw new HttpError(404, 'Không tìm thấy yêu cầu hoàn tiền', 'REFUND_NOT_FOUND')
    if (request.status === 'COMPLETED') return request
    if (request.status !== 'APPROVED') throw new HttpError(409, 'Yêu cầu chưa được duyệt', 'REFUND_NOT_APPROVED')
    const approved = request.approvedAmount ?? request.requestedAmount
    const itemRefunded = request.orderItem.paymentAdjustments.reduce((sum, adjustment) => sum.plus(adjustment.amount), money(0))
    if (approved.greaterThan(request.orderItem.finalAmount.minus(itemRefunded))) throw new HttpError(409, 'Số tiền hoàn vượt quá giá trị còn lại của dịch vụ', 'REFUND_AMOUNT_EXCEEDED')
    let unallocated = approved
    for (const payment of request.orderItem.order.payments) {
      if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(payment.status) || unallocated.lessThanOrEqualTo(0)) continue
      const paymentAvailable = refundable(payment)
      if (paymentAvailable.lessThanOrEqualTo(0)) continue
      const allocation = Prisma.Decimal.min(paymentAvailable, unallocated)
      await tx.paymentAdjustment.create({ data: { paymentId: payment.id, orderItemId: request.orderItemId, refundRequestId: request.id, createdById: actorId, type: 'REFUND', amount: allocation, reason: request.reason } })
      const remainingPayment = paymentAvailable.minus(allocation)
      await tx.payment.update({ where: { id: payment.id }, data: { status: remainingPayment.equals(0) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } })
      unallocated = unallocated.minus(allocation)
    }
    if (unallocated.greaterThan(0)) throw new HttpError(409, 'Không thể phân bổ đủ số tiền hoàn vào các giao dịch đã thanh toán', 'REFUND_ALLOCATION_FAILED')
    const wallet = await tx.wallet.upsert({ where: { memberId: request.memberId }, create: { memberId: request.memberId }, update: {} }); const after = wallet.balance.plus(approved)
    const credit = await tx.wallet.updateMany({ where: { id: wallet.id, version: wallet.version }, data: { balance: after, version: { increment: 1 } } })
    if (credit.count !== 1) throw new HttpError(409, 'Số dư ví vừa thay đổi, vui lòng thử lại', 'WALLET_CONFLICT')
    await tx.walletTransaction.create({ data: { walletId: wallet.id, createdById: actorId, type: 'REFUND_CREDIT', amount: approved, balanceBefore: wallet.balance, balanceAfter: after, referenceType: 'RefundRequest', referenceId: String(id), idempotencyKey: `REFUND_CREDIT:${id}`, description: request.reason } })
    const previousOrderRefunds = request.orderItem.order.items.flatMap((item) => item.paymentAdjustments).reduce((sum, item) => sum.plus(item.amount), money(0))
    const orderFullyRefunded = isFullyRefunded(request.orderItem.order.finalAmount, [previousOrderRefunds], approved)
    await tx.serviceOrder.update({ where: { id: request.orderItem.orderId }, data: { status: orderFullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } })
    const completed = await tx.refundRequest.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() }, include: { orderItem: true, adjustments: true } })
    await audit(tx, { actorId, action: 'COMPLETE_REFUND_TO_WALLET', entityType: 'RefundRequest', entityId: id, newData: { amount: approved.toString(), walletBalance: after.toString() }, ipAddress })
    // note(FR-54): cùng transaction với cộng ví → không có thông báo nếu cộng ví thất bại
    await notify(tx, { userIds: [request.memberId], type: NOTIFICATION_TYPES.REFUND, title: 'Đã hoàn tiền vào ví', content: `Yêu cầu hoàn tiền #${id} đã hoàn tất, ${vnd(approved)} đã được cộng vào ví Sportigo.` })
    return completed
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || attempt === 2) throw error }
  }
  throw new HttpError(409, 'Dữ liệu hoàn tiền vừa thay đổi, vui lòng thử lại', 'REFUND_CONFLICT')
}

export type RevenueReportQuery = { from?: Date; to?: Date; channel?: Prisma.EnumPaymentChannelFilter['equals']; itemType?: OrderItemType }

const serviceItemTypes: OrderItemType[] = ['GROUP_CLASS', 'PRIVATE_COURSE', 'MEMBERSHIP']

function currentMonthRange(now = new Date()) {
  // Việt Nam không áp dụng DST; 00:00 GMT+7 tương ứng 17:00 UTC ngày hôm trước.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  return {
    from: new Date(Date.UTC(year, month - 1, 1, -7)),
    to: new Date(Date.UTC(year, month, 1, -7) - 1),
  }
}

export function normalizeRevenuePeriod(query: RevenueReportQuery = {}) {
  const defaults = currentMonthRange()
  return { ...query, from: query.from ?? defaults.from, to: query.to ?? defaults.to }
}

const successfulPaymentStatuses = ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const

const sportSelect = { select: { id: true, name: true } } as const
const orderItemSportInclude = {
  classRegistration: { select: { groupClass: { select: { sport: sportSelect } } } },
  privateEnrollment: { select: { privateCourse: { select: { sport: sportSelect } } } },
} satisfies Prisma.OrderItemInclude

type OrderItemSportSource = Prisma.OrderItemGetPayload<{ include: typeof orderItemSportInclude }>
type RevenueSportGroup = { sportId: number | null; name: string; orders: Set<number>; transactions: number; gross: number; discount: number; refunds: number; net: number }

function revenueSportOf(item: OrderItemSportSource) {
  const sport = item.classRegistration?.groupClass.sport ?? item.privateEnrollment?.privateCourse.sport
  if (sport) return { key: `sport:${sport.id}`, sportId: sport.id, name: sport.name }
  if (item.itemType === 'MEMBERSHIP') return { key: 'membership', sportId: null, name: 'Gói membership' }
  return { key: 'other', sportId: null, name: 'Khác' }
}

export async function financialReportData(input: RevenueReportQuery = {}) {
  const query = normalizeRevenuePeriod(input)
  const serviceFilter: Prisma.OrderItemWhereInput = query.itemType
    ? { itemType: query.itemType }
    : { itemType: { in: serviceItemTypes } }
  const paymentWhere: Prisma.PaymentWhereInput = {
    status: { in: [...successfulPaymentStatuses] },
    channel: query.channel,
    paidAt: { gte: query.from, lte: query.to },
    order: { items: { some: serviceFilter } },
  }
  const [payments, walletTopUps, refundAdjustments, refundRequests] = await Promise.all([
    prisma.payment.findMany({
      where: paymentWhere,
      include: {
        adjustments: { where: { type: 'REFUND', createdAt: { gte: query.from, lte: query.to } } },
        paymentMethod: true,
        collectedBy: { select: { displayName: true } },
        order: {
          include: {
            items: { include: orderItemSportInclude },
            invoice: true,
            member: { include: { user: { select: { displayName: true, email: true } } } },
          },
        },
      },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.payment.findMany({
      where: {
        status: { in: [...successfulPaymentStatuses] },
        channel: query.channel,
        paidAt: { gte: query.from, lte: query.to },
        order: { items: { some: { itemType: 'WALLET_TOP_UP' } } },
      },
      include: { paymentMethod: true },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.paymentAdjustment.findMany({
      where: {
        type: 'REFUND',
        createdAt: { gte: query.from, lte: query.to },
        payment: { channel: query.channel, order: { items: { some: serviceFilter } } },
      },
      include: { orderItem: { include: orderItemSportInclude }, payment: { include: { order: { include: { items: { include: orderItemSportInclude } } } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.refundRequest.findMany({
      where: { requestedAt: { gte: query.from, lte: query.to }, orderItem: { ...serviceFilter, order: { payments: { some: query.channel ? { channel: query.channel } : {} } } } },
      include: {
        member: { include: { user: { select: { displayName: true, email: true } } } },
        payment: { include: { order: true } },
        orderItem: { include: { order: true } },
        adjustments: { include: { payment: true } },
        reviewedBy: { select: { displayName: true } },
      },
      orderBy: { requestedAt: 'asc' },
    }),
  ])

  const orderDiscounts = new Map<number, number>()
  const byChannel: Record<string, number> = {}
  const byService: Record<string, { orders: Set<number>; transactions: number; gross: number; discount: number; refunds: number; net: number }> = {}
  const bySport = new Map<string, RevenueSportGroup>()
  const sportGroupFor = (item: OrderItemSportSource) => {
    const source = revenueSportOf(item)
    const group = bySport.get(source.key) ?? { sportId: source.sportId, name: source.name, orders: new Set<number>(), transactions: 0, gross: 0, discount: 0, refunds: 0, net: 0 }
    bySport.set(source.key, group)
    return group
  }
  let gross = 0
  let refunds = 0

  for (const payment of payments) {
    const paymentAmount = asNumber(payment.amount)
    gross += paymentAmount
    byChannel[payment.channel] = (byChannel[payment.channel] ?? 0) + paymentAmount
    if (!orderDiscounts.has(payment.orderId)) orderDiscounts.set(payment.orderId, asNumber(payment.order.discountAmount))

    const serviceItems = payment.order.items.filter((item) => serviceItemTypes.includes(item.itemType))
    const totalItems = serviceItems.reduce((sum, item) => sum + asNumber(item.finalAmount), 0) || paymentAmount
    for (const item of serviceItems) {
      const share = asNumber(item.finalAmount) / totalItems
      const group = byService[item.itemType] ?? { orders: new Set<number>(), transactions: 0, gross: 0, discount: 0, refunds: 0, net: 0 }
      const firstPaymentForOrder = !group.orders.has(payment.orderId)
      group.orders.add(payment.orderId)
      group.transactions += 1
      group.gross += paymentAmount * share
      if (firstPaymentForOrder) group.discount += asNumber(item.discountAmount)
      byService[item.itemType] = group

      const sportGroup = sportGroupFor(item)
      const firstPaymentForSport = !sportGroup.orders.has(payment.orderId)
      sportGroup.orders.add(payment.orderId)
      sportGroup.transactions += 1
      sportGroup.gross += paymentAmount * share
      if (firstPaymentForSport) sportGroup.discount += asNumber(item.discountAmount)
    }
  }

  for (const adjustment of refundAdjustments) {
    const refundAmount = asNumber(adjustment.amount)
    refunds += refundAmount
    byChannel[adjustment.payment.channel] = (byChannel[adjustment.payment.channel] ?? 0) - refundAmount
    const serviceItems = adjustment.orderItem
      ? [adjustment.orderItem]
      : adjustment.payment.order.items.filter((item) => serviceItemTypes.includes(item.itemType))
    const totalItems = serviceItems.reduce((sum, item) => sum + asNumber(item.finalAmount), 0) || asNumber(adjustment.payment.amount)
    for (const item of serviceItems) {
      const group = byService[item.itemType] ?? { orders: new Set<number>(), transactions: 0, gross: 0, discount: 0, refunds: 0, net: 0 }
      const refundShare = adjustment.orderItem ? refundAmount : refundAmount * (asNumber(item.finalAmount) / totalItems)
      group.refunds += refundShare
      byService[item.itemType] = group
      sportGroupFor(item).refunds += refundShare
    }
  }
  for (const group of Object.values(byService)) group.net = group.gross - group.refunds
  for (const group of bySport.values()) group.net = group.gross - group.refunds

  const walletTopUpAmount = walletTopUps.reduce((sum, payment) => sum + asNumber(payment.amount), 0)
  return {
    period: { from: query.from, to: query.to },
    filters: { channel: query.channel ?? null, itemType: query.itemType ?? null },
    gross,
    discount: [...orderDiscounts.values()].reduce((sum, value) => sum + value, 0),
    refunds,
    net: gross - refunds,
    transactions: payments.length,
    walletTopUps: walletTopUpAmount,
    byChannel,
    byService: Object.fromEntries(Object.entries(byService).map(([key, value]) => [key, { ...value, orders: value.orders.size }])),
    bySport: [...bySport.values()].map((value) => ({ ...value, orders: value.orders.size })).sort((left, right) => right.net - left.net),
    payments,
    refundRequests,
    refundAdjustments,
    walletTopUpPayments: walletTopUps,
  }
}

export async function revenueReport(query: RevenueReportQuery = {}) {
  const report = await financialReportData(query)
  return {
    period: report.period,
    filters: report.filters,
    gross: report.gross,
    discount: report.discount,
    refunds: report.refunds,
    net: report.net,
    transactions: report.transactions,
    walletTopUps: report.walletTopUps,
    byChannel: report.byChannel,
    byService: report.byService,
    bySport: report.bySport,
  }
}

export async function classReport(query: { from?: Date; to?: Date; sportId?: number; coachId?: number; classId?: number } = {}) {
  const classes = await prisma.groupClass.findMany({ where: { id: query.classId, sportId: query.sportId, coachId: query.coachId, startDate: { gte: query.from, lte: query.to } }, include: { registrations: true, waitlists: true, sessions: { include: { attendances: true } } }, orderBy: { startDate: 'desc' } })
  return classes.map((item) => { const confirmed = item.registrations.filter((r) => r.status === 'CONFIRMED').length; const attendance = item.sessions.flatMap((s) => s.attendances); return { id: item.id, name: item.name, capacity: item.capacity, confirmed, waitlist: item.waitlists.filter((w) => w.status === 'WAITING').length, occupancyRate: item.capacity ? confirmed / item.capacity : 0, attendanceRate: attendance.length ? attendance.filter((a) => ['PRESENT', 'LATE'].includes(a.status)).length / attendance.length : 0 } })
}

type AuditFilters = { actorId?: number; action?: string; entityType?: string; from?: Date; to?: Date }
const AUDIT_EXPORT_MAX_ROWS = 5000

function auditLogWhere(query: AuditFilters): Prisma.AuditLogWhereInput {
  return { actorId: query.actorId, action: query.action ? { contains: query.action, mode: 'insensitive' } : undefined, entityType: query.entityType ? { equals: query.entityType, mode: 'insensitive' } : undefined, createdAt: { gte: query.from, lte: query.to } }
}

export async function auditLogsForExport(query: AuditFilters) {
  const where = auditLogWhere(query)
  const total = await prisma.auditLog.count({ where })
  if (total > AUDIT_EXPORT_MAX_ROWS) throw new HttpError(422, `Có ${total} bản ghi, vượt giới hạn ${AUDIT_EXPORT_MAX_ROWS} dòng. Hãy thu hẹp bộ lọc.`, 'EXPORT_TOO_LARGE')
  return prisma.auditLog.findMany({ where, include: { actor: { select: { displayName: true, email: true } } }, orderBy: { createdAt: 'desc' } })
}

export async function listAuditLogs(query: AuditFilters & { page: number; limit: number }) {
  const { page, limit } = query
  const where = auditLogWhere(query)
  const [items, total, actionRows, entityRows] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
  ])
  return { items, page, limit, total, facets: { actions: actionRows.map((row) => row.action), entityTypes: entityRows.map((row) => row.entityType) } }
}

export async function getInvoice(id: number, user: { id: number; role: string }) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { order: { include: { member: { include: { user: true } }, items: true, payments: { include: { paymentMethod: true } } } } } })
  if (!invoice || user.role === 'MEMBER' && invoice.order.memberId !== user.id) throw new HttpError(404, 'Không tìm thấy hóa đơn', 'INVOICE_NOT_FOUND')
  return invoice
}
