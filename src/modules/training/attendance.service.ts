import type { ClassStatus, SessionStatus } from '@prisma/client'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'
import { effectiveCoachId } from '../../lib/session-coach.js' // note: FR-66
import type { AuthUser } from '../../middleware/auth.js'
import type {
  ExportAttendanceQuery,
  ListAttendanceQuery,
  MarkAttendanceInput,
} from './attendance.schema.js'
import {
  countAttendanceHistory,
  findAttendanceForExport,
  findAttendanceHistory,
  findConfirmedRoster,
  findRegistrationsByIds,
  findSessionWithClass,
  upsertAttendance,
} from './attendance.repository.js'
import {
  BR_MESSAGES,
  forbidden,
  notFound,
  runInTransaction,
  toMemberRef,
  toPage,
  toSkipTake,
} from './training.common.js'

const HOUR_MS = 60 * 60 * 1000

type SessionTiming = {
  startsAt: Date
  endsAt: Date
  status: SessionStatus
  groupClass: { status: ClassStatus }
}

// BR-43: chỉ ghi điểm danh khi buổi đã bắt đầu và chưa quá hạn sửa
export function isAttendanceLocked(session: SessionTiming, now = new Date()) {
  if (session.status === 'CANCELLED') return true
  if (session.groupClass.status === 'CANCELLED') return true
  if (now < session.startsAt) return true
  const editableUntil =
    session.endsAt.getTime() + env.ATTENDANCE_EDIT_WINDOW_HOURS * HOUR_MS
  return now.getTime() > editableUntil
}

async function getSessionOrThrow(sessionId: number) {
  const session = await findSessionWithClass(sessionId)
  if (!session) throw notFound('Không tìm thấy buổi học')
  return session
}

export async function markAttendance(
  user: AuthUser,
  sessionId: number,
  input: MarkAttendanceInput,
) {
  const session = await getSessionOrThrow(sessionId)
  // note: FR-66 người dạy thực tế (kể cả dạy thay) mới được điểm danh
  if (effectiveCoachId(session) !== user.id) throw forbidden()
  if (isAttendanceLocked(session)) {
    throw new HttpError(409, BR_MESSAGES.BR43, 'ATTENDANCE_LOCKED')
  }

  const checkedAt = new Date()
  const records = await runInTransaction(async (tx) => {
    const ids = input.records.map((record) => record.classRegistrationId)
    const registrations = await findRegistrationsByIds(ids, tx)

    // BR-42: registration phải CONFIRMED và thuộc đúng lớp của buổi học
    const eligibleIds = new Set(
      registrations
        .filter(
          (r) => r.classId === session.classId && r.status === 'CONFIRMED',
        )
        .map((r) => r.id),
    )
    const invalidRegistrationIds = ids.filter((id) => !eligibleIds.has(id))
    if (invalidRegistrationIds.length > 0) {
      throw new HttpError(422, BR_MESSAGES.BR42, 'REGISTRATION_NOT_ELIGIBLE', {
        invalidRegistrationIds,
      })
    }

    // BR-43: upsert theo cặp registration–session, lỗi ở đâu thì rollback toàn bộ
    const saved = []
    for (const record of input.records) {
      saved.push(
        await upsertAttendance(tx, {
          registrationId: record.classRegistrationId,
          classSessionId: session.id,
          status: record.status,
          note: record.note ?? null,
          markedById: user.id,
          checkedAt,
        }),
      )
    }
    return saved
  })

  return { sessionId: session.id, records }
}

export async function getSessionAttendance(user: AuthUser, sessionId: number) {
  const session = await getSessionOrThrow(sessionId)
  if (user.role === 'COACH' && effectiveCoachId(session) !== user.id) { // note: FR-66
    throw forbidden()
  }

  const roster = await findConfirmedRoster(session.classId, session.id)
  return {
    session: {
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      class: { id: session.groupClass.id, name: session.groupClass.name },
    },
    isLocked: isAttendanceLocked(session),
    students: roster.map((registration) => ({
      registrationId: registration.id,
      member: toMemberRef(registration.member),
      attendance: registration.attendances[0] ?? null,
    })),
  }
}

type HistoryRow = Awaited<ReturnType<typeof findAttendanceHistory>>[0][number]

function toHistoryItem({
  classSession,
  registration,
  ...attendance
}: HistoryRow) {
  const { groupClass, ...session } = classSession
  return {
    ...attendance,
    registrationId: registration.id,
    session,
    class: groupClass,
    member: toMemberRef(registration.member),
  }
}

// FR-48: Member chỉ xem của mình (bỏ qua memberId gửi lên),
// Coach chỉ xem các lớp mình phụ trách, Manager lọc tự do.
function scopeHistoryFilter(user: AuthUser, filters: ExportAttendanceQuery) {
  return {
    ...filters,
    memberId: user.role === 'MEMBER' ? user.id : filters.memberId,
    coachId: user.role === 'COACH' ? user.id : undefined,
  }
}

export async function listAttendanceHistory(
  user: AuthUser,
  query: ListAttendanceQuery,
) {
  const { page, pageSize, ...filters } = query
  const [rows, total] = await findAttendanceHistory(
    scopeHistoryFilter(user, filters),
    toSkipTake({ page, pageSize }),
  )
  return toPage(rows.map(toHistoryItem), total, { page, pageSize })
}

// Giới hạn số dòng một file để không giữ quá nhiều dữ liệu trong bộ nhớ khi dựng Excel
export const MAX_EXPORT_ROWS = 5000

export type AttendanceExportItem = ReturnType<typeof toHistoryItem>

// Xuất báo cáo điểm danh, cùng phạm vi dữ liệu với FR-48 (Coach: lớp mình phụ trách; Manager: toàn trung tâm)
export async function exportAttendanceHistory(
  user: AuthUser,
  query: ExportAttendanceQuery,
) {
  const filter = scopeHistoryFilter(user, query)
  const total = await countAttendanceHistory(filter)
  if (total > MAX_EXPORT_ROWS) {
    throw new HttpError(
      422,
      `Có ${total} bản ghi, vượt giới hạn ${MAX_EXPORT_ROWS} dòng mỗi file. Hãy thu hẹp khoảng thời gian hoặc lọc theo lớp.`,
      'EXPORT_TOO_LARGE',
    )
  }
  const rows = await findAttendanceForExport(filter)
  return rows.map(toHistoryItem)
}
