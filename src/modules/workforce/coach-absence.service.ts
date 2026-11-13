import { Prisma, type CoachAbsenceStatus } from '@prisma/client'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthUser } from '../../middleware/auth.js'
import coachService from '../coaches/coach.service.js'
import sessionService from '../class-sessions/session.service.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import { effectiveCoachId } from '../../lib/session-coach.js'
import { formatCenterTime } from './workforce.config.js'

const day = 86_400_000
const centerDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const entrySelect = {
  id: true, sessionId: true, coachId: true, reason: true, status: true, requestedAt: true,
  reviewedAt: true, reviewReason: true, makeupSessionId: true, makeupCreatedAt: true,
  coach: { select: { user: { select: { displayName: true } } } },
  session: { select: { id: true, startsAt: true, endsAt: true, status: true, roomId: true, classId: true,
    groupClass: { select: { name: true, endDate: true, coachId: true, sportId: true, capacity: true,
      registrations: { where: { status: 'CONFIRMED' as const }, select: { memberId: true } } } } } },
  makeupSession: { select: { id: true, startsAt: true, endsAt: true, roomId: true, coachId: true } },
} satisfies Prisma.CoachAbsenceRequestSelect

async function load(id: number, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const entry = await tx.coachAbsenceRequest.findUnique({ where: { id }, select: entrySelect })
  if (!entry) throw new HttpError(404, 'Không tìm thấy yêu cầu báo nghỉ.', 'ABSENCE_NOT_FOUND')
  return entry
}

export async function listAbsences(actor: AuthUser, status?: CoachAbsenceStatus) {
  const items = await prisma.coachAbsenceRequest.findMany({
    where: { ...(actor.role === 'COACH' ? { coachId: actor.id } : {}), ...(status ? { status } : {}) },
    select: entrySelect, orderBy: { requestedAt: 'desc' }, take: 200,
  })
  return { items }
}

