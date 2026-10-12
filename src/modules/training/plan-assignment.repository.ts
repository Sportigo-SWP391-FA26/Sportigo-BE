import { prisma } from '../../lib/prisma.js'
import { coachRefSelect } from './training.common.js'

const assignmentSelect = {
  id: true,
  enrollmentId: true,
  status: true,
  assignedAt: true,
  workoutPlan: {
    select: {
      id: true,
      name: true,
      level: true,
      status: true,
      durationWeeks: true,
      sport: { select: { id: true, name: true } },
    },
  },
  assignedBy: { select: coachRefSelect },
} as const

export function findEnrollment(enrollmentId: number) {
  return prisma.privateCourseEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      memberId: true,
      coachId: true,
      status: true,
      privateCourse: { select: { id: true, name: true, sportId: true } },
    },
  })
}

export function findPlan(planId: number) {
  return prisma.workoutPlan.findUnique({
    where: { id: planId },
    select: { id: true, sportId: true, status: true },
  })
}

export function findAssignment(enrollmentId: number, workoutPlanId: number) {
  return prisma.planPrivateEnrollment.findUnique({
    where: { enrollmentId_workoutPlanId: { enrollmentId, workoutPlanId } },
    select: { id: true, status: true },
  })
}

export function createAssignment(data: {
  enrollmentId: number
  workoutPlanId: number
  assignedById: number
}) {
  return prisma.planPrivateEnrollment.create({
    data,
    select: assignmentSelect,
  })
}

export function reactivateAssignment(
  assignmentId: number,
  assignedById: number,
) {
  return prisma.planPrivateEnrollment.update({
    where: { id: assignmentId },
    data: { status: 'ACTIVE', assignedById, assignedAt: new Date() },
    select: assignmentSelect,
  })
}

export function findAssignments(enrollmentId: number) {
  return prisma.planPrivateEnrollment.findMany({
    where: { enrollmentId },
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    select: assignmentSelect,
  })
}
