import { HttpError } from '../../lib/http-error.js'
import {
  BR_MESSAGES,
  type Db,
  isUniqueViolation,
  notFound,
  runInTransaction,
} from './training.common.js'
import * as itemRepository from './workout-plan-item.repository.js'
import type {
  CreateItemInput,
  ReorderItemsInput,
  UpdateItemInput,
} from './workout-plan-item.schema.js'
import { getPlanStateOrThrow } from './workout-plan.service.js'

type Slot = { weekNumber: number; sessionNumber: number }

// Không dùng số âm làm thứ tự tạm vì CHECK itemOrder >= 1 (BR-45),
// nên đẩy tạm lên vùng số lớn rồi mới gán lại thứ tự thật.
const TEMPORARY_ORDER_OFFSET = 100_000

async function getItemOrThrow(planId: number, itemId: number) {
  const item = await itemRepository.findItem(planId, itemId)
  if (!item) throw notFound('Không tìm thấy mục giáo án')
  return item
}

function assertWeekWithinPlan(
  weekNumber: number,
  durationWeeks: number | null,
) {
  if (durationWeeks !== null && weekNumber > durationWeeks) {
    throw new HttpError(
      422,
      `Tuần ${weekNumber} vượt quá thời lượng giáo án (${durationWeeks} tuần)`,
      'WEEK_OUT_OF_RANGE',
    )
  }
}

// BR-45: trùng (tuần, buổi, thứ tự) thì unique constraint báo P2002 → 409
async function rejectDuplicateOrder<T>(work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, BR_MESSAGES.BR45, 'DUPLICATE_ITEM_ORDER')
    }
    throw error
  }
}

async function renumberSlot(
  tx: Db,
  planId: number,
  slot: Slot,
  orderedIds: number[],
) {
  await itemRepository.shiftSlotOrders(tx, planId, slot, TEMPORARY_ORDER_OFFSET)
  for (const [index, itemId] of orderedIds.entries()) {
    await itemRepository.setItemOrder(tx, itemId, index + 1)
  }
}

export async function listItems(planId: number) {
  await getPlanStateOrThrow(planId)
  return itemRepository.findItems(planId)
}

export async function createItem(planId: number, input: CreateItemInput) {
  const plan = await getPlanStateOrThrow(planId)
  assertWeekWithinPlan(input.weekNumber, plan.durationWeeks)
  const itemOrder =
    input.itemOrder ??
    ((await itemRepository.findMaxItemOrder(planId, input)) ?? 0) + 1
  return rejectDuplicateOrder(() =>
    itemRepository.createItem(planId, { ...input, itemOrder }),
  )
}

export async function updateItem(
  planId: number,
  itemId: number,
  input: UpdateItemInput,
) {
  const plan = await getPlanStateOrThrow(planId)
  await getItemOrThrow(planId, itemId)
  if (input.weekNumber !== undefined) {
    assertWeekWithinPlan(input.weekNumber, plan.durationWeeks)
  }
  return rejectDuplicateOrder(() => itemRepository.updateItem(itemId, input))
}

export async function deleteItem(planId: number, itemId: number) {
  const plan = await getPlanStateOrThrow(planId)
  const item = await getItemOrThrow(planId, itemId)
  if (plan.status === 'ACTIVE' && plan._count.items <= 1) {
    throw new HttpError(
      409,
      'Không thể xóa mục cuối cùng của giáo án đang hoạt động',
      'PLAN_NEEDS_ITEMS',
    )
  }

  await runInTransaction(async (tx) => {
    await itemRepository.deleteItem(tx, itemId)
    // BR-45: giữ thứ tự liên tục trong tuần/buổi sau khi xóa
    const remaining = await itemRepository.findSlotItems(tx, planId, item)
    await renumberSlot(
      tx,
      planId,
      item,
      remaining.map((row) => row.id),
    )
  })
}

export async function reorderItems(planId: number, input: ReorderItemsInput) {
  await getPlanStateOrThrow(planId)
  const requestedIds = input.items.map((item) => item.itemId)
  const items = await itemRepository.findItemsByIds(planId, requestedIds)
  const [slot] = items
  if (!slot || items.length !== requestedIds.length) {
    throw new HttpError(
      422,
      'Có mục không thuộc giáo án này',
      'ITEM_NOT_IN_PLAN',
    )
  }

  const sameSlot = items.every(
    (item) =>
      item.weekNumber === slot.weekNumber &&
      item.sessionNumber === slot.sessionNumber,
  )
  if (!sameSlot) {
    throw new HttpError(
      422,
      'Các mục sắp xếp phải cùng tuần và cùng buổi',
      'ITEMS_NOT_SAME_SLOT',
    )
  }

  const orderedIds = [...input.items]
    .sort((a, b) => a.itemOrder - b.itemOrder)
    .map((item) => item.itemId)

  await runInTransaction(async (tx) => {
    const slotItems = await itemRepository.findSlotItems(tx, planId, slot)
    if (slotItems.length !== orderedIds.length) {
      throw new HttpError(
        422,
        `Phải gửi đủ ${slotItems.length} mục của tuần ${slot.weekNumber}, buổi ${slot.sessionNumber}`,
        'REORDER_INCOMPLETE',
      )
    }
    await renumberSlot(tx, planId, slot, orderedIds)
  })

  return itemRepository.findItems(planId)
}