export async function requestAbsence(actor: AuthUser, sessionId: number, reason: string) {
  const session = await prisma.classSession.findUnique({ where: { id: sessionId },
    select: { id: true, coachId: true, startsAt: true, status: true, groupClass: { select: { coachId: true, name: true } }, _count: { select: { attendances: true } } },
  })
  if (!session) throw new HttpError(404, 'Không tìm thấy buổi học.', 'SESSION_NOT_FOUND')
  if (effectiveCoachId(session) !== actor.id) throw new HttpError(403, 'Bạn không được phân công dạy buổi này.', 'NOT_ASSIGNED_COACH')
  if (session.status !== 'SCHEDULED' || session.startsAt <= new Date() || session._count.attendances > 0) {
    throw new HttpError(409, 'Chỉ báo nghỉ cho buổi chưa bắt đầu và chưa điểm danh.', 'SESSION_ALREADY_STARTED')
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.coachAbsenceRequest.create({ data: { sessionId, coachId: actor.id, reason }, select: entrySelect })
      const managers = await tx.user.findMany({ where: { status: 'ACTIVE', deletedAt: null, role: { name: 'CENTER_MANAGER' } }, select: { id: true } })
      await notify(tx, { userIds: managers.map((item) => item.id), type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Coach báo nghỉ buổi học', content: `Coach #${actor.id} báo nghỉ buổi ${session.groupClass.name} lúc ${formatCenterTime(session.startsAt)}. Chờ duyệt hủy và xếp bù.` })
      await audit(tx, { actorId: actor.id, action: 'COACH_ABSENCE_REQUESTED', entityType: 'COACH_ABSENCE', entityId: entry.id, newData: { sessionId, reason } })
      return entry
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, 'Buổi này đã có yêu cầu báo nghỉ.', 'ABSENCE_ALREADY_REQUESTED')
    throw error
  }
}

export async function reviewAbsence(actor: AuthUser, id: number, approve: boolean, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const entry = await load(id, tx)
    if (entry.status !== 'PENDING') throw new HttpError(409, 'Yêu cầu đã được xử lý.', 'ABSENCE_ALREADY_REVIEWED')
    const session = await tx.classSession.findUnique({ where: { id: entry.sessionId }, select: { status: true, startsAt: true, _count: { select: { attendances: true } } } })
    if (!session) throw new HttpError(404, 'Không tìm thấy buổi học.', 'SESSION_NOT_FOUND')
    if (approve && (session.status !== 'SCHEDULED' || session.startsAt <= new Date() || session._count.attendances > 0)) {
      throw new HttpError(409, 'Buổi đã bắt đầu, đã hủy hoặc đã điểm danh; Manager cần xử lý thủ công.', 'SESSION_ALREADY_STARTED')
    }
    const updated = await tx.coachAbsenceRequest.updateMany({ where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), reviewReason: reason ?? null } })
    if (updated.count !== 1) throw new HttpError(409, 'Yêu cầu đã được xử lý.', 'ABSENCE_ALREADY_REVIEWED')
    if (approve) {
      const cancelled = await tx.classSession.updateMany({ where: { id: entry.sessionId, status: 'SCHEDULED', startsAt: { gt: new Date() }, attendances: { none: {} } }, data: { status: 'CANCELLED', coachAbsent: true, coachChangeReason: entry.reason, coachChangedAt: new Date(), coachChangedById: actor.id } })
      if (cancelled.count !== 1) throw new HttpError(409, 'Buổi không còn đủ điều kiện hủy.', 'SESSION_ALREADY_STARTED')
    }
    await audit(tx, { actorId: actor.id, action: approve ? 'COACH_ABSENCE_APPROVED' : 'COACH_ABSENCE_REJECTED', entityType: 'COACH_ABSENCE', entityId: id,
      newData: { status: approve ? 'APPROVED' : 'REJECTED', reason: reason ?? null, sessionId: entry.sessionId } })
    await notify(tx, { userIds: approve ? [entry.coachId, ...entry.session.groupClass.registrations.map((item) => item.memberId)] : [entry.coachId],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE, title: approve ? 'Buổi học bị hủy do Coach nghỉ' : 'Yêu cầu báo nghỉ bị từ chối',
      content: approve ? `Buổi ${entry.session.groupClass.name} lúc ${formatCenterTime(entry.session.startsAt)} đã hủy. Trung tâm sẽ xếp lịch bù và thông báo sau.` : `Yêu cầu báo nghỉ buổi ${entry.session.groupClass.name} bị từ chối. ${reason ?? ''}` })
    return load(id, tx)
  })
}

