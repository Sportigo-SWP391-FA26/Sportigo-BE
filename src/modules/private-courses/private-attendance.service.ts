import { EnrollmentStatus, type Prisma } from '@prisma/client'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'

// Hội viên có 48 giờ để xác nhận hoặc khiếu nại buổi Coach đã ghi nhận
export const CONFIRMATION_WINDOW_MS = 48 * 60 * 60 * 1000

const attendanceInclude = {
  schedule: {
    select: {
      enrollmentId: true,
      enrollment: {
        select: {
          memberId: true,
          coachId: true,
          privateCourse: { select: { name: true } },
          member: { select: { memberCode: true, user: { select: { displayName: true } } } },
        },
      },
    },
  },
  markedBy: { select: { user: { select: { displayName: true } } } },
} satisfies Prisma.PrivateCourseAttendanceInclude

const notFound = () => new HttpError(404, 'Không tìm thấy buổi học cần xác nhận.', 'ATTENDANCE_NOT_FOUND')

/** Trừ một buổi của khóa học; hết buổi thì hoàn tất khóa. Gọi đúng một lần cho mỗi buổi được xác nhận. */
async function consumeSession(tx: Prisma.TransactionClient, enrollmentId: number) {
  const consumed = await tx.privateCourseEnrollment.updateMany({
    where: { id: enrollmentId, remainingSessions: { gt: 0 } },
    data: { remainingSessions: { decrement: 1 } },
  })
  if (consumed.count !== 1) throw new HttpError(409, 'Khóa học không còn buổi học hợp lệ.', 'NO_SESSIONS_REMAINING')
  const enrollment = await tx.privateCourseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, select: { remainingSessions: true } })
  if (enrollment.remainingSessions === 0) {
    await tx.privateCourseEnrollment.updateMany({ where: { id: enrollmentId, status: EnrollmentStatus.ACTIVE }, data: { status: EnrollmentStatus.COMPLETED } })
  }
  return enrollment.remainingSessions
}

/** Chuyển trạng thái có điều kiện để hai thao tác đồng thời không cùng trừ buổi. */
async function transition(
  tx: Prisma.TransactionClient,
  id: number,
  from: Prisma.EnumPrivateAttendanceStatusFilter['equals'],
  data: Prisma.PrivateCourseAttendanceUncheckedUpdateManyInput,
) {
  const changed = await tx.privateCourseAttendance.updateMany({ where: { id, status: from }, data })
  if (changed.count !== 1) throw new HttpError(409, 'Buổi học đã được xử lý trước đó.', 'ATTENDANCE_ALREADY_PROCESSED')
}

export async function listPendingForMember(memberId: number) {
  const rows = await prisma.privateCourseAttendance.findMany({
    where: { status: 'PENDING_CONFIRMATION', schedule: { enrollment: { memberId } } },
    include: attendanceInclude,
    orderBy: { startsAt: 'desc' },
  })
  return rows.map((row) => ({
    id: row.id,
    sessionDate: row.sessionDate.toISOString().slice(0, 10),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    courseName: row.schedule.enrollment.privateCourse.name,
    coachName: row.markedBy.user.displayName,
    autoConfirmAt: new Date(row.completedAt.getTime() + CONFIRMATION_WINDOW_MS),
  }))
}

export async function confirmByMember(memberId: number, id: number) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.privateCourseAttendance.findUnique({ where: { id }, include: attendanceInclude })
    if (!row || row.schedule.enrollment.memberId !== memberId) throw notFound()
    await transition(tx, id, 'PENDING_CONFIRMATION', { status: 'CONFIRMED', confirmedAt: new Date() })
    const remainingSessions = await consumeSession(tx, row.schedule.enrollmentId)
    await audit(tx, { actorId: memberId, action: 'PRIVATE_SESSION_CONFIRMED', entityType: 'PrivateCourseAttendance', entityId: id, newData: { remainingSessions } })
    return { id, status: 'CONFIRMED' as const, remainingSessions }
  })
}

