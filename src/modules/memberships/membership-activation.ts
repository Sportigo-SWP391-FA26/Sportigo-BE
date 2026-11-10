import type { Prisma } from '@prisma/client'
import { centerToday, nextSubscriptionStart, subscriptionEndDate } from './membership.dates.js'

/** Khóa theo hội viên để hai giao dịch song song không tính chồng ngày hoặc tạo trùng. */
export async function lockMember(tx: Prisma.TransactionClient, memberId: number) {
  await tx.$queryRaw`SELECT "userId" FROM "Member" WHERE "userId" = ${memberId} FOR UPDATE`
}

/** Kích hoạt gói sau khi đơn được thanh toán đủ. Chạy lại an toàn khi callback lặp. */
export async function activateSubscription(
  tx: Prisma.TransactionClient,
  subscriptionId: number,
  memberId: number,
  now = new Date(),
) {
  await lockMember(tx, memberId)
  const subscription = await tx.memberSubscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: { select: { durationMonths: true } } },
  })
  if (!subscription || subscription.status !== 'PENDING_PAYMENT') return

  const latest = await tx.memberSubscription.findFirst({
    where: { memberId, status: 'ACTIVE' },
    orderBy: { endDate: 'desc' },
    select: { endDate: true },
  })
  const startDate = nextSubscriptionStart(centerToday(now), latest?.endDate)
  await tx.memberSubscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'ACTIVE',
      startDate,
      endDate: subscriptionEndDate(startDate, subscription.plan.durationMonths),
    },
  })
}
