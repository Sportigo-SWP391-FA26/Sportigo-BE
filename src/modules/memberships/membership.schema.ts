import { z } from 'zod'

export const idSchema = z.coerce.number().int().positive()

const planFields = {
  name: z.string().trim().min(2).max(160),
  durationMonths: z.coerce.number().int().min(1).max(36),
  price: z.coerce.number().positive().max(9_999_999_999),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']),
}

export const createPlanSchema = z.object({ ...planFields, status: planFields.status.default('DRAFT') })
export const updatePlanSchema = z.object({
  name: planFields.name.optional(),
  durationMonths: planFields.durationMonths.optional(),
  price: planFields.price.optional(),
  description: planFields.description,
  status: planFields.status.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Cần ít nhất một trường cần cập nhật' })

export const purchaseSchema = z.object({ planId: idSchema })

export const checkInSchema = z.object({
  memberCode: z.string().trim().min(3).max(30).transform((value) => value.toUpperCase()),
  method: z.enum(['QR', 'MANUAL']),
})

export const checkInListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
export type CheckInInput = z.infer<typeof checkInSchema>
