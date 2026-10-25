import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

const coachName = { select: { user: { select: { id: true, displayName: true } } } } as const

// note: điều kiện "Member được phân công cho Coach" dùng chung cho FR-10 và FR-11
export const assignedRegistration = (coachId: number): Prisma.ClassRegistrationWhereInput => ({
  status: 'CONFIRMED',
  groupClass: { coachId },
})
export const assignedEnrollment = (coachId: number): Prisma.PrivateCourseEnrollmentWhereInput => ({
  coachId,
  status: { in: ['ACTIVE', 'COMPLETED'] },
})

export async function isMemberAssignedToCoach(memberId: number, coachId: number) {
  const [registrations, enrollments] = await prisma.$transaction([
    prisma.classRegistration.count({ where: { memberId, ...assignedRegistration(coachId) } }),
    prisma.privateCourseEnrollment.count({ where: { memberId, ...assignedEnrollment(coachId) } }),
  ])
  return registrations + enrollments > 0
}

// note: coachId có giá trị → chỉ lấy lớp/khóa/đánh giá của Coach đó (Coach không thấy phần của Coach khác)
export function findMemberProfile(memberId: number, coachId?: number) {
  const byCoach = coachId !== undefined
  return prisma.user.findFirst({
    where: { id: memberId, role: { name: 'MEMBER' } },
    select: {
      id: true,
      email: true,
      phone: true,
      displayName: true,
      status: true,
      emailVerifiedAt: true,
      member: {
        select: {
          memberCode: true,
          dateOfBirth: true,
          gender: true,
          emergencyContact: true,
          joinedAt: true,
          registrations: {
            where: byCoach ? { groupClass: { coachId } } : {},
            orderBy: { registeredAt: 'desc' },
            select: {
              id: true,
              status: true,
              registeredAt: true,
              groupClass: {
                select: { id: true, name: true, startDate: true, endDate: true, status: true, sport: { select: { name: true } }, coach: coachName },
              },
              attendances: { select: { status: true } },
            },
          },
          privateEnrollments: {
            where: byCoach ? { coachId } : {},
            orderBy: { enrolledAt: 'desc' },
            select: {
              id: true,
              status: true,
              purchasedSessions: true,
              remainingSessions: true,
              startDate: true,
              expiryDate: true,
              privateCourse: { select: { id: true, name: true, sport: { select: { name: true } } } },
              coach: coachName,
            },
          },
          assessments: {
            where: byCoach ? { coachId } : {},
            orderBy: [{ assessmentDate: 'desc' }, { id: 'desc' }],
            take: 5,
            select: { id: true, assessmentDate: true, score: true, coachComment: true, recommendation: true, nextAssessmentDate: true, coach: coachName },
          },
        },
      },
    },
  })
}

export type MemberProfileRow = NonNullable<Awaited<ReturnType<typeof findMemberProfile>>>

// note: chỉ nhân viên thu ngân/quản lý mới gọi; bỏ giỏ hàng CART vì chưa phải giao dịch
export function findRecentOrders(memberId: number) {
  return prisma.serviceOrder.findMany({
    where: { memberId, status: { not: 'CART' } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, orderNumber: true, status: true, finalAmount: true, paidAt: true, createdAt: true },
  })
}
