import { z } from 'zod'
import { idSchema, paginationSchema } from './training.common.js'

export const createAssessmentSchema = z
  .object({
    memberId: z.number().int().positive(),
    classRegistrationId: z.number().int().positive().optional(),
    privateEnrollmentId: z.number().int().positive().optional(),
    classSessionId: z.number().int().positive().optional(),
    privateCourseAttendanceId: z.number().int().positive().optional(),
    completedWorkoutPlanItemIds: z.array(z.number().int().positive()).max(100).default([]),
    assessmentDate: z.iso.date().optional(),
    coachComment: z.string().trim().min(1).max(2000),
    metrics: z.record(z.string(), z.number()).optional(),
    metricValues: z.array(z.object({ definitionId: z.number().int().positive(), value: z.number() })).min(1).max(30),
    score: z.number().min(0).max(100).optional(),
    recommendation: z.string().trim().max(2000).optional(),
    nextAssessmentDate: z.iso.date().optional(),
  })
  // Mọi đánh giá phải gắn đúng một buổi học thực tế.
  .refine(
    (data) =>
      (data.classSessionId === undefined) !==
      (data.privateCourseAttendanceId === undefined),
    {
      message: 'Cần đúng một buổi học lớp nhóm hoặc khóa 1-1',
      path: ['classSessionId'],
    },
  )
  .refine(
    (data) => data.privateEnrollmentId !== undefined || data.completedWorkoutPlanItemIds.length === 0,
    {
      message: 'Chỉ khóa 1-1 mới được ghi nhận nội dung giáo án đã hoàn thành',
      path: ['completedWorkoutPlanItemIds'],
    },
  )
  .refine(
    (data) =>
      !data.nextAssessmentDate || !data.assessmentDate || data.nextAssessmentDate > data.assessmentDate,
    {
      message: 'Ngày đánh giá tiếp theo phải sau ngày đánh giá',
      path: ['nextAssessmentDate'],
    },
  )

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>

export const listAssessmentsQuerySchema = paginationSchema.extend({
  memberId: idSchema.optional(),
})

export const assessableSessionsQuerySchema = z.object({ memberId: idSchema })

export type ListAssessmentsQuery = z.infer<typeof listAssessmentsQuerySchema>
