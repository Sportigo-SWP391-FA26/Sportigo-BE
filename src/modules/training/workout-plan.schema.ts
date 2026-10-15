import { z } from 'zod'
import { idSchema, paginationSchema } from './training.common.js'

export const planLevelSchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])

export const listPlansQuerySchema = paginationSchema.extend({
  sportId: idSchema.optional(),
  level: planLevelSchema.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
})

export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>

const planFields = {
  sportId: z.number().int().positive(),
  name: z.string().trim().min(2).max(160),
  level: planLevelSchema,
  description: z.string().trim().max(2000).nullish(),
  durationWeeks: z.number().int().min(1).max(104),
}

export const createPlanSchema = z.object(planFields)

export type CreatePlanInput = z.infer<typeof createPlanSchema>

export const updatePlanSchema = z
  .object(planFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  })

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>

export const changePlanStatusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']),
})

export type ChangePlanStatusInput = z.infer<typeof changePlanStatusSchema>
