import type { PlanStatus, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { coachRefSelect } from './training.common.js'

const planSelect = {
  id: true,
  name: true,
  level: true,
  description: true,
  durationWeeks: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  sport: { select: { id: true, name: true } },
  createdBy: { select: coachRefSelect },
  _count: { select: { items: true, assignments: true } },
} as const

export const planItemSelect = {
  id: true,
  weekNumber: true,
  sessionNumber: true,
  itemOrder: true,
  title: true,
  content: true,
  durationMinutes: true,
  sets: true,
  repetitions: true,
  intensity: true,
  note: true,
} as const

// Thứ tự hiển thị mục giáo án: tuần → buổi → thứ tự
export const planItemOrderBy: Prisma.WorkoutPlanItemOrderByWithRelationInput[] =
  [{ weekNumber: 'asc' }, { sessionNumber: 'asc' }, { itemOrder: 'asc' }]

export function findSport(sportId: number) {
  return prisma.sport.findUnique({
    where: { id: sportId },
    select: { id: true, isActive: true },
  })
}

export function findCoach(userId: number) {
  return prisma.coach.findUnique({
    where: { userId },
    select: { userId: true },
  })
}

export function findPlans(
  filter: {
    sportId?: number
    level?: string
    status?: PlanStatus
    search?: string
  },
  page: { skip: number; take: number },
) {
  const where: Prisma.WorkoutPlanWhereInput = {
    sportId: filter.sportId,
    level: filter.level,
    status: filter.status,
    name: filter.search
      ? { contains: filter.search, mode: 'insensitive' }
      : undefined,
  }
  return prisma.$transaction([
    prisma.workoutPlan.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...page,
      select: planSelect,
    }),
    prisma.workoutPlan.count({ where }),
  ])
}

export function findPlanDetail(planId: number) {
  return prisma.workoutPlan.findUnique({
    where: { id: planId },
    select: {
      ...planSelect,
      items: { orderBy: planItemOrderBy, select: planItemSelect },
    },
  })
}

export function findPlanState(planId: number) {
  return prisma.workoutPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      sportId: true,
      status: true,
      durationWeeks: true,
      _count: { select: { items: true, assignments: true } },
    },
  })
}

export async function findMaxItemWeek(planId: number) {
  const result = await prisma.workoutPlanItem.aggregate({
    where: { workoutPlanId: planId },
    _max: { weekNumber: true },
  })
  return result._max.weekNumber
}

type PlanData = {
  sportId: number
  name: string
  level: string
  description?: string | null
  durationWeeks: number
}

export function createPlan(data: PlanData & { createdById: number }) {
  return prisma.workoutPlan.create({ data, select: planSelect })
}

export function updatePlan(
  planId: number,
  data: Partial<PlanData> & { status?: PlanStatus },
) {
  return prisma.workoutPlan.update({
    where: { id: planId },
    data,
    select: planSelect,
  })
}
