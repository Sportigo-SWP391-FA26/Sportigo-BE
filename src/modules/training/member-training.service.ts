import type { AuthUser } from '../../middleware/auth.js'
import {
  findMemberAssessments,
  findMemberPlanAssignments,
} from './member-training.repository.js'
import { toAssessment } from './progress-assessment.service.js'
import { toCoachRef, toDateOnly } from './training.common.js'

type AssignmentRow = Awaited<
  ReturnType<typeof findMemberPlanAssignments>
>[number]

function toPlanAssignment({ assignedBy, enrollment, ...rest }: AssignmentRow) {
  return {
    ...rest,
    assignedBy: toCoachRef(assignedBy),
    enrollment: {
      id: enrollment.id,
      status: enrollment.status,
      startDate: toDateOnly(enrollment.startDate),
      expiryDate: toDateOnly(enrollment.expiryDate),
      course: enrollment.privateCourse,
      coach: toCoachRef(enrollment.coach),
    },
  }
}

// FR-53: chỉ dữ liệu của chính Member đang đăng nhập (id lấy từ token)
export async function getMyTraining(user: AuthUser) {
  const [assignments, assessments] = await Promise.all([
    findMemberPlanAssignments(user.id),
    findMemberAssessments(user.id),
  ])
  return {
    planAssignments: assignments.map(toPlanAssignment),
    assessments: assessments.map(toAssessment),
  }
}
