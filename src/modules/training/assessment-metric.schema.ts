import { z } from 'zod'

const metricDefinitionBaseSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(50),
  name: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(30),
  minValue: z.coerce.number(),
  maxValue: z.coerce.number(),
  direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']).default('HIGHER_IS_BETTER'),
  isRequired: z.boolean().default(true),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(0),
})

export const metricDefinitionSchema = metricDefinitionBaseSchema.refine((value) => value.minValue < value.maxValue, { path: ['maxValue'], message: 'Giá trị tối đa phải lớn hơn giá trị tối thiểu' })

export const metricDefinitionUpdateSchema = metricDefinitionBaseSchema.partial().refine(
  (value) => value.minValue === undefined || value.maxValue === undefined || value.minValue < value.maxValue,
  { path: ['maxValue'], message: 'Giá trị tối đa phải lớn hơn giá trị tối thiểu' },
)

