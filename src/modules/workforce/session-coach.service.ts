import type { Prisma } from '@prisma/client'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import { taughtByCoachWhere } from '../../lib/session-coach.js'
import type { AuthUser } from '../../middleware/auth.js'
import sessionService from '../class-sessions/session.service.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import type { ListSessionCoachesQuery, SubstituteInput } from './session-coach.schema.js'
import { WORKFORCE_RULES, centerDayRange, formatCenterTime, ms } from './workforce.config.js'

// FR-66: Manager ghi nhận coach dạy thực tế của từng buổi lớp nhóm (dạy thay, coach vắng).

const coachName = { select: { userId: true, coachCode: true, user: { select: { displayName: true } } } } as const

// note: dữ liệu cần để hiển thị và kiểm tra một buổi
const sessionSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  coachId: true,
  replacedCoachId: true,
  coachAbsent: true,
  coachChangeReason: true,
  coachChangedAt: true,
  room: { select: { code: true, name: true } },
  coach: coachName,
  replacedCoach: coachName,
  coachChangedBy: { select: { id: true, displayName: true } },
  groupClass: {
    select: { id: true, name: true, sportId: true, coachId: true, sport: { select: { id: true, name: true } }, coach: coachName },
  },
  _count: { select: { attendances: true } },
} satisfies Prisma.ClassSessionSelect

type SessionRow = Prisma.ClassSessionGetPayload<{ select: typeof sessionSelect }>
type CoachRef = { userId: number; coachCode: string; user: { displayName: string } } | null

const toCoach = (coach: CoachRef) => (coach ? { id: coach.userId, code: coach.coachCode, displayName: coach.user.displayName } : null)

// note: coach chính của buổi = người bị thay (nếu đang dạy thay), không thì coach đã chốt, không nữa thì coach lớp
function mainCoachId(session: SessionRow) {
  return session.replacedCoachId ?? session.coachId ?? session.groupClass.coachId
}

// note: lý do không cho đổi coach của buổi; null = được đổi
function lockReason(session: SessionRow, now = new Date()) {
  if (session.status === 'CANCELLED') return 'Buổi học đã bị hủy.'
  if (session._count.attendances > 0) return 'Buổi học đã được điểm danh.'
  if (now.getTime() > session.endsAt.getTime() + WORKFORCE_RULES.coachChangeGraceHours * ms.hour) {
    return `Đã quá ${WORKFORCE_RULES.coachChangeGraceHours} giờ sau khi buổi học kết thúc.`
  }
  return null
}

function toView(session: SessionRow, now = new Date()) {
  const lock = lockReason(session, now)
  return {
    id: session.id,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    status: session.status,
    room: session.room,
    class: { id: session.groupClass.id, name: session.groupClass.name, sport: session.groupClass.sport },
    classCoach: toCoach(session.groupClass.coach),
    // note: coach dạy thực tế = coach ghi trên buổi, không có thì coach lớp
    actualCoach: toCoach(session.coach ?? session.groupClass.coach),
    replacedCoach: toCoach(session.replacedCoach),
    coachAbsent: session.coachAbsent,
    reason: session.coachChangeReason,
    changedAt: session.coachChangedAt,
    changedBy: session.coachChangedBy,
    attendanceCount: session._count.attendances,
    canChange: lock === null,
    lockReason: lock,
  }
}

async function loadSession(sessionId: number, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const session = await db.classSession.findUnique({ where: { id: sessionId }, select: sessionSelect })
  if (!session) throw new HttpError(404, 'Không tìm thấy buổi học.', 'SESSION_NOT_FOUND')
  return session
}

function assertChangeable(session: SessionRow) {
  const lock = lockReason(session)
  if (lock) throw new HttpError(409, `Không thể đổi coach của buổi này: ${lock}`, 'SESSION_COACH_LOCKED')
}

