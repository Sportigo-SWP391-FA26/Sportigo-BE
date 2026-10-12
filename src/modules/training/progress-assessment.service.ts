import type { EnrollmentStatus } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import * as assessmentRepository from './progress-assessment.repository.js'
import type {
  CreateAssessmentInput,
  ListAssessmentsQuery,
} from './progress-assessment.schema.js'
import {
  BR_MESSAGES,
  toCoachRef,
  toDateOnly,
  toMemberRef,
  toPage,
  toSkipTake,
} from './training.common.js'

// Khóa 1-1 đã kích hoạt (đang học hoặc đã học xong) mới được đánh giá
const ASSESSABLE_ENROLLMENT: EnrollmentStatus[] = ['ACTIVE', 'COMPLETED']

type AssessmentRow = Awaited<
  ReturnType<typeof assessmentRepository.createAssessment>
>

function toContext({ classRegistration, privateEnrollment }: AssessmentRow) {
  if (classRegistration) {
    return {
      type: 'GROUP_CLASS' as const,
      classRegistrationId: classRegistration.id,
      class: classRegistration.groupClass,
    }
  }
  if (privateEnrollment) {
    return {
      type: 'PRIVATE_COURSE' as const,
      privateEnrollmentId: privateEnrollment.id,
      course: privateEnrollment.privateCourse,
    }
  }
  return null
}

export function toAssessment(row: AssessmentRow) {
  return {
    id: row.id,
    assessmentDate: toDateOnly(row.assessmentDate),
    score: row.score,
    metrics: row.metrics,
    coachComment: row.coachComment,
    recommendation: row.recommendation,
    nextAssessmentDate: toDateOnly(row.nextAssessmentDate),
    createdAt: row.createdAt,
    member: toMemberRef(row.member),
    coach: toCoachRef(row.coach),
    context: toContext(row),
  }
}

function contextError() {
  return new HttpError(403, BR_MESSAGES.BR46, 'ASSESSMENT_CONTEXT_INVALID')
}

// BR-46: ngữ cảnh phải thuộc đúng Member và do chính Coach này phụ trách
async function assertCoachOwnsContext(
  coachId: number,
  input: CreateAssessmentInput,
) {
  if (input.classRegistrationId !== undefined) {
    const registration = await assessmentRepository.findRegistrationContext(
      input.classRegistrationId,
    )
    const valid =
      registration?.memberId === input.memberId &&
      registration.status === 'CONFIRMED' &&
      registration.groupClass.coachId === coachId
    if (!valid) throw contextError()
    return
  }

  if (input.privateEnrollmentId !== undefined) {
    const enrollment = await assessmentRepository.findEnrollmentContext(
      input.privateEnrollmentId,
    )
    const valid =
      enrollment?.memberId === input.memberId &&
      enrollment.coachId === coachId &&
      ASSESSABLE_ENROLLMENT.includes(enrollment.status)
    if (!valid) throw contextError()
    return
  }

  throw contextError()
}

export async function createAssessment(
  user: AuthUser,
  input: CreateAssessmentInput,
) {
  await assertCoachOwnsContext(user.id, input)
  const assessment = await assessmentRepository.createAssessment({
    ...input,
    coachId: user.id,
    assessmentDate: new Date(input.assessmentDate),
    nextAssessmentDate: input.nextAssessmentDate
      ? new Date(input.nextAssessmentDate)
      : undefined,
  })
  return toAssessment(assessment)
}

export async function listAssessments(
  user: AuthUser,
  query: ListAssessmentsQuery,
) {
  const { page, pageSize, memberId } = query
  const [rows, total] = await assessmentRepository.findAssessments(
    {
      memberId,
      // Coach chỉ xem các đánh giá do chính mình ghi
      coachId: user.role === 'COACH' ? user.id : undefined,
    },
    toSkipTake({ page, pageSize }),
  )
  return toPage(rows.map(toAssessment), total, { page, pageSize })
}