export async function disputeByMember(memberId: number, id: number, reason: string) {
  const managers = await prisma.user.findMany({ where: { role: { name: 'CENTER_MANAGER' }, status: 'ACTIVE', deletedAt: null }, select: { id: true } })
  return prisma.$transaction(async (tx) => {
    const row = await tx.privateCourseAttendance.findUnique({ where: { id }, include: attendanceInclude })
    if (!row || row.schedule.enrollment.memberId !== memberId) throw notFound()
    await transition(tx, id, 'PENDING_CONFIRMATION', { status: 'DISPUTED', disputeReason: reason })
    await audit(tx, { actorId: memberId, action: 'PRIVATE_SESSION_DISPUTED', entityType: 'PrivateCourseAttendance', entityId: id, newData: { reason } })
    await notify(tx, {
      userIds: [row.schedule.enrollment.coachId, ...managers.map((manager) => manager.id)],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Hội viên khiếu nại buổi học 1-1',
      content: `${row.schedule.enrollment.member.user.displayName} không xác nhận buổi ${row.sessionDate.toISOString().slice(0, 10)} của khóa "${row.schedule.enrollment.privateCourse.name}". Lý do: ${reason}`,
    })
    return { id, status: 'DISPUTED' as const }
  })
}

export async function listDisputes() {
  const rows = await prisma.privateCourseAttendance.findMany({
    where: { status: 'DISPUTED' },
    include: attendanceInclude,
    orderBy: { completedAt: 'asc' },
  })
  return rows.map((row) => ({
    id: row.id,
    sessionDate: row.sessionDate.toISOString().slice(0, 10),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    courseName: row.schedule.enrollment.privateCourse.name,
    coachName: row.markedBy.user.displayName,
    memberName: row.schedule.enrollment.member.user.displayName,
    memberCode: row.schedule.enrollment.member.memberCode,
    disputeReason: row.disputeReason,
    recordedAt: row.completedAt,
  }))
}

export async function resolveDispute(managerId: number, id: number, decision: 'CONFIRM' | 'REJECT', note: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.privateCourseAttendance.findUnique({ where: { id }, include: attendanceInclude })
    if (!row) throw notFound()
    const now = new Date()
    await transition(tx, id, 'DISPUTED', {
      status: decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
      confirmedAt: decision === 'CONFIRM' ? now : undefined,
      resolvedById: managerId,
      resolvedAt: now,
      resolutionNote: note,
    })
    const remainingSessions = decision === 'CONFIRM' ? await consumeSession(tx, row.schedule.enrollmentId) : undefined
    await audit(tx, { actorId: managerId, action: decision === 'CONFIRM' ? 'PRIVATE_DISPUTE_CONFIRMED' : 'PRIVATE_DISPUTE_REJECTED', entityType: 'PrivateCourseAttendance', entityId: id, newData: { note, remainingSessions } })
    await notify(tx, {
      userIds: [row.schedule.enrollment.memberId, row.schedule.enrollment.coachId],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: decision === 'CONFIRM' ? 'Buổi học 1-1 được xác nhận đã diễn ra' : 'Buổi học 1-1 không được tính',
      content: `Buổi ${row.sessionDate.toISOString().slice(0, 10)} của khóa "${row.schedule.enrollment.privateCourse.name}": ${note}`,
    })
    return { id, status: decision === 'CONFIRM' ? 'CONFIRMED' as const : 'REJECTED' as const, remainingSessions }
  })
}

/** Worker: buổi chờ quá 48 giờ không được phản hồi thì tự xác nhận và trừ buổi. */
export async function autoConfirmOverdue(now = new Date()) {
  const due = await prisma.privateCourseAttendance.findMany({
    where: { status: 'PENDING_CONFIRMATION', completedAt: { lte: new Date(now.getTime() - CONFIRMATION_WINDOW_MS) } },
    select: { id: true, schedule: { select: { enrollmentId: true } } },
    take: 200,
  })
  let confirmed = 0
  for (const row of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await transition(tx, row.id, 'PENDING_CONFIRMATION', { status: 'CONFIRMED', confirmedAt: now })
        await consumeSession(tx, row.schedule.enrollmentId)
        await audit(tx, { action: 'PRIVATE_SESSION_AUTO_CONFIRMED', entityType: 'PrivateCourseAttendance', entityId: row.id })
      })
      confirmed += 1
    } catch (error) {
      console.error(`Failed to auto-confirm private attendance ${row.id}:`, error)
    }
  }
  return { confirmed }
}
