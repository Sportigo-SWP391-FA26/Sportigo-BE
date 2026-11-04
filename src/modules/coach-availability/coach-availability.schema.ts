import { z } from 'zod'
import { AVAILABILITY_SHIFTS } from './coach-availability.constants.js'

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const shiftCodes = AVAILABILITY_SHIFTS.map((shift) => shift.code) as [string, ...string[]]

export const monthParamSchema = z.object({ month: z.string().regex(monthPattern, 'Tháng phải có định dạng YYYY-MM') })
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() })

export const selectionSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  shiftCode: z.enum(shiftCodes),
})

export const draftSchema = z.object({ selections: z.array(selectionSchema).max(49) })

export const changeRequestSchema = z.object({
  month: z.string().regex(monthPattern),
  oldDayOfWeek: z.number().int().min(0).max(6),
  oldShiftCode: z.enum(shiftCodes),
  newDayOfWeek: z.number().int().min(0).max(6),
  newShiftCode: z.enum(shiftCodes),
  reason: z.string().trim().min(10).max(500),
}).refine((value) => value.oldDayOfWeek !== value.newDayOfWeek || value.oldShiftCode !== value.newShiftCode, {
  message: 'Ca thay thế phải khác ca hiện tại',
})

export const submissionListSchema = z.object({
  month: z.string().regex(monthPattern).optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  coachId: z.coerce.number().int().positive().optional(),
})

export const reviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.decision === 'REJECT' && (!value.reason || value.reason.length < 5)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'Từ chối phải có lý do ít nhất 5 ký tự' })
  }
})

export const changeListSchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  coachId: z.coerce.number().int().positive().optional(),
})

