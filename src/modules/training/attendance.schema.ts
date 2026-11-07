import { z } from 'zod'
import { idSchema, paginationSchema } from './training.common.js'

// Lọc lịch sử vẫn nhận đủ 4 giá trị để đọc dữ liệu cũ (LATE, EXCUSED)
export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
])

// FR-47: Coach chỉ ghi Có mặt hoặc Vắng; enum trong DB giữ nguyên vì module khác còn dùng
export const markableStatusSchema = z.enum(['PRESENT', 'ABSENT'], {
  message: 'Chỉ ghi được Có mặt (PRESENT) hoặc Vắng (ABSENT)',
})

export const markAttendanceSchema = z
  .object({
    records: z
      .array(
        z.object({
          classRegistrationId: z.number().int().positive(),
          status: markableStatusSchema,
          note: z.string().trim().max(500).optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((data, context) => {
    const seen = new Set<number>()
    const duplicated = new Set<number>()
    for (const { classRegistrationId } of data.records) {
      if (seen.has(classRegistrationId)) duplicated.add(classRegistrationId)
      seen.add(classRegistrationId)
    }
    if (duplicated.size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['records'],
        message: `classRegistrationId bị lặp trong cùng yêu cầu: ${[...duplicated].join(', ')}`,
      })
    }
  })

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>

const attendanceFilterShape = {
  classId: idSchema.optional(),
  memberId: idSchema.optional(),
  sessionId: idSchema.optional(),
  status: attendanceStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}

const validRange = (query: { from?: Date; to?: Date }) =>
  !query.from || !query.to || query.from <= query.to
const rangeError = { message: 'from phải trước hoặc bằng to', path: ['to'] }

export const listAttendanceQuerySchema = paginationSchema
  .extend(attendanceFilterShape)
  .refine(validRange, rangeError)

export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>

// Xuất Excel: cùng bộ lọc với danh sách, không phân trang
export const exportAttendanceQuerySchema = z
  .object(attendanceFilterShape)
  .refine(validRange, rangeError)

export type ExportAttendanceQuery = z.infer<typeof exportAttendanceQuerySchema>
