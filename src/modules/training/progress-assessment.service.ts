import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import * as assessmentRepository from './progress-assessment.repository.js'
import type {
  CreateAssessmentInput,
  ListAssessmentsQuery,
} from './progress-assessment.schema.js'
import {
  BR_MESSAGES,
  parseDateOnly,
  toCenterDateOnly,
  toCoachRef,
  toDateOnly,
  toMemberRef,
  toPage,
  toSkipTake,
} from './training.common.js'
import { invalidateMemberTrainingCache } from './member-training-cache.js'

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
  const metricValues = row.metricValues.map((entry) => ({
    definitionId: entry.definition.id,
    code: entry.definition.code,
    name: entry.definition.name,
    unit: entry.definition.unit,
    minValue: entry.definition.minValue,
    maxValue: entry.definition.maxValue,
    direction: entry.definition.direction,
    value: entry.value,
  }))
  return {
    id: row.id,
    assessmentDate: toDateOnly(row.assessmentDate),
    score: row.score,
    metrics: Object.fromEntries(metricValues.map((entry) => [entry.name, Number(entry.value)])),
    metricValues,
    coachComment: row.coachComment,
    recommendation: row.recommendation,
    nextAssessmentDate: toDateOnly(row.nextAssessmentDate),
    createdAt: row.createdAt,
    member: toMemberRef(row.member),
    coach: toCoachRef(row.coach),
    context: toContext(row),
    session: row.classSession
      ? { type: 'GROUP_CLASS' as const, ...row.classSession }
      : row.privateCourseAttendance
        ? { type: 'PRIVATE_COURSE' as const, ...row.privateCourseAttendance }
        : null,
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
  if (input.classSessionId !== undefined) {
    const session = await assessmentRepository.findGroupSessionForAssessment(input.memberId, input.classSessionId)
    const attendance = session?.attendances[0]
    const attended = attendance?.status
    if (
      !session ||
      session.groupClass.coachId !== coachId ||
      session.endsAt > new Date() ||
      session.status === 'CANCELLED' ||
      attendance?.registration.status !== 'CONFIRMED' ||
      !attended ||
      !['PRESENT', 'LATE'].includes(attended)
    ) {
      throw new HttpError(400, 'Chỉ được đánh giá học viên đã tham gia một buổi học đã kết thúc.', 'SESSION_NOT_ASSESSABLE')
    }
    if (input.classRegistrationId !== undefined && input.classRegistrationId !== attendance.registration.id) throw contextError()
    if (input.privateEnrollmentId !== undefined) throw contextError()
    return {
      classRegistrationId: attendance.registration.id,
      classSessionId: session.id,
      sportId: session.groupClass.sportId,
      assessmentDate: toCenterDateOnly(session.startsAt),
      completedItems: [] as { planAssignmentId: number; workoutPlanItemId: number }[],
    }
  }

  if (input.privateCourseAttendanceId !== undefined) {
    const attendance = await assessmentRepository.findPrivateAttendanceContext(
      input.privateCourseAttendanceId,
    )
    const enrollment = attendance?.schedule.enrollment
    if (
      !attendance ||
      enrollment?.memberId !== input.memberId ||
      enrollment.coachId !== coachId ||
      attendance.endsAt > new Date()
    ) {
      throw new HttpError(400, 'Buổi học 1-1 chưa hoàn thành hoặc không thuộc khóa học này.', 'SESSION_NOT_ASSESSABLE')
    }
    if (input.privateEnrollmentId !== undefined && input.privateEnrollmentId !== attendance.schedule.enrollmentId) throw contextError()
    if (input.classRegistrationId !== undefined) throw contextError()

    const uniqueItemIds = [...new Set(input.completedWorkoutPlanItemIds)]
    const assignments = uniqueItemIds.length > 0
      ? await assessmentRepository.findActivePlanItems(attendance.schedule.enrollmentId, uniqueItemIds)
      : []
    const ownerByItem = new Map<number, number>()
    for (const assignment of assignments) {
      for (const item of assignment.workoutPlan.items) ownerByItem.set(item.id, assignment.id)
    }
    if (ownerByItem.size !== uniqueItemIds.length) {
      throw new HttpError(400, 'Có nội dung giáo án không thuộc giáo án đang áp dụng cho khóa 1-1.', 'PLAN_ITEM_INVALID')
    }
    return {
      privateEnrollmentId: attendance.schedule.enrollmentId,
      privateCourseAttendanceId: attendance.id,
      sportId: enrollment.privateCourse.sportId,
      assessmentDate: toDateOnly(attendance.sessionDate)!,
      completedItems: uniqueItemIds.map((workoutPlanItemId) => ({ workoutPlanItemId, planAssignmentId: ownerByItem.get(workoutPlanItemId)! })),
    }
  }

  throw contextError()
}

