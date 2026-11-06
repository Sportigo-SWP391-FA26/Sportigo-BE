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
  classSession: {
    select: { id: true, startsAt: true, endsAt: true, status: true },
  },
  privateCourseAttendance: {
    select: { id: true, sessionDate: true, startsAt: true, endsAt: true, completedAt: true },
  },
  metricValues: {
    orderBy: { definition: { displayOrder: 'asc' } },
    select: {
      value: true,
      definition: { select: { id: true, code: true, name: true, unit: true, minValue: true, maxValue: true, direction: true } },
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
      classId: true,
      status: true,
      groupClass: { select: { coachId: true } },
    },
  })
}

export function findGroupSessionContext(registrationId: number, sessionId: number) {
  return prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      groupClass: { select: { coachId: true } },
      attendances: {
        where: { registrationId },
        select: { status: true },
        take: 1,
      },
    },
  })
}

export function findGroupSessionForAssessment(memberId: number, sessionId: number) {
  return prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, startsAt: true, endsAt: true, status: true,
      groupClass: { select: { id: true, coachId: true, sportId: true } },
      attendances: {
        where: { registration: { memberId } },
        select: { status: true, registration: { select: { id: true, memberId: true, status: true } } },
        take: 1,
      },
    },
  })
}

export function findEnrollmentContext(enrollmentId: number) {
  return prisma.privateCourseEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { memberId: true, coachId: true, status: true },
  })
}

export function findPrivateAttendanceContext(attendanceId: number) {
  return prisma.privateCourseAttendance.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      sessionDate: true,
      startsAt: true,
      endsAt: true,
      markedById: true,
      schedule: {
        select: {
          enrollmentId: true,
          enrollment: { select: { memberId: true, coachId: true, privateCourse: { select: { sportId: true } } } },
        },
      },
    },
  })
}


export async function findAssessableSessions(coachId: number, memberId: number) {
  const now = new Date()
  const [group, privateSessions] = await Promise.all([
    prisma.classSession.findMany({
      where: {
        groupClass: { coachId }, endsAt: { lte: now }, status: { not: 'CANCELLED' },
        attendances: { some: { status: { in: ['PRESENT', 'LATE'] }, registration: { memberId } } },
        assessments: { none: { memberId } },
      },
      orderBy: { startsAt: 'desc' },
      select: {
        id: true, startsAt: true, endsAt: true,
        groupClass: { select: { id: true, name: true, sport: { select: { id: true, name: true } } } },
      },
    }),
    prisma.privateCourseAttendance.findMany({
      where: {
        completedAt: { lte: now }, schedule: { enrollment: { memberId, coachId } }, assessments: { none: { memberId } },
      },
      orderBy: [{ sessionDate: 'desc' }, { startsAt: 'desc' }],
      select: {
        id: true, sessionDate: true, startsAt: true, endsAt: true,
        schedule: { select: { enrollment: { select: {
          id: true,
          privateCourse: { select: { id: true, name: true, sport: { select: { id: true, name: true } } } },
          plans: { where: { status: 'ACTIVE' }, select: {
            id: true,
            workoutPlan: { select: { items: { orderBy: [{ weekNumber: 'asc' }, { sessionNumber: 'asc' }, { itemOrder: 'asc' }], select: { id: true, weekNumber: true, sessionNumber: true, itemOrder: true, title: true, content: true } } } },
            completedItems: { select: { workoutPlanItemId: true } },
          } },
        } } } },
      },
    }),
  ])
  return { group, privateSessions }
}

export function findMetricDefinitionsForSports(sportIds: number[]) {
  return prisma.assessmentMetricDefinition.findMany({
    where: { sportId: { in: sportIds }, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  })
}

export function findActivePlanItems(enrollmentId: number, itemIds: number[]) {
  return prisma.planPrivateEnrollment.findMany({
    where: { enrollmentId, status: 'ACTIVE' },
    select: {
      id: true,
      workoutPlan: {
        select: { items: { where: { id: { in: itemIds } }, select: { id: true } } },
      },
    },
  })
}

export function findSessionAssessment(memberId: number, classSessionId?: number, privateCourseAttendanceId?: number) {
  return prisma.progressAssessment.findFirst({
    where: {
      memberId,
      ...(classSessionId ? { classSessionId } : {}),
      ...(privateCourseAttendanceId ? { privateCourseAttendanceId } : {}),
    },
    select: { id: true },
  })
}

export function createAssessment(data: {
  memberId: number
  coachId: number
  classRegistrationId?: number
  privateEnrollmentId?: number
  classSessionId?: number
  privateCourseAttendanceId?: number
  assessmentDate: Date
  coachComment: string
  score?: number
  recommendation?: string
  nextAssessmentDate?: Date
}, metricValues: { definitionId: number; value: number }[], completedItems: { planAssignmentId: number; workoutPlanItemId: number }[] = []) {
  return prisma.$transaction(async (tx) => {
    const assessment = await tx.progressAssessment.create({
      data: { ...data, metricValues: { create: metricValues } },
      select: assessmentSelect,
    })
    if (data.privateCourseAttendanceId && completedItems.length > 0) {
      await tx.workoutPlanItemCompletion.createMany({
        data: completedItems.map((item) => ({
          ...item,
          privateCourseAttendanceId: data.privateCourseAttendanceId!,
          completedById: data.coachId,
        })),
        skipDuplicates: true,
      })
    }
    return assessment
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
