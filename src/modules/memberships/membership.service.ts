import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import { withTransactionRetry } from '../../lib/transaction-retry.js'
import { lockMember } from './membership-activation.js'
import { centerToday, toDateText } from './membership.dates.js'
import * as repository from './membership.repository.js'
import type { CheckInInput, CreatePlanInput, UpdatePlanInput } from './membership.schema.js'

const ORDER_HOLD_MS = 15 * 60 * 1000
const DUPLICATE_SCAN_MS = 5 * 60 * 1000
const DAY_MS = 86_400_000

const planNotFound = () => new HttpError(404, 'Không tìm thấy gói membership.', 'MEMBERSHIP_PLAN_NOT_FOUND')

export const listPublicPlans = () => repository.findPublicPlans()
export const listManagedPlans = () => repository.findAllPlans()

export async function createPlan(input: CreatePlanInput, actorId: number) {
  const plan = await repository.createPlan(input)
  await audit(prisma, { actorId, action: 'MEMBERSHIP_PLAN_CREATED', entityType: 'MembershipPlan', entityId: plan.id, newData: plan })
  return plan
}

export async function updatePlan(id: number, input: UpdatePlanInput, actorId: number) {
  const current = await repository.findPlan(id)
  if (!current) throw planNotFound()
  const updated = await repository.updatePlan(id, input)
  await audit(prisma, { actorId, action: 'MEMBERSHIP_PLAN_UPDATED', entityType: 'MembershipPlan', entityId: id, oldData: current, newData: updated })
  return updated
}

export async function deleteDraftPlan(id: number, actorId: number) {
  const plan = await repository.findPlan(id)
  if (!plan) throw planNotFound()
  if (plan.status !== 'DRAFT' || plan._count.subscriptions > 0) {
    throw new HttpError(409, 'Chỉ xóa được gói bản nháp chưa có người mua. Hãy ngừng bán để giữ lịch sử.', 'MEMBERSHIP_PLAN_DELETE_NOT_ALLOWED')
  }
  await repository.deletePlan(id)
  await audit(prisma, { actorId, action: 'MEMBERSHIP_PLAN_DELETED', entityType: 'MembershipPlan', entityId: id, oldData: plan })
}