export async function listSessionCoaches(query: ListSessionCoachesQuery) {
  const { start, endExclusive } = centerDayRange(query.from, query.to)
  const where: Prisma.ClassSessionWhereInput = {
    startsAt: { gte: start, lt: endExclusive },
    groupClass: { status: { notIn: ['DRAFT'] } },
    // note: lọc theo coach dạy thực tế
    ...(query.coachId ? taughtByCoachWhere(query.coachId) : {}),
    // note: chỉ những buổi có dạy thay hoặc coach vắng
    ...(query.changedOnly ? { AND: [{ OR: [{ replacedCoachId: { not: null } }, { coachAbsent: true }] }] } : {}),
  }
  const rows = await prisma.classSession.findMany({ where, select: sessionSelect, orderBy: { startsAt: 'asc' }, take: 500 })
  const now = new Date()
  return { items: rows.map((row) => toView(row, now)) }
}

// note: danh sách coach có thể dạy thay: đúng môn, đang hoạt động, kèm cờ có bị trùng lịch không
export async function listSubstituteCandidates(sessionId: number) {
  const session = await loadSession(sessionId)
  const mainId = mainCoachId(session)
  const coaches = await prisma.coach.findMany({
    where: {
      status: 'ACTIVE',
      userId: { not: mainId },
      user: { status: 'ACTIVE', deletedAt: null },
      coachSports: { some: { sportId: session.groupClass.sportId } },
    },
    select: coachName.select,
    orderBy: { user: { displayName: 'asc' } },
  })
  const items = []
  for (const coach of coaches) {
    const busy = await sessionService.checkCoachConflict(coach.userId, session.startsAt, session.endsAt, session.id)
    items.push({ ...toCoach(coach)!, available: !busy })
  }
  return { session: toView(session), items }
}

export async function assignSubstitute(actor: AuthUser, sessionId: number, input: SubstituteInput) {
  const session = await loadSession(sessionId)
  assertChangeable(session)
  const mainId = mainCoachId(session)
  if (input.coachId === mainId) {
    throw new HttpError(409, 'Người dạy thay phải khác coach chính của buổi. Muốn trả lại coach chính hãy dùng "Hoàn tác".', 'SAME_AS_MAIN_COACH')
  }

  // note: người dạy thay phải là coach đang hoạt động và dạy được môn của lớp
  const coach = await prisma.coach.findUnique({
    where: { userId: input.coachId },
    select: { status: true, user: { select: { status: true, deletedAt: true, displayName: true } }, coachSports: { select: { sportId: true } } },
  })
  if (!coach || coach.status !== 'ACTIVE' || coach.user.status !== 'ACTIVE' || coach.user.deletedAt) {
    throw new HttpError(409, 'Coach dạy thay không tồn tại hoặc không hoạt động.', 'COACH_INACTIVE')
  }
  if (!coach.coachSports.some((item) => item.sportId === session.groupClass.sportId)) {
    throw new HttpError(409, 'Coach dạy thay không có chuyên môn môn học này.', 'COACH_NOT_QUALIFIED')
  }
  // note: không được trùng lịch lớp nhóm / 1-1 khác của coach dạy thay
  if (await sessionService.checkCoachConflict(input.coachId, session.startsAt, session.endsAt, session.id)) {
    throw new HttpError(409, 'Coach dạy thay đã có lịch khác trong khung giờ này.', 'COACH_SCHEDULE_CONFLICT')
  }

  const updated = await prisma.$transaction(async (tx) => {
    // note: đọc lại trong transaction để chắc chưa ai điểm danh trong lúc kiểm tra
    assertChangeable(await loadSession(sessionId, tx))
    await tx.classSession.update({
      where: { id: sessionId },
      data: {
        coachId: input.coachId,
        replacedCoachId: mainId,
        coachAbsent: input.coachAbsent,
        coachChangeReason: input.reason,
        coachChangedById: actor.id,
        coachChangedAt: new Date(),
      },
    })
    await audit(tx, {
      actorId: actor.id,
      action: 'SESSION_COACH_SUBSTITUTED',
      entityType: 'CLASS_SESSION',
      entityId: sessionId,
      oldData: { coachId: session.coachId, replacedCoachId: session.replacedCoachId, coachAbsent: session.coachAbsent },
      newData: { coachId: input.coachId, replacedCoachId: mainId, coachAbsent: input.coachAbsent, reason: input.reason },
    })
    const when = formatCenterTime(session.startsAt)
    // note: báo cho người dạy thay và coach chính; nếu trước đó đã có người dạy thay khác thì báo cả người đó
    const previousSubstitute = session.replacedCoachId !== null && session.coachId !== input.coachId ? [session.coachId!] : []
    await notify(tx, {
      userIds: [input.coachId],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Bạn được phân công dạy thay',
      content: `Bạn dạy thay buổi "${session.groupClass.name}" lúc ${when}. Lý do: ${input.reason}`,
    })
    await notify(tx, {
      userIds: [mainId, ...previousSubstitute],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Buổi học được giao người dạy thay',
      content: `Buổi "${session.groupClass.name}" lúc ${when} do ${coach.user.displayName} dạy thay. Lý do: ${input.reason}`,
    })
    return loadSession(sessionId, tx)
  })
  return toView(updated)
}

