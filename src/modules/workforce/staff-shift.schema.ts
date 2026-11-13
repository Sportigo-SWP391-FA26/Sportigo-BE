import { z } from 'zod'

// FR-67: kiểm tra đầu vào ca làm và chấm công lễ tân
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
// note: thời điểm phải là ISO có múi giờ (vd 2026-11-12T08:00:00+07:00) để không hiểu nhầm giờ
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value))
const note = z.string().trim().max(300)
const reason = z.string().trim().min(3, 'Lý do tối thiểu 3 ký tự').max(300)

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() })

export const listShiftsSchema = z.object({
  from: dateText,
  to: dateText,
  staffId: z.coerce.number().int().positive().optional(),
}).strict()

export const myShiftsSchema = z.object({ from: dateText, to: dateText }).strict()

export const createShiftSchema = z.object({
  staffId: z.number().int().positive(),
  startsAt: instant,
  endsAt: instant,
  note: note.optional(),
}).strict()

// note: sửa ca: gửi ít nhất một trường
export const updateShiftSchema = z.object({
  startsAt: instant.optional(),
  endsAt: instant.optional(),
  note: note.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Cần ít nhất một trường để sửa' })

export const cancelShiftSchema = z.object({ reason }).strict()

// note: yêu cầu sửa công: giờ vào và/hoặc giờ ra mong muốn, kèm lý do
export const adjustmentRequestSchema = z.object({
  clockInAt: instant.optional(),
  clockOutAt: instant.optional(),
  reason,
}).strict().refine((value) => value.clockInAt !== undefined || value.clockOutAt !== undefined, {
  message: 'Cần nhập giờ vào hoặc giờ ra muốn sửa',
})

export const listAdjustmentsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
}).strict()

export const approveAdjustmentSchema = z.object({ note: note.optional() }).strict()
export const rejectAdjustmentSchema = z.object({ note: reason }).strict()

export type ListShiftsQuery = z.infer<typeof listShiftsSchema>
export type CreateShiftInput = z.infer<typeof createShiftSchema>
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>
export type AdjustmentRequestInput = z.infer<typeof adjustmentRequestSchema>
