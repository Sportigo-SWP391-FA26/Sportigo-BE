import { z } from 'zod'
import { idSchema } from './training.common.js'

const itemFields = {
  weekNumber: z.number().int().min(1).max(104),
  sessionNumber: z.number().int().min(1).max(14),
  itemOrder: z.number().int().min(1).max(1000),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(5000),
  durationMinutes: z.number().int().min(1).max(600).nullish(),
  sets: z.number().int().min(1).max(100).nullish(),
  repetitions: z.number().int().min(1).max(1000).nullish(),
  intensity: z.string().trim().min(1).max(40).nullish(),
  note: z.string().trim().max(1000).nullish(),
}

export const itemParamsSchema = z.object({ id: idSchema, itemId: idSchema })

// Bỏ trống itemOrder thì mục được xếp cuối tuần/buổi đó
export const createItemSchema = z.object({
  ...itemFields,
  itemOrder: itemFields.itemOrder.optional(),
})

export type CreateItemInput = z.infer<typeof createItemSchema>

export const updateItemSchema = z
  .object(itemFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  })

export type UpdateItemInput = z.infer<typeof updateItemSchema>

export const reorderItemsSchema = z
  .object({
    items: z
      .array(
        z.object({
          itemId: z.number().int().positive(),
          itemOrder: z.number().int().min(1),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine(({ items }, context) => {
    const ids = items.map((item) => item.itemId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'itemId bị lặp trong cùng yêu cầu',
      })
    }
    // BR-45: thứ tự dương và liên tục 1..n
    const orders = items.map((item) => item.itemOrder).sort((a, b) => a - b)
    if (orders.some((order, index) => order !== index + 1)) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Thứ tự phải là các số dương liên tục bắt đầu từ 1',
      })
    }
  })

export type ReorderItemsInput = z.infer<typeof reorderItemsSchema>
