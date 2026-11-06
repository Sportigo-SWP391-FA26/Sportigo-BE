import type { AuthUser } from '../../middleware/auth.js'
import {
  findMemberAssessments,
  findMemberPlanAssignments,
} from './member-training.repository.js'
import { toAssessment } from './progress-assessment.service.js'
import { toCoachRef, toDateOnly } from './training.common.js'
import { KeyedReadCache } from '../../lib/read-cache.js'
import { registerMemberTrainingCacheInvalidator } from './member-training-cache.js'

type AssignmentRow = Awaited<
  ReturnType<typeof findMemberPlanAssignments>
>[number]

function toPlanAssignment({ assignedBy, enrollment, ...rest }: AssignmentRow) {
  const completedItems = rest.completedItems.map((completion) => ({
    workoutPlanItemId: completion.workoutPlanItemId,
    completedAt: completion.completedAt,
    session: {
      id: completion.privateCourseAttendance.id,
      sessionDate: toDateOnly(completion.privateCourseAttendance.sessionDate),
      startsAt: completion.privateCourseAttendance.startsAt,
      endsAt: completion.privateCourseAttendance.endsAt,
    },
    completedBy: toCoachRef(completion.completedBy),
  }))
  const totalItems = rest.workoutPlan.items.length
  return {
    ...rest,
    completedItems,
    progress: {
      totalItems,
      completedItems: completedItems.length,
      percentage: totalItems === 0 ? 0 : Math.round((completedItems.length / totalItems) * 100),
    },
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

type MemberTrainingResult = {
  planAssignments: ReturnType<typeof toPlanAssignment>[]
  assessments: ReturnType<typeof toAssessment>[]
}
const memberTrainingCache = new KeyedReadCache<MemberTrainingResult>(15_000)
registerMemberTrainingCacheInvalidator(() => memberTrainingCache.invalidate())

// FR-53: chỉ dữ liệu của chính Member đang đăng nhập (id lấy từ token)
export async function getMyTraining(user: AuthUser) {
  return memberTrainingCache.get(String(user.id), async () => {
    const [assignments, assessments] = await Promise.all([
      findMemberPlanAssignments(user.id),
      findMemberAssessments(user.id),
    ])
    return {
      planAssignments: assignments.map(toPlanAssignment),
      assessments: assessments.map(toAssessment),
    }
  })
}