export async function scheduleMakeup(actor: AuthUser, id: number, input: { coachId: number; roomId: number; startsAt: Date; endsAt: Date }) {
  const entry = await load(id)
  if (entry.status !== 'APPROVED' || entry.makeupSessionId) throw new HttpError(409, 'Yêu cầu chưa được duyệt hoặc đã có buổi bù.', 'MAKEUP_NOT_AVAILABLE')
  if (entry.session.status !== 'CANCELLED') throw new HttpError(409, 'Buổi gốc chưa được hủy.', 'SESSION_NOT_CANCELLED')
  if (input.startsAt >= input.endsAt || input.startsAt <= new Date()) throw new HttpError(400, 'Giờ buổi bù không hợp lệ.', 'INVALID_MAKEUP_TIME')
  const originalDay = centerDate(entry.session.startsAt)
  const makeupDay = centerDate(input.startsAt)
  const latestDay = centerDate(new Date(entry.session.startsAt.getTime() + 14 * day))
  if (makeupDay <= originalDay || input.startsAt.getTime() > entry.session.startsAt.getTime() + 14 * day || makeupDay > latestDay || makeupDay > centerDate(entry.session.groupClass.endDate)) {
    throw new HttpError(409, 'Buổi bù phải sau ngày hủy, trong 14 ngày và trước ngày kết thúc lớp.', 'MAKEUP_OUTSIDE_WINDOW')
  }
  if (input.endsAt.getTime() - input.startsAt.getTime() !== entry.session.endsAt.getTime() - entry.session.startsAt.getTime()) {
    throw new HttpError(409, 'Buổi bù phải có cùng thời lượng với buổi gốc.', 'MAKEUP_DURATION_MISMATCH')
  }
  if (centerDate(input.endsAt) !== makeupDay) throw new HttpError(409, 'Buổi bù phải kết thúc trong cùng ngày.', 'MAKEUP_OUTSIDE_WINDOW')
  const coach = await prisma.coach.findUnique({ where: { userId: input.coachId }, select: { status: true, user: { select: { status: true, deletedAt: true } }, coachSports: { where: { sportId: entry.session.groupClass.sportId }, select: { sportId: true } } } })
  if (!coach || coach.status !== 'ACTIVE' || coach.user.status !== 'ACTIVE' || coach.user.deletedAt || coach.coachSports.length === 0) throw new HttpError(409, 'Coach không hoạt động hoặc không đúng chuyên môn.', 'COACH_NOT_QUALIFIED')
  const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { status: true, capacity: true } })
  if (!room || room.status !== 'AVAILABLE' || room.capacity < entry.session.groupClass.capacity) throw new HttpError(409, 'Phòng không khả dụng hoặc thiếu sức chứa.', 'ROOM_UNAVAILABLE')
  if (!await coachService.isAvailableForSession(input.coachId, input.startsAt, input.endsAt)) throw new HttpError(409, 'Coach không có availability đã duyệt.', 'COACH_UNAVAILABLE')
  if (await sessionService.checkCoachConflict(input.coachId, input.startsAt, input.endsAt) || await sessionService.checkRoomConflict(input.roomId, input.startsAt, input.endsAt)) throw new HttpError(409, 'Coach hoặc phòng đã có lịch.', 'MAKEUP_CONFLICT')
  if (await sessionService.checkMakeupConflict(entry.session.classId, input.roomId, input.startsAt, input.endsAt)) {
    throw new HttpError(409, 'Phòng hoặc hội viên có lịch lớp nhóm/khóa 1–1 trùng.', 'MAKEUP_CONFLICT')
  }
  return prisma.$transaction(async (tx) => {
    const current = await load(id, tx)
    if (current.status !== 'APPROVED' || current.makeupSessionId) throw new HttpError(409, 'Buổi đã được xếp bù.', 'MAKEUP_ALREADY_SCHEDULED')
    const makeup = await tx.classSession.create({ data: { classId: current.session.classId, roomId: input.roomId, coachId: input.coachId, startsAt: input.startsAt, endsAt: input.endsAt, status: 'SCHEDULED', note: `Buổi bù cho buổi #${current.sessionId}` } })
    const result = await tx.coachAbsenceRequest.updateMany({ where: { id, makeupSessionId: null, status: 'APPROVED' }, data: { makeupSessionId: makeup.id, makeupCreatedAt: new Date() } })
    if (result.count !== 1) throw new HttpError(409, 'Buổi đã được xếp bù.', 'MAKEUP_ALREADY_SCHEDULED')
    await audit(tx, { actorId: actor.id, action: 'COACH_ABSENCE_MAKEUP_SCHEDULED', entityType: 'COACH_ABSENCE', entityId: id, newData: { makeupSessionId: makeup.id, startsAt: input.startsAt, roomId: input.roomId, coachId: input.coachId } })
    await notify(tx, { userIds: [current.coachId, input.coachId, ...current.session.groupClass.registrations.map((item) => item.memberId)], type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Đã xếp buổi học bù', content: `Lớp ${current.session.groupClass.name} học bù lúc ${formatCenterTime(input.startsAt)}.` })
    return load(id, tx)
  })
}
