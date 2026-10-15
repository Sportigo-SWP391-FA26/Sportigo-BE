import { randomUUID } from 'node:crypto'
import { Prisma, type OrderItemType, type PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { createPaymentUrl, type VnpayParams, verifyVnpay } from './vnpay.js'

type Db = Prisma.TransactionClient | PrismaClient
const money = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value)
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
  return Prisma.Decimal.max(money(0), order.finalAmount.minus(paidAmount(order)))
}

export async function createServiceOrder(input: { memberId: number; itemType: OrderItemType; itemName: string; unitPrice: number; classRegistrationId?: number; privateEnrollmentId?: number; expiresAt?: Date }) {
  const refs = Number(Boolean(input.classRegistrationId)) + Number(Boolean(input.privateEnrollmentId))
  if (refs !== 1) throw new HttpError(400, 'Order Item phải tham chiếu đúng một dịch vụ', 'INVALID_ORDER_ITEM')
  return prisma.$transaction(async (tx) => tx.serviceOrder.create({
    data: {
      memberId: input.memberId, orderNumber: `SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      originalAmount: money(input.unitPrice), discountAmount: 0, finalAmount: money(input.unitPrice), status: 'PENDING_PAYMENT', expiresAt: input.expiresAt,
      items: { create: { itemType: input.itemType, itemNameSnapshot: input.itemName, unitPrice: money(input.unitPrice), finalAmount: money(input.unitPrice), classRegistrationId: input.classRegistrationId, privateEnrollmentId: input.privateEnrollmentId } },
    }, include: orderInclude,
  }))
}

export const getOrder = requireOrder

export async function applyPromotion(orderId: number, code: string, user: { id: number; role: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await requireOrder(orderId, user, tx)
    if (!['CART', 'PENDING_PAYMENT'].includes(order.status)) throw new HttpError(409, 'Đơn hàng không thể áp dụng khuyến mãi', 'ORDER_NOT_PAYABLE')
    const promotion = await tx.promotion.findUnique({ where: { code: code.toUpperCase() } })
    const now = new Date()
    if (!promotion || promotion.status !== 'ACTIVE' || promotion.startAt > now || promotion.endAt < now) throw new HttpError(400, 'Mã khuyến mãi không hợp lệ hoặc đã hết hạn', 'INVALID_PROMOTION')
    if (order.originalAmount.lessThan(promotion.minOrderAmount)) throw new HttpError(400, 'Đơn hàng chưa đạt giá trị tối thiểu', 'PROMOTION_MINIMUM_NOT_MET')
    const itemTypes = new Set(order.items.map((item) => item.itemType))
    if (promotion.applicableType !== 'ALL' && !itemTypes.has(promotion.applicableType)) throw new HttpError(400, 'Mã không áp dụng cho dịch vụ này', 'PROMOTION_SCOPE_MISMATCH')
    const [total, memberTotal] = await Promise.all([
      tx.promotionUsage.count({ where: { promotionId: promotion.id } }),
      tx.promotionUsage.count({ where: { promotionId: promotion.id, memberId: order.memberId } }),
    ])
    if (promotion.totalUsageLimit && total >= promotion.totalUsageLimit || promotion.perMemberLimit && memberTotal >= promotion.perMemberLimit) throw new HttpError(409, 'Mã khuyến mãi đã hết lượt sử dụng', 'PROMOTION_USAGE_LIMIT')
    let discount = promotion.discountType === 'PERCENTAGE' ? order.originalAmount.mul(promotion.discountValue).div(100) : promotion.discountValue
    if (promotion.maxDiscount) discount = Prisma.Decimal.min(discount, promotion.maxDiscount)
    discount = Prisma.Decimal.min(discount, order.originalAmount)
    const updated = await tx.serviceOrder.update({ where: { id: order.id }, data: { promotionId: promotion.id, discountAmount: discount, finalAmount: order.originalAmount.minus(discount) }, include: orderInclude })
    await audit(tx, { actorId: user.id, action: 'APPLY_PROMOTION', entityType: 'ServiceOrder', entityId: order.id, oldData: { promotionId: order.promotionId }, newData: { promotionId: promotion.id, discount: discount.toString() } })
    return updated
  })
}

export async function listPromotions() { return prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } }) }
export async function createPromotion(data: Prisma.PromotionCreateInput, actorId: number) {
  const created = await prisma.promotion.create({ data })
  await audit(prisma, { actorId, action: 'CREATE_PROMOTION', entityType: 'Promotion', entityId: created.id, newData: created })
  return created
}
export async function updatePromotion(id: number, data: Prisma.PromotionUpdateInput, actorId: number) {
  const old = await prisma.promotion.findUnique({ where: { id } }); if (!old) throw new HttpError(404, 'Không tìm thấy khuyến mãi', 'PROMOTION_NOT_FOUND')
  const updated = await prisma.promotion.update({ where: { id }, data })
  await audit(prisma, { actorId, action: 'UPDATE_PROMOTION', entityType: 'Promotion', entityId: id, oldData: old, newData: updated })
  return updated
}

async function ensureMethod(db: Db, code: string, name: string, isOnline: boolean) {
  return db.paymentMethod.upsert({ where: { code }, create: { code, name, isOnline }, update: { name, isOnline, isActive: true } })
}

async function finalizePaidOrder(tx: Prisma.TransactionClient, orderId: number) {
  const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude })
  if (remaining(order).greaterThan(0)) return order
  if (order.status !== 'PAID') await tx.serviceOrder.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } })
  for (const item of order.items) {
    if (item.classRegistrationId) await tx.classRegistration.update({ where: { id: item.classRegistrationId }, data: { status: 'CONFIRMED' } })
    if (item.privateEnrollmentId) await tx.privateCourseEnrollment.update({ where: { id: item.privateEnrollmentId }, data: { status: 'ACTIVE' } })
  }
  if (order.promotionId) await tx.promotionUsage.upsert({ where: { orderId }, create: { orderId, promotionId: order.promotionId, memberId: order.memberId }, update: {} })
  await tx.invoice.upsert({ where: { orderId }, create: { orderId, invoiceNumber: `INV-${Date.now()}-${orderId}`, subtotal: order.originalAmount, discountAmount: order.discountAmount, totalAmount: order.finalAmount }, update: {} })
  return tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude })
}

export async function createVnpayPayment(orderId: number, user: { id: number; role: string }, ipAddress: string) {
  return prisma.$transaction(async (tx) => {
    const order = await requireOrder(orderId, user, tx); const due = remaining(order)
    if (due.lessThanOrEqualTo(0)) throw new HttpError(409, 'Đơn hàng đã được thanh toán đủ', 'ORDER_ALREADY_PAID')
    const method = await ensureMethod(tx, 'VNPAY', 'VNPay Sandbox', true); const reference = `VNP-${Date.now()}-${order.id}`
    const payment = await tx.payment.create({ data: { orderId, paymentMethodId: method.id, reference, amount: due, channel: 'ONLINE', status: 'PENDING', onlineTransaction: { create: { provider: 'VNPAY', requestPayload: { orderId, amount: due.toString() } } } } })
    return { paymentId: payment.id, amount: asNumber(due), paymentUrl: createPaymentUrl({ reference, amount: asNumber(due), ipAddress, orderInfo: `Thanh toan don hang ${order.orderNumber}` }) }
  })
}

export async function processVnpayIpn(params: VnpayParams) {
  if (!verifyVnpay(params)) return { RspCode: '97', Message: 'Invalid signature' }
  const reference = params.vnp_TxnRef; const payment = await prisma.payment.findUnique({ where: { reference }, include: { onlineTransaction: true } })
  if (!payment) return { RspCode: '01', Message: 'Order not found' }
  if (!money(params.vnp_Amount ?? 0).div(100).equals(payment.amount)) return { RspCode: '04', Message: 'Invalid amount' }
  if (payment.status === 'SUCCESS') return { RspCode: '02', Message: 'Order already confirmed' }
  await prisma.$transaction(async (tx) => {
    const success = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00'
    await tx.payment.update({ where: { id: payment.id }, data: { status: success ? 'SUCCESS' : 'FAILED', paidAt: success ? new Date() : undefined } })
    await tx.onlineTransaction.update({ where: { paymentId: payment.id }, data: { providerTransactionId: params.vnp_TransactionNo, responsePayload: params, status: success ? 'SUCCESS' : 'FAILED', processedAt: new Date() } })
    if (success) await finalizePaidOrder(tx, payment.orderId)
  })
  return { RspCode: '00', Message: 'Confirm Success' }
}

export async function payCash(orderId: number, actorId: number, receivedAmount: number, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await requireOrder(orderId, { id: actorId, role: 'RECEPTIONIST' }, tx); const due = remaining(order)
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
    const order = await requireOrder(orderId, { id: memberId, role: 'MEMBER' }, tx); const due = remaining(order); const requested = money(amount)
    if (requested.greaterThan(due)) throw new HttpError(400, 'Số tiền ví vượt quá số tiền còn phải trả', 'WALLET_AMOUNT_EXCEEDS_DUE')
    const wallet = await tx.wallet.upsert({ where: { memberId }, create: { memberId }, update: {} })
    if (wallet.balance.lessThan(requested)) throw new HttpError(409, 'Số dư ví không đủ', 'INSUFFICIENT_WALLET_BALANCE')
    const after = wallet.balance.minus(requested); const key = `ORDER_DEBIT:${orderId}:${randomUUID()}`
    const debit = await tx.wallet.updateMany({ where: { id: wallet.id, version: wallet.version, balance: { gte: requested } }, data: { balance: after, version: { increment: 1 } } })
    if (debit.count !== 1) throw new HttpError(409, 'Số dư ví vừa thay đổi, vui lòng thử lại', 'WALLET_CONFLICT')
    await tx.walletTransaction.create({ data: { walletId: wallet.id, createdById: memberId, type: 'ORDER_DEBIT', amount: requested, balanceBefore: wallet.balance, balanceAfter: after, referenceType: 'ServiceOrder', referenceId: String(orderId), idempotencyKey: key, description: `Thanh toán ${order.orderNumber}` } })
    const method = await ensureMethod(tx, 'WALLET', 'Ví Sportigo', false)
    const payment = await tx.payment.create({ data: { orderId, paymentMethodId: method.id, reference: `WAL-${Date.now()}-${orderId}`, amount: requested, channel: 'WALLET', status: 'SUCCESS', paidAt: new Date() } })
    const updated = await finalizePaidOrder(tx, orderId)
    return { payment, walletBalance: asNumber(after), remainingAmount: asNumber(remaining(updated)) }
  })
}

export async function getWallet(memberId: number, page: number, limit: number) {
  const wallet = await prisma.wallet.upsert({ where: { memberId }, create: { memberId }, update: {} })
  const [transactions, total] = await Promise.all([prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.walletTransaction.count({ where: { walletId: wallet.id } })])
  return { balance: asNumber(wallet.balance), transactions, page, limit, total }
}

export async function listPayments(user: { id: number; role: string }, query: { page: number; limit: number; from?: Date; to?: Date; status?: Prisma.EnumPaymentStatusFilter['equals']; channel?: Prisma.EnumPaymentChannelFilter['equals']; memberId?: number }) {
  const { page, limit } = query
  const where: Prisma.PaymentWhereInput = { status: query.status, channel: query.channel, createdAt: { gte: query.from, lte: query.to }, order: { memberId: user.role === 'MEMBER' ? user.id : query.memberId } }
  const [items, total] = await Promise.all([prisma.payment.findMany({ where, include: { order: { include: { invoice: true } }, paymentMethod: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.payment.count({ where })])
  return { items, page, limit, total }
}

function refundable(payment: { amount: Prisma.Decimal; adjustments: { amount: Prisma.Decimal; type: string }[] }) {
  return payment.amount.minus(payment.adjustments.filter((item) => item.type === 'REFUND').reduce((sum, item) => sum.plus(item.amount), money(0)))
}

export async function requestRefund(paymentId: number, memberId: number, requestedAmount: number, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { items: { include: { classRegistration: true, privateEnrollment: true } } } }, adjustments: true, refundRequests: true } })
  if (!payment || payment.order.memberId !== memberId) throw new HttpError(404, 'Không tìm thấy giao dịch', 'PAYMENT_NOT_FOUND')
  if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw new HttpError(409, 'Giao dịch không đủ điều kiện hoàn', 'PAYMENT_NOT_REFUNDABLE')
  const cancelled = payment.order.items.every((item) => item.classRegistration?.status === 'CANCELLED' || item.privateEnrollment?.status === 'CANCELLED')
  if (!cancelled) throw new HttpError(409, 'Dịch vụ phải được hủy hợp lệ trước khi yêu cầu hoàn tiền', 'SERVICE_NOT_CANCELLED')
  if (payment.refundRequests.some((item) => ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'].includes(item.status))) throw new HttpError(409, 'Đã có yêu cầu hoàn tiền đang xử lý', 'REFUND_ALREADY_PENDING')
  if (money(requestedAmount).greaterThan(refundable(payment))) throw new HttpError(400, 'Số tiền yêu cầu vượt quá số tiền có thể hoàn', 'REFUND_AMOUNT_EXCEEDED')
  return prisma.refundRequest.create({ data: { paymentId, memberId, requestedAmount: money(requestedAmount), reason } })
}

export async function listRefunds() { return prisma.refundRequest.findMany({ include: { payment: { include: { order: true } }, member: { include: { user: true } } }, orderBy: { requestedAt: 'desc' } }) }
export async function reviewRefund(id: number, decision: 'REVIEW' | 'APPROVE' | 'REJECT', note: string, actorId: number, approvedAmount?: number) {
  const current = await prisma.refundRequest.findUnique({ where: { id } }); if (!current) throw new HttpError(404, 'Không tìm thấy yêu cầu hoàn tiền', 'REFUND_NOT_FOUND')
  const allowed = decision === 'REVIEW' ? current.status === 'REQUESTED' : ['REQUESTED', 'UNDER_REVIEW'].includes(current.status)
  if (!allowed) throw new HttpError(409, 'Trạng thái hoàn tiền không cho phép thao tác này', 'INVALID_REFUND_TRANSITION')
  const status = decision === 'REVIEW' ? 'UNDER_REVIEW' : decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  if (decision === 'APPROVE' && (!approvedAmount || money(approvedAmount).greaterThan(current.requestedAmount))) throw new HttpError(400, 'Số tiền duyệt phải lớn hơn 0 và không vượt số tiền yêu cầu', 'INVALID_APPROVED_AMOUNT')
  const updated = await prisma.refundRequest.update({ where: { id }, data: { status, approvedAmount: decision === 'APPROVE' ? money(approvedAmount!) : undefined, reviewedById: actorId, reviewedAt: new Date(), reviewNote: note } })
  await audit(prisma, { actorId, action: `${decision}_REFUND`, entityType: 'RefundRequest', entityId: id, oldData: current, newData: updated })
  return updated
}

export async function completeRefund(id: number, actorId: number, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.refundRequest.findUnique({ where: { id }, include: { payment: { include: { adjustments: true, order: true } } } })
    if (!request) throw new HttpError(404, 'Không tìm thấy yêu cầu hoàn tiền', 'REFUND_NOT_FOUND')
    if (request.status === 'COMPLETED') return request
    if (request.status !== 'APPROVED') throw new HttpError(409, 'Yêu cầu chưa được duyệt', 'REFUND_NOT_APPROVED')
    const approved = request.approvedAmount ?? request.requestedAmount
    if (approved.greaterThan(refundable(request.payment))) throw new HttpError(409, 'Số tiền hoàn vượt quá số dư có thể hoàn', 'REFUND_AMOUNT_EXCEEDED')
    const adjustment = await tx.paymentAdjustment.create({ data: { paymentId: request.paymentId, createdById: actorId, type: 'REFUND', amount: approved, reason: request.reason } })
    const wallet = await tx.wallet.upsert({ where: { memberId: request.memberId }, create: { memberId: request.memberId }, update: {} }); const after = wallet.balance.plus(approved)
    const credit = await tx.wallet.updateMany({ where: { id: wallet.id, version: wallet.version }, data: { balance: after, version: { increment: 1 } } })
    if (credit.count !== 1) throw new HttpError(409, 'Số dư ví vừa thay đổi, vui lòng thử lại', 'WALLET_CONFLICT')
    await tx.walletTransaction.create({ data: { walletId: wallet.id, createdById: actorId, type: 'REFUND_CREDIT', amount: approved, balanceBefore: wallet.balance, balanceAfter: after, referenceType: 'RefundRequest', referenceId: String(id), idempotencyKey: `REFUND_CREDIT:${id}`, description: request.reason } })
    const totalRefunded = request.payment.adjustments.filter((item) => item.type === 'REFUND').reduce((sum, item) => sum.plus(item.amount), approved)
    const full = totalRefunded.greaterThanOrEqualTo(request.payment.amount)
    await tx.payment.update({ where: { id: request.paymentId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } })
    await tx.serviceOrder.update({ where: { id: request.payment.orderId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } })
    const completed = await tx.refundRequest.update({ where: { id }, data: { status: 'COMPLETED', adjustmentId: adjustment.id, completedAt: new Date() } })
    await audit(tx, { actorId, action: 'COMPLETE_REFUND_TO_WALLET', entityType: 'RefundRequest', entityId: id, newData: { amount: approved.toString(), walletBalance: after.toString() }, ipAddress })
    return completed
  })
}

export async function revenueReport(from?: Date, to?: Date) {
  const payments = await prisma.payment.findMany({ where: { status: { in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paidAt: { gte: from, lte: to } }, include: { adjustments: true, paymentMethod: true, order: { include: { items: true } } } })
  return payments.reduce((report, payment) => {
    const refunds = payment.adjustments.filter((item) => item.type === 'REFUND').reduce((sum, item) => sum.plus(item.amount), money(0)); const net = payment.amount.minus(refunds)
    report.gross += asNumber(payment.amount); report.refunds += asNumber(refunds); report.net += asNumber(net); report.transactions += 1
    report.byChannel[payment.channel] = (report.byChannel[payment.channel] ?? 0) + asNumber(net)
    return report
  }, { gross: 0, refunds: 0, net: 0, transactions: 0, byChannel: {} as Record<string, number> })
}

export async function classReport() {
  const classes = await prisma.groupClass.findMany({ include: { registrations: true, waitlists: true, sessions: { include: { attendances: true } } }, orderBy: { startDate: 'desc' } })
  return classes.map((item) => { const confirmed = item.registrations.filter((r) => r.status === 'CONFIRMED').length; const attendance = item.sessions.flatMap((s) => s.attendances); return { id: item.id, name: item.name, capacity: item.capacity, confirmed, waitlist: item.waitlists.filter((w) => w.status === 'WAITING').length, occupancyRate: item.capacity ? confirmed / item.capacity : 0, attendanceRate: attendance.length ? attendance.filter((a) => ['PRESENT', 'LATE'].includes(a.status)).length / attendance.length : 0 } })
}

export async function listAuditLogs(page: number, limit: number) {
  const [items, total] = await Promise.all([prisma.auditLog.findMany({ include: { actor: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.auditLog.count()])
  return { items, page, limit, total }
}

export async function getInvoice(id: number, user: { id: number; role: string }) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { order: { include: { member: { include: { user: true } }, items: true, payments: { include: { paymentMethod: true } } } } } })
  if (!invoice || user.role === 'MEMBER' && invoice.order.memberId !== user.id) throw new HttpError(404, 'Không tìm thấy hóa đơn', 'INVOICE_NOT_FOUND')
  return invoice
}
