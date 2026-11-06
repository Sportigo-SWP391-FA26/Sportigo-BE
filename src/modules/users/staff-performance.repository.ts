import type { PaymentStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

type Range = { start: Date; endExclusive: Date }
type DateColumnRange = { gte: Date; lte: Date }

// note: tiền đã thu tại quầy vẫn tính là "đã thu" kể cả khi sau đó hoàn tiền (hoàn tiền là nghiệp vụ khác, vào ví)
const COLLECTED: PaymentStatus[] = ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED']

// FR-65: danh sách Coach và Lễ tân còn tồn tại (bỏ tài khoản đã xóa mềm)
export function findStaffForPerformance() {
  return prisma.user.findMany({
    where: { deletedAt: null, role: { name: { in: ['COACH', 'RECEPTIONIST'] } } },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      displayName: true,
      email: true,
      avatarUrl: true,
      status: true,
      role: { select: { name: true } },
      coach: { select: { coachCode: true, status: true } },
      receptionist: { select: { staffCode: true } },
    },
  })
}

// ---------- Coach ----------

// note: buổi lớp nhóm "đã diễn ra" = không bị hủy và đã kết thúc trong khoảng xem (hệ thống không chuyển buổi sang COMPLETED)
export function findHeldClassSessions(coachIds: number[], range: Range, now: Date) {
  const end = range.endExclusive < now ? range.endExclusive : now
  return prisma.classSession.findMany({
    where: {
      status: { not: 'CANCELLED' },
      endsAt: { gte: range.start, lt: end },
      groupClass: { coachId: { in: coachIds } },
    },
    // note: lấy kèm trạng thái điểm danh để vừa đếm buổi đã điểm danh vừa tính tỷ lệ có mặt trong cùng 1 truy vấn
    select: { groupClass: { select: { coachId: true } }, attendances: { select: { status: true } } },
  })
}

// note: mỗi bản ghi điểm danh khóa 1-1 = 1 buổi Coach đã dạy xong
export function countPrivateSessionsByCoach(coachIds: number[], range: Range) {
  return prisma.privateCourseAttendance.groupBy({
    by: ['markedById'],
    where: { markedById: { in: coachIds }, startsAt: { gte: range.start, lt: range.endExclusive } },
    _count: { _all: true },
  })
}

export function countAssessmentsByCoach(coachIds: number[], dates: DateColumnRange) {
  return prisma.progressAssessment.groupBy({
    by: ['coachId'],
    where: { coachId: { in: coachIds }, assessmentDate: dates },
    _count: { _all: true },
  })
}

// note: học viên đang phụ trách tính ở thời điểm hiện tại (không theo khoảng xem), cùng điều kiện phân công với FR-10/FR-11
export function findCurrentTrainees(coachIds: number[]) {
  return Promise.all([
    prisma.classRegistration.findMany({
      where: { status: 'CONFIRMED', groupClass: { coachId: { in: coachIds }, status: { notIn: ['CANCELLED', 'COMPLETED'] } } },
      select: { memberId: true, groupClass: { select: { coachId: true } } },
    }),
    prisma.privateCourseEnrollment.findMany({
      where: { status: 'ACTIVE', coachId: { in: coachIds } },
      select: { memberId: true, coachId: true },
    }),
  ])
}

// ---------- Lễ tân ----------

// note: yêu cầu hỗ trợ đã giải quyết trong khoảng xem, kèm người đang/đã phụ trách cuối cùng (FR-56)
export function findResolvedSupportRequests(receptionistIds: number[], range: Range) {
  return prisma.supportRequest.findMany({
    where: {
      resolvedAt: { gte: range.start, lt: range.endExclusive },
      assignments: { some: { assignedToId: { in: receptionistIds }, status: { in: ['ACTIVE', 'COMPLETED'] } } },
    },
    select: {
      createdAt: true,
      resolvedAt: true,
      assignments: {
        where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        select: { assignedToId: true },
      },
    },
  })
}

// note: số yêu cầu đang giữ chưa xử lý xong (tại thời điểm hiện tại)
export function countOpenSupportByReceptionist(receptionistIds: number[]) {
  return prisma.requestAssignment.groupBy({
    by: ['assignedToId'],
    where: { assignedToId: { in: receptionistIds }, status: 'ACTIVE', request: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } },
    _count: { _all: true },
  })
}

export function sumCashCollectedByReceptionist(receptionistIds: number[], range: Range) {
  return prisma.payment.groupBy({
    by: ['collectedById'],
    where: { collectedById: { in: receptionistIds }, status: { in: COLLECTED }, paidAt: { gte: range.start, lt: range.endExclusive } },
    _sum: { amount: true },
    _count: { _all: true },
  })
}

// note: hội viên tạo tại quầy được ghi Audit Log MEMBER_CREATED (FR-08)
export function countMembersCreatedByReceptionist(receptionistIds: number[], range: Range) {
  return prisma.auditLog.groupBy({
    by: ['actorId'],
    where: { action: 'MEMBER_CREATED', actorId: { in: receptionistIds }, createdAt: { gte: range.start, lt: range.endExclusive } },
    _count: { _all: true },
  })
}
