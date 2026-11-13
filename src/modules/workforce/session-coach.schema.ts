import { z } from 'zod'

// FR-66: kiểm tra đầu vào API dạy thay / coach vắng
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
const reason = z.string().trim().min(3, 'Lý do tối thiểu 3 ký tự').max(300)

export const sessionIdParamSchema = z.object({ sessionId: z.coerce.number().int().positive() })

// note: lọc theo khoảng ngày (bắt buộc) và coach (tuỳ chọn); chỉ buổi có dạy thay/vắng nếu changedOnly=true
export const listSessionCoachesSchema = z.object({
  from: dateText,
  to: dateText,
  coachId: z.coerce.number().int().positive().optional(),
  changedOnly: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
}).strict()

// note: giao người dạy thay; coachAbsent=true nghĩa là coach chính vắng (lỗi coach), false là trung tâm chủ động đổi người
export const substituteSchema = z.object({
  coachId: z.number().int().positive(),
  reason,
  coachAbsent: z.boolean().default(false),
}).strict()

export const absenceSchema = z.object({ reason }).strict()

export type ListSessionCoachesQuery = z.infer<typeof listSessionCoachesSchema>
export type SubstituteInput = z.infer<typeof substituteSchema>
