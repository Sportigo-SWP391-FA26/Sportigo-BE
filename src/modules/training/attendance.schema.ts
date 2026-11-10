import { z } from 'zod'
import { idSchema, paginationSchema } from './training.common.js'

export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
])

export const markAttendanceSchema = z
  .object({
    records: z
      .array(
        z.object({
          classRegistrationId: z.number().int().positive(),
          // Chỉ ghi Có mặt/Vắng; LATE, EXCUSED còn trong enum để đọc dữ liệu cũ
          status: z.enum(['PRESENT', 'ABSENT']),
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
