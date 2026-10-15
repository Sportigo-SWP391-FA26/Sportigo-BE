import { prisma } from '../../lib/prisma.js'
import type { Db } from './training.common.js'
import { planItemOrderBy, planItemSelect } from './workout-plan.repository.js'

type Slot = { weekNumber: number; sessionNumber: number }

// Chỉ lấy đúng hai trường vị trí, tránh lọt trường thừa vào điều kiện where
function slotWhere(planId: number, { weekNumber, sessionNumber }: Slot) {
  return { workoutPlanId: planId, weekNumber, sessionNumber }
}

type ItemData = Slot & {
  itemOrder: number
  title: string
  content: string
  durationMinutes?: number | null
  sets?: number | null
  repetitions?: number | null
  intensity?: string | null
  note?: string | null
}

export function findItems(planId: number) {
  return prisma.workoutPlanItem.findMany({
    where: { workoutPlanId: planId },
    orderBy: planItemOrderBy,
    select: planItemSelect,
  })
}

export function findItem(planId: number, itemId: number) {
  return prisma.workoutPlanItem.findFirst({
    where: { id: itemId, workoutPlanId: planId },
    select: planItemSelect,
  })
}

export function findItemsByIds(planId: number, itemIds: number[]) {
  return prisma.workoutPlanItem.findMany({
    where: { workoutPlanId: planId, id: { in: itemIds } },
    select: { id: true, weekNumber: true, sessionNumber: true },
  })
}

export async function findMaxItemOrder(planId: number, slot: Slot) {
  const result = await prisma.workoutPlanItem.aggregate({
    where: slotWhere(planId, slot),
    _max: { itemOrder: true },
  })
  return result._max.itemOrder
}

export function createItem(planId: number, data: ItemData) {
  return prisma.workoutPlanItem.create({
    data: { ...data, workoutPlanId: planId },
    select: planItemSelect,
  })
}

export function updateItem(itemId: number, data: Partial<ItemData>) {
  return prisma.workoutPlanItem.update({
    where: { id: itemId },
    data,
    select: planItemSelect,
  })
}

export function deleteItem(db: Db, itemId: number) {
  return db.workoutPlanItem.delete({ where: { id: itemId } })
}

export function findSlotItems(db: Db, planId: number, slot: Slot) {
  return db.workoutPlanItem.findMany({
    where: slotWhere(planId, slot),
    orderBy: { itemOrder: 'asc' },
    select: { id: true },
  })
}

export function shiftSlotOrders(
  db: Db,
  planId: number,
  slot: Slot,
  offset: number,
) {
  return db.workoutPlanItem.updateMany({
    where: slotWhere(planId, slot),
    data: { itemOrder: { increment: offset } },
  })
}

export function setItemOrder(db: Db, itemId: number, itemOrder: number) {
  return db.workoutPlanItem.update({
    where: { id: itemId },
    data: { itemOrder },
  })
}