// note: coach chính vắng và không có người dạy thay → buổi ghi cho coach chính nhưng đánh dấu vắng (không trả tiền)
export async function markCoachAbsent(actor: AuthUser, sessionId: number, reason: string) {
  const session = await loadSession(sessionId)
  assertChangeable(session)
  const mainId = mainCoachId(session)
  const updated = await prisma.$transaction(async (tx) => {
    assertChangeable(await loadSession(sessionId, tx))
    await tx.classSession.update({
      where: { id: sessionId },
      data: { coachId: mainId, replacedCoachId: null, coachAbsent: true, coachChangeReason: reason, coachChangedById: actor.id, coachChangedAt: new Date() },
    })
    await audit(tx, {
      actorId: actor.id,
      action: 'SESSION_COACH_ABSENT',
      entityType: 'CLASS_SESSION',
      entityId: sessionId,
      oldData: { coachId: session.coachId, replacedCoachId: session.replacedCoachId, coachAbsent: session.coachAbsent },
      newData: { coachId: mainId, replacedCoachId: null, coachAbsent: true, reason },
    })
    // note: nếu trước đó có người dạy thay thì báo người đó là đã bỏ phân công
    const recipients = session.replacedCoachId !== null && session.coachId !== null ? [mainId, session.coachId] : [mainId]
    await notify(tx, {
      userIds: recipients,
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Ghi nhận coach vắng buổi học',
      content: `Buổi "${session.groupClass.name}" lúc ${formatCenterTime(session.startsAt)} được ghi nhận coach vắng. Lý do: ${reason}`,
    })
    return loadSession(sessionId, tx)
  })
  return toView(updated)
}

// note: hoàn tác: trả buổi về coach chính, xóa thông tin dạy thay/vắng
export async function resetSessionCoach(actor: AuthUser, sessionId: number) {
  const session = await loadSession(sessionId)
  assertChangeable(session)
  if (session.replacedCoachId === null && !session.coachAbsent) {
    throw new HttpError(409, 'Buổi học không có dạy thay hay coach vắng để hoàn tác.', 'NOTHING_TO_RESET')
  }
  const mainId = mainCoachId(session)
  // note: buổi chưa diễn ra và coach chính là coach lớp → để NULL (đi theo coach lớp); còn lại chốt coach chính
  const coachId = mainId === session.groupClass.coachId && session.startsAt > new Date() ? null : mainId
  const updated = await prisma.$transaction(async (tx) => {
    assertChangeable(await loadSession(sessionId, tx))
    await tx.classSession.update({
      where: { id: sessionId },
      data: { coachId, replacedCoachId: null, coachAbsent: false, coachChangeReason: null, coachChangedById: actor.id, coachChangedAt: new Date() },
    })
    await audit(tx, {
      actorId: actor.id,
      action: 'SESSION_COACH_RESET',
      entityType: 'CLASS_SESSION',
      entityId: sessionId,
      oldData: { coachId: session.coachId, replacedCoachId: session.replacedCoachId, coachAbsent: session.coachAbsent, reason: session.coachChangeReason },
      newData: { coachId, replacedCoachId: null, coachAbsent: false },
    })
    const recipients = session.replacedCoachId !== null && session.coachId !== null ? [mainId, session.coachId] : [mainId]
    await notify(tx, {
      userIds: recipients,
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Buổi học trở về coach chính',
      content: `Buổi "${session.groupClass.name}" lúc ${formatCenterTime(session.startsAt)} đã trở về coach chính.`,
    })
    return loadSession(sessionId, tx)
  })
  return toView(updated)
}
