import { z } from 'zod'
import { idSchema, paginationSchema } from './training.common.js'

const CENTER_TIME_ZONE = 'Asia/Ho_Chi_Minh'

// "Hôm nay" theo múi giờ trung tâm (NFR-24), dạng YYYY-MM-DD
function todayAtCenter() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTER_TIME_ZONE,
  }).format(new Date())
}

export const createAssessmentSchema = z
  .object({
    memberId: z.number().int().positive(),
    classRegistrationId: z.number().int().positive().optional(),
    privateEnrollmentId: z.number().int().positive().optional(),
    assessmentDate: z.iso
      .date()
      .refine(
        (date) => date <= todayAtCenter(),
        'Ngày đánh giá không được ở tương lai',
      ),
    coachComment: z.string().trim().min(1).max(2000),
    // Chỉ số dạng { "tenChiSo": số }, ví dụ { "speed": 7, "technique": 8 }
    metrics: z
      .record(z.string().min(1).max(50), z.number())
      .refine((metrics) => {
        const count = Object.keys(metrics).length
        return count >= 1 && count <= 30
      }, 'metrics phải có từ 1 đến 30 chỉ số'),
    score: z.number().min(0).max(100).optional(),
    recommendation: z.string().trim().max(2000).optional(),
    nextAssessmentDate: z.iso.date().optional(),
  })
  // BR-46: đúng một ngữ cảnh, lớp nhóm hoặc khóa 1-1
  .refine(
    (data) =>
      (data.classRegistrationId === undefined) !==
      (data.privateEnrollmentId === undefined),
    {
      message:
        'Cần đúng một ngữ cảnh: classRegistrationId hoặc privateEnrollmentId',
      path: ['classRegistrationId'],
    },
  )
  .refine(
    (data) =>
      !data.nextAssessmentDate || data.nextAssessmentDate > data.assessmentDate,
    {
      message: 'Ngày đánh giá tiếp theo phải sau ngày đánh giá',
      path: ['nextAssessmentDate'],
    },
  )

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>

export const listAssessmentsQuerySchema = paginationSchema.extend({
  memberId: idSchema.optional(),
})

export type ListAssessmentsQuery = z.infer<typeof listAssessmentsQuerySchema>
