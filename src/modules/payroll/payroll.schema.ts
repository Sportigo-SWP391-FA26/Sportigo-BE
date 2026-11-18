import { z } from 'zod'

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng phải có dạng YYYY-MM')
export const compensationSchema = z.object({
  baseSalary: z.number().int().nonnegative(),
  effectiveFromMonth: monthSchema,
  effectiveToMonth: monthSchema.nullable().optional(),
}).refine((v) => !v.effectiveToMonth || v.effectiveToMonth >= v.effectiveFromMonth, 'Tháng kết thúc không hợp lệ')
export const recurringItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['ALLOWANCE', 'DEDUCTION']),
  amount: z.number().int().nonnegative(),
  effectiveFromMonth: monthSchema,
  effectiveToMonth: monthSchema.nullable().optional(),
  isActive: z.boolean().default(true),
}).refine((v) => !v.effectiveToMonth || v.effectiveToMonth >= v.effectiveFromMonth, 'Tháng kết thúc không hợp lệ')

export function monthRange(month: string) {
  const validated = monthSchema.parse(month)
  const year = Number(validated.slice(0, 4))
  const index = Number(validated.slice(5, 7))
  return {
    start: new Date(Date.UTC(year, index - 1, 1) - 7 * 3_600_000),
    endExclusive: new Date(Date.UTC(year, index, 1) - 7 * 3_600_000),
    lastDate: new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10),
  }
}
