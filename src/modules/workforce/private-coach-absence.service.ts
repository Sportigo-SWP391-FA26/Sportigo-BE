import { Prisma, type CoachAbsenceStatus } from '@prisma/client'
import { centerDateTime, wallClock } from '../../lib/center-time.js'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthUser } from '../../middleware/auth.js'
import coachService from '../coaches/coach.service.js'
import sessionService from '../class-sessions/session.service.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import { formatCenterTime } from './workforce.config.js'

const dayMs = 86_400_000
const dateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Ngày buổi học phải là YYYY-MM-DD.', 'INVALID_SESSION_DATE')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Ngày buổi học không hợp lệ.', 'INVALID_SESSION_DATE')
  return date
}
const centerDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
const atTime = (date: Date, time: Date) => centerDateTime(date, wallClock(time))
const select = {
  id: true, scheduleId: true, sessionDate: true, coachId: true, reason: true, status: true,
  requestedAt: true, originalStartsAt: true, originalEndsAt: true, reviewedAt: true, reviewReason: true, makeupStartsAt: true,
  makeupEndsAt: true, makeupRoomId: true, makeupCoachId: true, makeupCreatedAt: true,
  coach: { select: { user: { select: { displayName: true } } } },
  schedule: { select: { roomId: true, startTime: true, endTime: true, dayOfWeek: true, effectiveFrom: true, effectiveTo: true,
    enrollment: { select: { id: true, memberId: true, coachId: true, status: true, startDate: true, expiryDate: true,
      privateCourse: { select: { name: true, sportId: true, sessionDurationMinutes: true } } } } } },
} satisfies Prisma.PrivateCoachAbsenceRequestSelect

async function load(id: number, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const item = await db.privateCoachAbsenceRequest.findUnique({ where: { id }, select })
  if (!item) throw new HttpError(404, 'Không tìm thấy yêu cầu báo nghỉ 1–1.', 'PRIVATE_ABSENCE_NOT_FOUND')
  return item
}

async function occurrence(scheduleId: number, sessionDate: Date, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const schedule = await db.privateCourseSchedule.findUnique({ where: { id: scheduleId },
    include: { enrollment: { include: { privateCourse: true } },
      exceptions: { where: { sessionDate } }, attendances: { where: { sessionDate }, select: { id: true } } } })
  if (!schedule) throw new HttpError(404, 'Không tìm thấy lịch khóa 1–1.', 'SCHEDULE_NOT_FOUND')
  if (schedule.status !== 'ACTIVE' || schedule.enrollment.status !== 'ACTIVE' ||
      schedule.dayOfWeek !== sessionDate.getUTCDay() || sessionDate < schedule.effectiveFrom || sessionDate > schedule.effectiveTo ||
      sessionDate < schedule.enrollment.startDate || sessionDate > schedule.enrollment.expiryDate) {
    throw new HttpError(409, 'Buổi không thuộc khóa 1–1 đang hoạt động.', 'PRIVATE_OCCURRENCE_INACTIVE')
  }
  const exception = schedule.exceptions[0]
  const startsAt = exception?.action === 'RESCHEDULED' && exception.rescheduledStartsAt
    ? exception.rescheduledStartsAt : atTime(sessionDate, schedule.startTime)
  const endsAt = exception?.action === 'RESCHEDULED' && exception.rescheduledEndsAt
    ? exception.rescheduledEndsAt : atTime(sessionDate, schedule.endTime)
  const assignedCoachId = exception?.newCoachId ?? schedule.enrollment.coachId
  return { schedule, exception, startsAt, endsAt, assignedCoachId }
}

export async function listPrivateAbsences(actor: AuthUser, status?: CoachAbsenceStatus) {
  const items = await prisma.privateCoachAbsenceRequest.findMany({
    where: { ...(actor.role === 'COACH' ? { coachId: actor.id } : {}), ...(status ? { status } : {}) },
    select, orderBy: { requestedAt: 'desc' }, take: 200,
  })
  return { items }
}

