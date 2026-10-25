import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { assignedEnrollment, assignedRegistration } from './member-profile.repository.js'

// note: mọi phần lồng bên trong đều lọc theo coachId để Coach không thấy lớp/khóa/đánh giá của Coach khác
export function coachMemberSelect(coachId: number) {
  return {
    id: true,
    displayName: true,
    member: {
      select: {
        memberCode: true,
        trainingGoal: true,
        gender: true,
        dateOfBirth: true,
        registrations: {
          where: assignedRegistration(coachId),
          select: { groupClass: { select: { id: true, name: true, status: true, sport: { select: { name: true } } } } },
        },
        privateEnrollments: {
          where: assignedEnrollment(coachId),
          select: {
            id: true,
            status: true,
            remainingSessions: true,
            expiryDate: true,
            privateCourse: { select: { name: true, sport: { select: { name: true } } } },
            plans: {
              where: { status: 'ACTIVE' },
              select: { workoutPlan: { select: { id: true, name: true, level: true } } },
            },
          },
        },
        assessments: {
          where: { coachId },
          orderBy: [{ assessmentDate: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { assessmentDate: true, score: true, recommendation: true, nextAssessmentDate: true },
        },
      },
    },
  } satisfies Prisma.UserSelect
}

export type CoachMemberRow = Prisma.UserGetPayload<{ select: ReturnType<typeof coachMemberSelect> }>

export function searchCoachMembers(coachId: number, where: Prisma.UserWhereInput, skip: number, take: number) {
  return prisma.$transaction([
    prisma.user.findMany({
      where,
      select: coachMemberSelect(coachId),
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ])
}
