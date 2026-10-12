import { z } from 'zod'

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
          status: attendanceStatusSchema,
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