export async function listPrivateAbsenceSessions(actor: AuthUser) {
  const from = new Date(); const to = new Date(from.getTime() + 45 * dayMs)
  const schedules = await prisma.privateCourseSchedule.findMany({ where: { status: 'ACTIVE', enrollment: { status: 'ACTIVE' },
    OR: [{ enrollment: { coachId: actor.id }, effectiveFrom: { lte: to }, effectiveTo: { gte: from } },
      { exceptions: { some: { newCoachId: actor.id, action: 'RESCHEDULED', rescheduledStartsAt: { gte: from, lte: to } } } }] },
    include: { enrollment: { select: { memberId: true, coachId: true, privateCourse: { select: { name: true } } } },
      exceptions: { where: { OR: [{ sessionDate: { gte: from, lte: to } }, { rescheduledStartsAt: { gte: from, lte: to } }] } },
      attendances: { where: { sessionDate: { gte: from, lte: to } }, select: { sessionDate: true } } } })
  const items: Array<{ scheduleId: number; sessionDate: string; startsAt: Date; name: string; memberId: number }> = []
  for (const schedule of schedules) {
    const start = new Date(Math.max(from.getTime(), schedule.effectiveFrom.getTime()))
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() + (schedule.dayOfWeek - start.getUTCDay() + 7) % 7)
    for (const date = start; date <= to && date <= schedule.effectiveTo; date.setUTCDate(date.getUTCDate() + 7)) {
      const sessionDate = date.toISOString().slice(0, 10)
      if (schedule.attendances.some((item) => item.sessionDate.getTime() === date.getTime())) continue
      const exception = schedule.exceptions.find((item) => item.sessionDate.getTime() === date.getTime())
      if (exception?.action === 'CANCELLED' || (exception?.newCoachId ?? schedule.enrollment.coachId) !== actor.id) continue
      const startsAt = exception?.action === 'RESCHEDULED' && exception.rescheduledStartsAt ? exception.rescheduledStartsAt : atTime(date, schedule.startTime)
      if (startsAt <= from) continue
      items.push({ scheduleId: schedule.id, sessionDate, startsAt, name: schedule.enrollment.privateCourse.name, memberId: schedule.enrollment.memberId })
    }
    for (const exception of schedule.exceptions) {
      if (exception.action !== 'RESCHEDULED' || exception.newCoachId !== actor.id || !exception.rescheduledStartsAt ||
          exception.rescheduledStartsAt <= from || exception.rescheduledStartsAt > to ||
          schedule.attendances.some((item) => item.sessionDate.getTime() === exception.sessionDate.getTime())) continue
      const sessionDate = exception.sessionDate.toISOString().slice(0, 10)
      if (items.some((item) => item.scheduleId === schedule.id && item.sessionDate === sessionDate)) continue
      items.push({ scheduleId: schedule.id, sessionDate, startsAt: exception.rescheduledStartsAt,
        name: schedule.enrollment.privateCourse.name, memberId: schedule.enrollment.memberId })
    }
  }
  return { items: items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()) }
}