export async function createAssessment(
  user: AuthUser,
  input: CreateAssessmentInput,
) {
  if (input.classSessionId || input.privateCourseAttendanceId) {
    const existing = await assessmentRepository.findSessionAssessment(
      input.memberId,
      input.classSessionId,
      input.privateCourseAttendanceId,
    )
    if (existing) {
      throw new HttpError(409, 'Học viên đã được đánh giá cho buổi học này.', 'SESSION_ALREADY_ASSESSED')
    }
  }
  const context = await assertCoachOwnsContext(user.id, input)
  if (input.assessmentDate && input.assessmentDate !== context.assessmentDate) {
    throw new HttpError(400, 'Ngày đánh giá phải trùng ngày buổi học', 'ASSESSMENT_DATE_MISMATCH')
  }
  if (input.nextAssessmentDate && input.nextAssessmentDate <= context.assessmentDate) {
    throw new HttpError(400, 'Ngày đánh giá tiếp theo phải sau ngày buổi học', 'NEXT_ASSESSMENT_DATE_INVALID')
  }
  const definitions = await assessmentRepository.findMetricDefinitionsForSports([context.sportId])
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const uniqueValues = new Map(input.metricValues.map((entry) => [entry.definitionId, entry.value]))
  if (uniqueValues.size !== input.metricValues.length) throw new HttpError(400, 'Chỉ số đánh giá bị trùng', 'METRIC_DUPLICATED')
  for (const definition of definitions.filter((item) => item.isRequired)) {
    if (!uniqueValues.has(definition.id)) throw new HttpError(400, `Thiếu chỉ số bắt buộc: ${definition.name}`, 'METRIC_REQUIRED')
  }
  for (const [definitionId, value] of uniqueValues) {
    const definition = definitionsById.get(definitionId)
    if (!definition) throw new HttpError(400, 'Chỉ số không hoạt động hoặc không thuộc bộ môn', 'METRIC_INVALID')
    if (value < Number(definition.minValue) || value > Number(definition.maxValue)) throw new HttpError(400, `${definition.name} phải từ ${definition.minValue} đến ${definition.maxValue}`, 'METRIC_OUT_OF_RANGE')
  }
  const assessmentInput = {
    memberId: input.memberId,
    classRegistrationId: context.classRegistrationId,
    privateEnrollmentId: context.privateEnrollmentId,
    classSessionId: context.classSessionId,
    privateCourseAttendanceId: context.privateCourseAttendanceId,
    assessmentDate: context.assessmentDate,
    coachComment: input.coachComment,
    score: input.score,
    recommendation: input.recommendation,
    nextAssessmentDate: input.nextAssessmentDate,
  }
  const assessment = await assessmentRepository.createAssessment({
    ...assessmentInput,
    coachId: user.id,
    assessmentDate: parseDateOnly(context.assessmentDate),
    nextAssessmentDate: input.nextAssessmentDate
      ? parseDateOnly(input.nextAssessmentDate)
      : undefined,
  }, input.metricValues, context.completedItems)
  invalidateMemberTrainingCache()
  return toAssessment(assessment)
}

export async function listAssessableSessions(user: AuthUser, memberId: number) {
  const sessions = await assessmentRepository.findAssessableSessions(user.id, memberId)
  const sportIds = [...new Set([
    ...sessions.group.map((item) => item.groupClass.sport.id),
    ...sessions.privateSessions.map((item) => item.schedule.enrollment.privateCourse.sport.id),
  ])]
  const definitions = await assessmentRepository.findMetricDefinitionsForSports(sportIds)
  const metricsBySport = new Map<number, typeof definitions>()
  for (const definition of definitions) metricsBySport.set(definition.sportId, [...(metricsBySport.get(definition.sportId) ?? []), definition])
  return [
    ...sessions.group.map((session) => ({
      type: 'GROUP_CLASS' as const, id: session.id, startsAt: session.startsAt, endsAt: session.endsAt,
      name: session.groupClass.name, sport: session.groupClass.sport,
      metricDefinitions: metricsBySport.get(session.groupClass.sport.id) ?? [], completedPlanItems: [],
    })),
    ...sessions.privateSessions.map((session) => {
      const enrollment = session.schedule.enrollment
      const completed = new Set(enrollment.plans.flatMap((assignment) => assignment.completedItems.map((item) => item.workoutPlanItemId)))
      return {
        type: 'PRIVATE_COURSE' as const, id: session.id, sessionDate: toDateOnly(session.sessionDate), startsAt: session.startsAt, endsAt: session.endsAt,
        name: enrollment.privateCourse.name, sport: enrollment.privateCourse.sport,
        metricDefinitions: metricsBySport.get(enrollment.privateCourse.sport.id) ?? [],
        completedPlanItems: enrollment.plans.flatMap((assignment) => assignment.workoutPlan.items.filter((item) => !completed.has(item.id))),
      }
    }),
  ].sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())
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
