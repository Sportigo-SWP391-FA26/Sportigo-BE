import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import * as assignmentRepository from './plan-assignment.repository.js'
import type { AssignPlanInput } from './plan-assignment.schema.js'
import {
  BR_MESSAGES,
  forbidden,
  isUniqueViolation,
  notFound,
  toCoachRef,
} from './training.common.js'

type AssignmentRow = Awaited<
  ReturnType<typeof assignmentRepository.createAssignment>
>

function toAssignment({ assignedBy, ...assignment }: AssignmentRow) {
  return { ...assignment, assignedBy: toCoachRef(assignedBy) }
}

function alreadyAssigned() {
  return new HttpError(
    409,
    'Giáo án này đang được gán cho khóa học',
    'PLAN_ALREADY_ASSIGNED',
  )
}

async function getEnrollmentOrThrow(enrollmentId: number) {
  const enrollment = await assignmentRepository.findEnrollment(enrollmentId)
  if (!enrollment) throw notFound('Không tìm thấy khóa học 1-1')
  return enrollment
}

export async function assignPlan(
  user: AuthUser,
  enrollmentId: number,
  { workoutPlanId }: AssignPlanInput,
) {
  const enrollment = await getEnrollmentOrThrow(enrollmentId)
  // FR-51: chỉ Coach phụ trách enrollment được gán giáo án
  if (enrollment.coachId !== user.id) throw forbidden()
  if (enrollment.status !== 'ACTIVE') {
    throw new HttpError(
      409,
      'Khóa học 1-1 chưa ở trạng thái ACTIVE nên chưa thể gán giáo án',
      'ENROLLMENT_NOT_ACTIVE',
    )
  }

  const plan = await assignmentRepository.findPlan(workoutPlanId)
  if (!plan) throw notFound('Không tìm thấy giáo án')
  // BR-44: giáo án phải ACTIVE và cùng môn với khóa 1-1
  const sameSport = plan.sportId === enrollment.privateCourse.sportId
  if (plan.status !== 'ACTIVE' || !sameSport) {
    throw new HttpError(422, BR_MESSAGES.BR44, 'PLAN_NOT_ASSIGNABLE')
  }

  // FR-51: một gán đang hoạt động không bị trùng; gán đã kết thúc thì kích hoạt lại
  const existing = await assignmentRepository.findAssignment(
    enrollmentId,
    workoutPlanId,
  )
  if (existing?.status === 'ACTIVE') throw alreadyAssigned()

  try {
    const assignment = existing
      ? await assignmentRepository.reactivateAssignment(existing.id, user.id)
      : await assignmentRepository.createAssignment({
          enrollmentId,
          workoutPlanId,
          assignedById: user.id,
        })
    return toAssignment(assignment)
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyAssigned()
    throw error
  }
}

export async function listAssignments(user: AuthUser, enrollmentId: number) {
  const enrollment = await getEnrollmentOrThrow(enrollmentId)
  const canView =
    user.role === 'CENTER_MANAGER' ||
    (user.role === 'COACH' && enrollment.coachId === user.id) ||
    (user.role === 'MEMBER' && enrollment.memberId === user.id)
  if (!canView) throw forbidden()

  const assignments = await assignmentRepository.findAssignments(enrollmentId)
  return assignments.map(toAssignment)
}