export async function requestPrivateAbsence(actor: AuthUser, scheduleId: number, sessionDateInput: string, reason: string) {
  const sessionDate = dateOnly(sessionDateInput)
  const current = await occurrence(scheduleId, sessionDate)
  if (current.assignedCoachId !== actor.id) throw new HttpError(403, 'Bạn không được phân công dạy buổi này.', 'NOT_ASSIGNED_COACH')
  if (current.startsAt <= new Date() || current.exception?.action === 'CANCELLED' || current.schedule.attendances.length) {
    throw new HttpError(409, 'Chỉ báo nghỉ buổi chưa bắt đầu và chưa điểm danh.', 'SESSION_ALREADY_STARTED')
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.privateCoachAbsenceRequest.create({ data: { scheduleId, sessionDate, coachId: actor.id, reason,
        originalStartsAt: current.startsAt, originalEndsAt: current.endsAt }, select })
      const managers = await tx.user.findMany({ where: { status: 'ACTIVE', deletedAt: null, role: { name: 'CENTER_MANAGER' } }, select: { id: true } })
      await notify(tx, { userIds: managers.map((item) => item.id), type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Coach báo nghỉ buổi 1–1', content: `${current.schedule.enrollment.privateCourse.name} lúc ${formatCenterTime(current.startsAt)} cần Manager duyệt và xếp bù.` })
      await audit(tx, { actorId: actor.id, action: 'PRIVATE_COACH_ABSENCE_REQUESTED', entityType: 'PRIVATE_COACH_ABSENCE', entityId: entry.id,
        newData: { scheduleId, sessionDate: sessionDateInput, reason } })
      return entry
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, 'Buổi này đã có yêu cầu báo nghỉ.', 'ABSENCE_ALREADY_REQUESTED')
    throw error
  }
}

export async function reviewPrivateAbsence(actor: AuthUser, id: number, approve: boolean, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const entry = await load(id, tx)
    if (entry.status !== 'PENDING') throw new HttpError(409, 'Yêu cầu đã được xử lý.', 'ABSENCE_ALREADY_REVIEWED')
    const current = await occurrence(entry.scheduleId, entry.sessionDate, tx)
    if (approve && (current.startsAt <= new Date() || current.schedule.attendances.length || current.exception?.action === 'CANCELLED' || current.assignedCoachId !== entry.coachId || current.startsAt.getTime() !== entry.originalStartsAt.getTime())) {
      throw new HttpError(409, 'Buổi đã bắt đầu, đã hủy hoặc đã điểm danh; cần xử lý thủ công.', 'SESSION_ALREADY_STARTED')
    }
    const updated = await tx.privateCoachAbsenceRequest.updateMany({ where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), reviewReason: reason ?? null } })
    if (updated.count !== 1) throw new HttpError(409, 'Yêu cầu đã được xử lý.', 'ABSENCE_ALREADY_REVIEWED')
    if (approve) {
      await tx.privateCourseScheduleException.upsert({ where: { scheduleId_sessionDate: { scheduleId: entry.scheduleId, sessionDate: entry.sessionDate } },
        create: { scheduleId: entry.scheduleId, sessionDate: entry.sessionDate, action: 'CANCELLED', reason: entry.reason },
        update: { action: 'CANCELLED', rescheduledStartsAt: null, rescheduledEndsAt: null, newRoomId: null, newCoachId: null, reason: entry.reason } })
    }
    await audit(tx, { actorId: actor.id, action: approve ? 'PRIVATE_COACH_ABSENCE_APPROVED' : 'PRIVATE_COACH_ABSENCE_REJECTED',
      entityType: 'PRIVATE_COACH_ABSENCE', entityId: id, newData: { approve, reason: reason ?? null } })
    await notify(tx, { userIds: approve ? [entry.coachId, entry.schedule.enrollment.memberId] : [entry.coachId],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE, title: approve ? 'Buổi 1–1 bị hủy do Coach nghỉ' : 'Yêu cầu báo nghỉ 1–1 bị từ chối',
      content: approve ? `Buổi ${entry.schedule.enrollment.privateCourse.name} ngày ${entry.sessionDate.toISOString().slice(0, 10)} đã hủy. Trung tâm sẽ xếp bù.` : `Yêu cầu báo nghỉ bị từ chối. ${reason ?? ''}` })
    return load(id, tx)
  })
}