export async function purchase(memberId: number, planId: number, now = new Date()) {
  return withTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockMember(tx, memberId)
    const member = await tx.member.findUnique({
      where: { userId: memberId },
      select: { userId: true, user: { select: { status: true, deletedAt: true } } },
    })
    if (!member) throw new HttpError(404, 'Không tìm thấy hội viên.', 'MEMBER_NOT_FOUND')
    // Hội viên mới tạo tại quầy còn INACTIVE tới khi xác minh email vẫn được mua gói.
    if (member.user.deletedAt || member.user.status === 'LOCKED') {
      throw new HttpError(409, 'Tài khoản hội viên hiện không hoạt động.', 'ACCOUNT_INACTIVE')
    }
    const plan = await tx.membershipPlan.findUnique({ where: { id: planId } })
    if (!plan || plan.status !== 'ACTIVE') {
      throw new HttpError(409, 'Gói membership hiện không mở bán.', 'MEMBERSHIP_PLAN_UNAVAILABLE')
    }
    const pending = await tx.orderItem.findFirst({
      where: {
        memberSubscription: { memberId, status: 'PENDING_PAYMENT' },
        order: { status: 'PENDING_PAYMENT', expiresAt: { gt: now } },
      },
      select: { orderId: true },
    })
    if (pending) {
      throw new HttpError(409, 'Bạn đang có một đơn membership chờ thanh toán.', 'MEMBERSHIP_PENDING_PAYMENT', { orderId: pending.orderId })
    }

    const subscription = await tx.memberSubscription.create({ data: { memberId, planId, price: plan.price } })
    const order = await tx.serviceOrder.create({
      data: {
        memberId,
        orderNumber: `ORD-MB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        originalAmount: plan.price,
        finalAmount: plan.price,
        status: 'PENDING_PAYMENT',
        expiresAt: new Date(now.getTime() + ORDER_HOLD_MS),
        items: {
          create: {
            memberSubscriptionId: subscription.id,
            itemType: 'MEMBERSHIP',
            itemNameSnapshot: `Gói membership: ${plan.name}`,
            unitPrice: plan.price,
            finalAmount: plan.price,
          },
        },
      },
    })
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: order.finalAmount,
      expiresAt: order.expiresAt,
      subscriptionId: subscription.id,
    }
  }))
}

type SubscriptionRow = Awaited<ReturnType<typeof repository.findMemberSubscriptions>>[number]

function toSubscription(row: SubscriptionRow) {
  return {
    id: row.id,
    status: row.status,
    price: row.price,
    startDate: toDateText(row.startDate),
    endDate: toDateText(row.endDate),
    plan: row.plan,
  }
}

export async function getMyMembership(memberId: number, now = new Date()) {
  const rows = await repository.findMemberSubscriptions(memberId)
  const today = centerToday(now)
  const active = rows.filter((row) => row.status === 'ACTIVE' && row.startDate && row.endDate)
  const current = active.find((row) => row.startDate! <= today && row.endDate! >= today) ?? null
  const upcoming = active.filter((row) => row.startDate! > today)
  const pending = rows.find((row) => {
    const order = row.orderItem?.order
    return row.status === 'PENDING_PAYMENT' && order?.status === 'PENDING_PAYMENT' && order.expiresAt !== null && order.expiresAt > now
  })
  return {
    current: current ? toSubscription(current) : null,
    upcoming: upcoming.map(toSubscription),
    // Ngày cuối được dùng phòng tập khi tính cả các gói nối tiếp
    validUntil: toDateText((upcoming.at(-1) ?? current)?.endDate ?? null),
    pendingOrder: pending?.orderItem ? { ...pending.orderItem.order, plan: pending.plan } : null,
    history: active.filter((row) => row.endDate! < today).reverse().map(toSubscription),
  }
}

type CheckInRow = Awaited<ReturnType<typeof repository.findCheckIns>>[0][number]

function toCheckIn(row: CheckInRow) {
  return {
    id: row.id,
    method: row.method,
    checkedInAt: row.checkedInAt,
    checkedInBy: row.checkedInBy.displayName,
    member: {
      id: row.member.userId,
      memberCode: row.member.memberCode,
      displayName: row.member.user.displayName,
      avatarUrl: row.member.user.avatarUrl,
    },
    planName: row.subscription.plan.name,
    endDate: toDateText(row.subscription.endDate),
  }
}

export async function checkIn(staffId: number, input: CheckInInput, now = new Date()) {
  const member = await repository.findMemberForCheckIn(input.memberCode)
  if (!member) throw new HttpError(404, 'Không tìm thấy mã thành viên.', 'MEMBER_NOT_FOUND')

  // Kèm thông tin để lễ tân đối chiếu người trước mặt và bán gói ngay khi cần.
  const identity = {
    id: member.userId,
    memberCode: member.memberCode,
    displayName: member.user.displayName,
    avatarUrl: member.user.avatarUrl,
  }
  if (member.user.deletedAt || member.user.status !== 'ACTIVE') {
    throw new HttpError(409, 'Tài khoản hội viên hiện không hoạt động.', 'ACCOUNT_INACTIVE', { member: identity })
  }

  const today = centerToday(now)
  const result = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
    await lockMember(tx, member.userId)
    const subscription = await tx.memberSubscription.findFirst({
      where: { memberId: member.userId, status: 'ACTIVE', startDate: { lte: today }, endDate: { gte: today } },
      orderBy: { endDate: 'asc' },
    })
    if (!subscription) {
      throw new HttpError(409, 'Hội viên chưa có gói membership còn hiệu lực.', 'NO_ACTIVE_MEMBERSHIP', { member: identity })
    }
    const recent = await tx.gymCheckIn.findFirst({
      where: { memberId: member.userId, checkedInAt: { gt: new Date(now.getTime() - DUPLICATE_SCAN_MS) } },
      include: repository.checkInInclude,
      orderBy: { checkedInAt: 'desc' },
    })
    if (recent) return { row: recent, alreadyCheckedIn: true }
    const row = await tx.gymCheckIn.create({
      data: { memberId: member.userId, subscriptionId: subscription.id, checkedInById: staffId, method: input.method, checkedInAt: now },
      include: repository.checkInInclude,
    })
    return { row, alreadyCheckedIn: false }
  }))

  const endDate = result.row.subscription.endDate
  return {
    ...toCheckIn(result.row),
    alreadyCheckedIn: result.alreadyCheckedIn,
    daysRemaining: endDate ? Math.round((endDate.getTime() - today.getTime()) / DAY_MS) + 1 : 0,
  }
}

export async function listCheckIns(query: { page: number; limit: number }, memberId?: number) {
  const [rows, total] = await repository.findCheckIns(
    memberId === undefined ? {} : { memberId },
    (query.page - 1) * query.limit,
    query.limit,
  )
  return { items: rows.map(toCheckIn), page: query.page, limit: query.limit, total }
}
