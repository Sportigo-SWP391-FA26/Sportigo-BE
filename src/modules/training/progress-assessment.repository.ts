import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { coachRefSelect, memberRefSelect } from './training.common.js'

const sportSelect = { select: { id: true, name: true } } as const

export const assessmentSelect = {
  id: true,
  assessmentDate: true,
  score: true,
  metrics: true,
  coachComment: true,
  recommendation: true,
  nextAssessmentDate: true,
  createdAt: true,
  member: { select: memberRefSelect },
  coach: { select: coachRefSelect },
  classRegistration: {
    select: {
      id: true,
      groupClass: { select: { id: true, name: true, sport: sportSelect } },
    },
  },
  privateEnrollment: {
    select: {
      id: true,
      privateCourse: { select: { id: true, name: true, sport: sportSelect } },
    },
  },
} as const

export const assessmentOrderBy: Prisma.ProgressAssessmentOrderByWithRelationInput[] =
  [{ assessmentDate: 'desc' }, { createdAt: 'desc' }]

export function findRegistrationContext(registrationId: number) {
  return prisma.classRegistration.findUnique({
    where: { id: registrationId },
    select: {
      memberId: true,
      status: true,
      groupClass: { select: { coachId: true } },
    },
  })
}

export function findEnrollmentContext(enrollmentId: number) {
  return prisma.privateCourseEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { memberId: true, coachId: true, status: true },
  })
}

export function createAssessment(data: {
  memberId: number
  coachId: number
  classRegistrationId?: number
  privateEnrollmentId?: number
  assessmentDate: Date
  coachComment: string
  metrics: Record<string, number>
  score?: number
  recommendation?: string
  nextAssessmentDate?: Date
}) {
  return prisma.progressAssessment.create({
    data,
    select: assessmentSelect,
  })
}

export function findAssessments(
  filter: { coachId?: number; memberId?: number },
  page: { skip: number; take: number },
) {
  const where: Prisma.ProgressAssessmentWhereInput = filter
  return prisma.$transaction([
    prisma.progressAssessment.findMany({
      where,
      orderBy: assessmentOrderBy,
      ...page,
      select: assessmentSelect,
    }),
    prisma.progressAssessment.count({ where }),
  ])
}