export async function schedulePrivateMakeup(actor: AuthUser, id: number, input: { coachId: number; roomId: number; startsAt: Date; endsAt: Date }) {
  const entry = await load(id)
  if (entry.status !== 'APPROVED' || entry.makeupCreatedAt) throw new HttpError(409, 'Buổi chưa được duyệt hoặc đã xếp bù.', 'MAKEUP_NOT_AVAILABLE')
  const exception = await prisma.privateCourseScheduleException.findUnique({ where: { scheduleId_sessionDate: { scheduleId: entry.scheduleId, sessionDate: entry.sessionDate } } })
  if (exception?.action !== 'CANCELLED') throw new HttpError(409, 'Buổi gốc chưa được hủy.', 'SESSION_NOT_CANCELLED')
  const originalStart = entry.originalStartsAt
  const originalEnd = entry.originalEndsAt
  if (input.startsAt <= new Date() || input.startsAt >= input.endsAt ||
      input.endsAt.getTime() - input.startsAt.getTime() !== originalEnd.getTime() - originalStart.getTime()) {
    throw new HttpError(409, 'Buổi bù phải ở tương lai và giữ nguyên thời lượng.', 'INVALID_MAKEUP_TIME')
  }
  if (centerDate(input.startsAt) <= centerDate(originalStart) || input.startsAt.getTime() > originalStart.getTime() + 14 * dayMs ||
      centerDate(input.endsAt) !== centerDate(input.startsAt) || centerDate(input.startsAt) > entry.schedule.enrollment.expiryDate.toISOString().slice(0, 10)) {
    throw new HttpError(409, 'Buổi bù phải trong 14 ngày và trước khi khóa hết hạn.', 'MAKEUP_OUTSIDE_WINDOW')
  }
  const coach = await prisma.coach.findUnique({ where: { userId: input.coachId }, select: { status: true,
    user: { select: { status: true, deletedAt: true } }, coachSports: { where: { sportId: entry.schedule.enrollment.privateCourse.sportId } } } })
  if (!coach || coach.status !== 'ACTIVE' || coach.user.status !== 'ACTIVE' || coach.user.deletedAt || !coach.coachSports.length) {
    throw new HttpError(409, 'Coach không hoạt động hoặc sai chuyên môn.', 'COACH_NOT_QUALIFIED')
  }
  const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { status: true, capacity: true } })
  if (!room || room.status !== 'AVAILABLE' || room.capacity < 1) throw new HttpError(409, 'Phòng không khả dụng.', 'ROOM_UNAVAILABLE')
  if (!await coachService.isAvailableForSession(input.coachId, input.startsAt, input.endsAt)) throw new HttpError(409, 'Coach không có availability đã duyệt.', 'COACH_UNAVAILABLE')
  if (await sessionService.checkPrivateMakeupConflict(input.coachId, entry.schedule.enrollment.memberId, input.roomId, input.startsAt, input.endsAt)) {
    throw new HttpError(409, 'Coach, phòng hoặc Member bị trùng lịch.', 'MAKEUP_CONFLICT')
  }
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.privateCoachAbsenceRequest.updateMany({ where: { id, status: 'APPROVED', makeupCreatedAt: null },
      data: { makeupStartsAt: input.startsAt, makeupEndsAt: input.endsAt, makeupRoomId: input.roomId, makeupCoachId: input.coachId, makeupCreatedAt: new Date() } })
    if (claimed.count !== 1) throw new HttpError(409, 'Buổi đã được xếp bù.', 'MAKEUP_ALREADY_SCHEDULED')
    const changed = await tx.privateCourseScheduleException.updateMany({ where: { scheduleId: entry.scheduleId, sessionDate: entry.sessionDate, action: 'CANCELLED' },
      data: { action: 'RESCHEDULED', rescheduledStartsAt: input.startsAt, rescheduledEndsAt: input.endsAt,
        newRoomId: input.roomId, newCoachId: input.coachId, reason: `Học bù sau khi Coach báo nghỉ: ${entry.reason}` } })
    if (changed.count !== 1) throw new HttpError(409, 'Buổi không còn chờ xếp bù.', 'MAKEUP_NOT_AVAILABLE')
    await audit(tx, { actorId: actor.id, action: 'PRIVATE_COACH_ABSENCE_MAKEUP_SCHEDULED', entityType: 'PRIVATE_COACH_ABSENCE', entityId: id,
      newData: { startsAt: input.startsAt, endsAt: input.endsAt, coachId: input.coachId, roomId: input.roomId } })
    await notify(tx, { userIds: [...new Set([entry.coachId, input.coachId, entry.schedule.enrollment.memberId])],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE, title: 'Đã xếp buổi học bù 1–1',
      content: `${entry.schedule.enrollment.privateCourse.name} học bù lúc ${formatCenterTime(input.startsAt)}.` })
    return load(id, tx)
  })
}
