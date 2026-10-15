import { prisma } from '../../lib/prisma.js'
import {
  assessmentOrderBy,
  assessmentSelect,
} from './progress-assessment.repository.js'
import { coachRefSelect } from './training.common.js'
import { planItemOrderBy, planItemSelect } from './workout-plan.repository.js'

// Chỉ giáo án còn hiệu lực hoặc đã học xong; bản gán đã hủy không hiển thị
export function findMemberPlanAssignments(memberId: number) {
  return prisma.planPrivateEnrollment.findMany({
    where: {
      enrollment: { memberId },
      status: { in: ['ACTIVE', 'COMPLETED'] },
    },
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      assignedAt: true,
      assignedBy: { select: coachRefSelect },
      workoutPlan: {
        select: {
          id: true,
          name: true,
          level: true,
          description: true,
          durationWeeks: true,
          sport: { select: { id: true, name: true } },
          items: { orderBy: planItemOrderBy, select: planItemSelect },
        },
      },
      enrollment: {
        select: {
          id: true,
          status: true,
          startDate: true,
          expiryDate: true,
          privateCourse: { select: { id: true, name: true } },
          coach: { select: coachRefSelect },
        },
      },
    },
  })
}

export function findMemberAssessments(memberId: number) {
  return prisma.progressAssessment.findMany({
    where: { memberId },
    orderBy: assessmentOrderBy,
    select: assessmentSelect,
  })
}
