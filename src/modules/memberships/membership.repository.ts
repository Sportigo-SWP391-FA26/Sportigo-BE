import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export const planSelect = {
  id: true,
  name: true,
  durationMonths: true,
  price: true,
  description: true,
  status: true,
} satisfies Prisma.MembershipPlanSelect

export const findPublicPlans = () =>
  prisma.membershipPlan.findMany({
    where: { status: 'ACTIVE' },
    select: planSelect,
    orderBy: [{ durationMonths: 'asc' }, { price: 'asc' }],
  })

export const findAllPlans = () =>
  prisma.membershipPlan.findMany({
    include: { _count: { select: { subscriptions: true } } },
    orderBy: [{ durationMonths: 'asc' }, { createdAt: 'desc' }],
  })

export const findPlan = (id: number) =>
  prisma.membershipPlan.findUnique({
    where: { id },
    include: { _count: { select: { subscriptions: true } } },
  })

export const createPlan = (data: Prisma.MembershipPlanCreateInput) => prisma.membershipPlan.create({ data })
export const updatePlan = (id: number, data: Prisma.MembershipPlanUpdateInput) => prisma.membershipPlan.update({ where: { id }, data })
export const deletePlan = (id: number) => prisma.membershipPlan.delete({ where: { id } })

export const findMemberSubscriptions = (memberId: number) =>
  prisma.memberSubscription.findMany({
    where: { memberId, status: { not: 'CANCELLED' } },
    include: {
      plan: { select: planSelect },
      orderItem: { select: { order: { select: { id: true, orderNumber: true, status: true, expiresAt: true } } } },
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })

export const findMemberForCheckIn = (memberCode: string) =>
  prisma.member.findUnique({
    where: { memberCode },
    select: {
      userId: true,
      memberCode: true,
      user: { select: { displayName: true, avatarUrl: true, status: true, deletedAt: true } },
    },
  })

export const checkInInclude = {
  member: { select: { userId: true, memberCode: true, user: { select: { displayName: true, avatarUrl: true } } } },
  subscription: { select: { endDate: true, plan: { select: { name: true } } } },
  checkedInBy: { select: { displayName: true } },
} satisfies Prisma.GymCheckInInclude

export function findCheckIns(where: Prisma.GymCheckInWhereInput, skip: number, take: number) {
  return Promise.all([
    prisma.gymCheckIn.findMany({ where, include: checkInInclude, orderBy: { checkedInAt: 'desc' }, skip, take }),
    prisma.gymCheckIn.count({ where }),
  ])
}
