import type { ClassStatus, SessionStatus } from '@prisma/client'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import type { MarkAttendanceInput } from './attendance.schema.js'
import {
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
  if (session.groupClass.coachId !== user.id) throw forbidden()
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
  if (user.role === 'COACH' && session.groupClass.coachId !== user.id) {
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
