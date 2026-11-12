
import { SessionStatus } from '@prisma/client'
import coachService from '../coaches/coach.service.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import { audit } from '../../lib/audit.js'
import { taughtByCoachWhere } from '../../lib/session-coach.js' // note: FR-66
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function targetScheduleEnd(startDate: Date, totalSessions: number | null, sessionsPerWeek: number | null) {
  if (!totalSessions || !sessionsPerWeek) return null
  const end = dateOnly(startDate)
  end.setUTCDate(end.getUTCDate() + Math.ceil(totalSessions / sessionsPerWeek) * 7 - 1)
  return end
}

function timeOnDate(date: Date, time: { hours: number; minutes: number }) {
  const result = new Date(date)
  result.setUTCHours(time.hours, time.minutes, 0, 0)
  return result
}

function centerTimeOnDate(date: Date, time: string) {
  return new Date(`${date.toISOString().slice(0, 10)}T${time}:00+07:00`)
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB
}

function parseDateOnly(value: string | Date) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? dateOnly(value) : null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null
}

type CreateSessionInput = {
  classId: number
  roomId: number
  startsAt: string | Date
  endsAt: string | Date
  note?: string
}

type WeeklyRecurrenceInput = {
  dayOfWeek: number
  startTime: string
  endTime: string
  effectiveFrom: string | Date
  effectiveTo: string | Date
}

type RecurringPatternInput = {
  dayOfWeek: number
  startTime: string
  endTime: string
  roomId: number
}

type RecurringScheduleInput = {
  patterns?: RecurringPatternInput[]
  effectiveFrom?: string | Date
  effectiveTo?: string | Date
  note?: string
  roomId?: number
  recurrence?: WeeklyRecurrenceInput
}

type PreparedSession = {
  classId: number
  roomId: number
  startsAt: Date
  endsAt: Date
  note?: string
}

export class SessionService {
  /**
   * FR-18: Kiểm tra xung đột phòng.
   * Hai buổi học bị trùng khi khoảng thời gian giao nhau.
   */
  async checkRoomConflict(
    roomId: number,
    startsAt: Date,
    endsAt: Date,
    excludeSessionId?: number,
  ): Promise<boolean> {
    const overlapping = await prisma.classSession.findFirst({
      where: {
        roomId,
        status: SessionStatus.SCHEDULED,
        NOT: excludeSessionId ? { id: excludeSessionId } : undefined,
        AND: [
          { startsAt: { lt: endsAt } },
          { endsAt: { gt: startsAt } },
        ],
      },
    })

    return !!overlapping
  }

  /**
   * FR-19: Kiểm tra xung đột lịch huấn luyện viên.
   * Kiểm tra cả lớp nhóm và khóa học 1-1.
   */
  async checkCoachConflict(
    coachId: number,
    startsAt: Date,
    endsAt: Date,
    excludeSessionId?: number,
  ): Promise<boolean> {
    // 1. Kiểm tra các buổi lớp nhóm khác.
    const overlappingClassSession = await prisma.classSession.findFirst({
      where: {
        status: SessionStatus.SCHEDULED,
        NOT: excludeSessionId ? { id: excludeSessionId } : undefined,
        // note: FR-66 tính cả buổi coach dạy thay, bỏ buổi coach đã được người khác dạy thay
        ...taughtByCoachWhere(coachId),
        AND: [
          { startsAt: { lt: endsAt } },
          { endsAt: { gt: startsAt } },
        ],
      },
    })

    if (overlappingClassSession) {
      return true
    }

    // 2. Kiểm tra lịch khóa học 1-1.
    return this.checkPrivateScheduleConflict(startsAt, endsAt, { coachId })
  }

  private async checkPrivateScheduleConflict(
    startsAt: Date,
    endsAt: Date,
    resources: { coachId?: number; memberIds?: number[]; roomId?: number },
  ) {
    const resourceFilters: object[] = []
    if (resources.coachId !== undefined) {
      resourceFilters.push({ enrollment: { coachId: resources.coachId } })
    }
    if (resources.memberIds?.length) {
      resourceFilters.push({ enrollment: { memberId: { in: resources.memberIds } } })
    }
    if (resources.roomId !== undefined) resourceFilters.push({ roomId: resources.roomId })
    if (resourceFilters.length === 0) return false

    const sessionDay = dateOnly(startsAt)
    const schedules = await prisma.privateCourseSchedule.findMany({
      where: {
        status: 'ACTIVE',
        enrollment: { status: 'ACTIVE' },
        AND: [
          { OR: resourceFilters },
          {
            OR: [
              {
                dayOfWeek: startsAt.getUTCDay(),
                effectiveFrom: { lte: sessionDay },
                effectiveTo: { gte: sessionDay },
              },
              {
                exceptions: {
                  some: {
                    action: 'RESCHEDULED',
                    rescheduledStartsAt: { lt: endsAt },
                    rescheduledEndsAt: { gt: startsAt },
                  },
                },
              },
            ],
          },
        ],
      },
      include: {
        enrollment: { select: { coachId: true, memberId: true } },
        exceptions: {
          where: {
            OR: [
              { sessionDate: sessionDay },
              {
                action: 'RESCHEDULED',
                rescheduledStartsAt: { lt: endsAt },
                rescheduledEndsAt: { gt: startsAt },
              },
            ],
          },
        },
      },
    })

    return schedules.some((schedule) => {
      const resourceConflict =
        resources.coachId === schedule.enrollment.coachId ||
        resources.memberIds?.includes(schedule.enrollment.memberId) ||
        resources.roomId === schedule.roomId
      if (!resourceConflict) return false

      const exception = schedule.exceptions.find(
        (item) => item.sessionDate.getTime() === sessionDay.getTime(),
      )
      const hasRecurringOccurrence =
        schedule.dayOfWeek === startsAt.getUTCDay() &&
        schedule.effectiveFrom <= sessionDay &&
        schedule.effectiveTo >= sessionDay
      const recurringConflict =
        hasRecurringOccurrence &&
        exception?.action !== 'CANCELLED' &&
        exception?.action !== 'RESCHEDULED' &&
        overlaps(
          startsAt,
          endsAt,
          timeOnDate(sessionDay, {
            hours: schedule.startTime.getUTCHours(),
            minutes: schedule.startTime.getUTCMinutes(),
          }),
          timeOnDate(sessionDay, {
            hours: schedule.endTime.getUTCHours(),
            minutes: schedule.endTime.getUTCMinutes(),
          }),
        )
      const movedOccurrenceConflict = schedule.exceptions.some((item) =>
        item.action === 'RESCHEDULED' &&
        item.rescheduledStartsAt !== null &&
        item.rescheduledEndsAt !== null &&
        overlaps(startsAt, endsAt, item.rescheduledStartsAt, item.rescheduledEndsAt),
      )
      return recurringConflict || movedOccurrenceConflict
    })
  }

  private async checkMemberConflict(
    classId: number,
    startsAt: Date,
    endsAt: Date,
  ) {
    const registrations = await prisma.classRegistration.findMany({
      where: { classId, status: 'CONFIRMED' },
      select: { memberId: true },
    })
    const memberIds = registrations.map((registration) => registration.memberId)
    if (memberIds.length === 0) return false

    const overlappingClass = await prisma.classSession.findFirst({
      where: {
        status: SessionStatus.SCHEDULED,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        groupClass: {
          registrations: {
            some: {
              memberId: { in: memberIds },
              status: 'CONFIRMED',
            },
          },
        },
      },
    })
    if (overlappingClass) return true

    return this.checkPrivateScheduleConflict(startsAt, endsAt, { memberIds })
  }

  /**
   * FR-17: Tạo buổi học cho lớp nhóm.
   */
  private async prepareSession(data: CreateSessionInput): Promise<PreparedSession> {
    const startsAt = new Date(data.startsAt)
    const endsAt = new Date(data.endsAt)

    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime())
    ) {
      throw new HttpError(400, 'Thời gian buổi học không hợp lệ.', 'INVALID_SESSION_TIME')
    }

    if (startsAt >= endsAt) {
      throw new HttpError(400,
        'Thời gian kết thúc buổi học phải sau thời gian bắt đầu.',
        'INVALID_TIME_RANGE',
      )
    }

    // Kiểm tra lớp học tồn tại.
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: data.classId },
    })

    if (!groupClass) {
      throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND')
    }

    // Kiểm tra thời gian thuộc khoảng thời gian của lớp.
    const plannedEnd = targetScheduleEnd(groupClass.startDate, groupClass.totalSessions, groupClass.sessionsPerWeek)
    if (
      dateOnly(startsAt) < dateOnly(groupClass.startDate) ||
      dateOnly(endsAt) > (plannedEnd ?? dateOnly(groupClass.endDate))
    ) {
      throw new HttpError(409,
        'Thời gian buổi học nằm ngoài khoảng thời gian diễn ra của lớp.',
        'SESSION_OUTSIDE_CLASS_DATES',
      )
    }

    // Kiểm tra phòng tồn tại và khả dụng.
    const room = await prisma.room.findUnique({
      where: { id: data.roomId },
    })

    if (!room || room.status !== 'AVAILABLE') {
      throw new HttpError(409, 'Phòng tập không tồn tại hoặc không khả dụng.', 'ROOM_UNAVAILABLE')
    }

    if (room.capacity < groupClass.capacity) {
      throw new HttpError(409,
        'Sức chứa của phòng không đủ đáp ứng số lượng học viên của lớp.',
        'ROOM_CAPACITY_INSUFFICIENT',
      )
    }

    // FR-18: Kiểm tra xung đột phòng.
    const isRoomBusy = await this.checkRoomConflict(
      data.roomId,
      startsAt,
      endsAt,
    )

    if (isRoomBusy) {
      throw new HttpError(409,
        'Phòng tập đã có lịch sử dụng vào khung giờ này.',
        'ROOM_SCHEDULE_CONFLICT',
      )
    }
    if (await this.checkPrivateScheduleConflict(startsAt, endsAt, { roomId: data.roomId })) {
      throw new HttpError(409, 'Phòng tập đã có lịch khóa học cá nhân vào khung giờ này.', 'ROOM_SCHEDULE_CONFLICT')
    }

    // FR-19: Kiểm tra xung đột huấn luyện viên.
    const isCoachBusy = await this.checkCoachConflict(
      groupClass.coachId,
      startsAt,
      endsAt,
    )

    if (isCoachBusy) {
      throw new HttpError(409,
        'Huấn luyện viên đã bận lịch dạy ở lớp hoặc khóa học khác trong khung giờ này.',
        'COACH_SCHEDULE_CONFLICT',
      )
    }

    if (await this.checkMemberConflict(data.classId, startsAt, endsAt)) {
      throw new HttpError(409, 'Lịch của hội viên trong lớp bị chồng lấn.', 'MEMBER_SCHEDULE_CONFLICT')
    }

    if (!await coachService.isAvailableForSession(groupClass.coachId, startsAt, endsAt)) {
      throw new HttpError(409, 'Huấn luyện viên không khả dụng trong khoảng thời gian buổi học.', 'COACH_UNAVAILABLE')
    }

    return {
      classId: data.classId,
      roomId: data.roomId,
      startsAt,
      endsAt,
      note: data.note,
    }
  }

  async createSession(data: CreateSessionInput) {
    const prepared = await this.prepareSession(data)
    return prisma.classSession.create({
      data: { ...prepared, status: SessionStatus.SCHEDULED },
    })
  }

  async createSessions(classId: number, sessions: Omit<CreateSessionInput, 'classId'>[], finalDate?: Date) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new HttpError(400, 'Cần cung cấp ít nhất một buổi học.', 'SESSIONS_REQUIRED')
    }
    const prepared: PreparedSession[] = []
    for (const session of sessions) {
      prepared.push(await this.prepareSession({ ...session, classId }))
    }

    for (let i = 0; i < prepared.length; i += 1) {
      for (let j = i + 1; j < prepared.length; j += 1) {
        const first = prepared[i]!
        const second = prepared[j]!
        if (
          first.startsAt < second.endsAt &&
          first.endsAt > second.startsAt &&
          (first.roomId === second.roomId || first.classId === second.classId)
        ) {
          throw new HttpError(409, 'Các buổi học trong cùng yêu cầu bị chồng lấn.', 'SESSION_SCHEDULE_CONFLICT')
        }
      }
    }

    return prisma.$transaction(async (tx) => {
      const created = []
      for (const session of prepared) {
        created.push(await tx.classSession.create({
          data: { ...session, status: SessionStatus.SCHEDULED },
        }))
      }
      if (finalDate) await tx.groupClass.update({ where: { id: classId }, data: { endDate: finalDate } })
      return created
    })
  }

  async createRecurringSessions(
    classId: number,
    input: RecurringScheduleInput,
  ) {
    const { sessions, finalDate } = await this.buildRecurringSessions(classId, input)
    const preview = await this.previewPreparedSessions(classId, sessions)
    if (!preview.canCreate) {
      throw new HttpError(409, 'Lịch lặp có buổi bị xung đột hoặc nằm ngoài availability của Coach.', 'RECURRING_SCHEDULE_CONFLICT', {
        conflicts: preview.occurrences.filter((item) => !item.valid),
      })
    }
    return this.createSessions(classId, sessions, finalDate)
  }

  async previewRecurringSessions(classId: number, input: RecurringScheduleInput) {
    const { sessions } = await this.buildRecurringSessions(classId, input)
    return this.previewPreparedSessions(classId, sessions)
  }

  private async buildRecurringSessions(classId: number, input: RecurringScheduleInput) {
    if (!input || typeof input !== 'object') {
      throw new HttpError(400, 'Thông tin lịch lặp không hợp lệ.', 'INVALID_RECURRENCE')
    }
    const usesLegacyRecurrence = !input.patterns?.length && Boolean(input.recurrence && input.roomId)
    const patterns: RecurringPatternInput[] = input.patterns?.length
      ? input.patterns
      : input.recurrence && input.roomId
        ? [{
            roomId: input.roomId,
            dayOfWeek: input.recurrence.dayOfWeek,
            startTime: input.recurrence.startTime,
            endTime: input.recurrence.endTime,
          }]
        : []
    const effectiveFromValue = input.effectiveFrom ?? input.recurrence?.effectiveFrom
    const effectiveToValue = input.effectiveTo ?? input.recurrence?.effectiveTo
    if (patterns.length === 0 || !effectiveFromValue || !effectiveToValue) {
      throw new HttpError(400, 'Cần chọn ít nhất một ca và khoảng ngày áp dụng.', 'RECURRENCE_REQUIRED')
    }
    const effectiveFrom = parseDateOnly(effectiveFromValue)
    let effectiveTo = parseDateOnly(effectiveToValue)
    if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) {
      throw new HttpError(400, 'Khoảng ngày lặp không hợp lệ.', 'INVALID_RECURRENCE_RANGE')
    }
    const groupClass = await prisma.groupClass.findUnique({ where: { id: classId } })
    if (!groupClass) throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND')
    const plannedEnd = targetScheduleEnd(groupClass.startDate, groupClass.totalSessions, groupClass.sessionsPerWeek)
    if (plannedEnd) effectiveTo = plannedEnd
    if (groupClass.totalSessions && groupClass.sessionsPerWeek) {
      if (patterns.length !== groupClass.sessionsPerWeek) {
        throw new HttpError(400, `Chọn đúng ${groupClass.sessionsPerWeek} ca mỗi tuần.`, 'WEEKLY_SESSION_COUNT_MISMATCH')
      }
      const existing = await prisma.classSession.count({ where: { classId, status: { not: SessionStatus.CANCELLED } } })
      if (existing > 0) throw new HttpError(409, 'Lớp đã có buổi học; không thể tạo lại toàn bộ lịch.', 'CLASS_ALREADY_SCHEDULED')
    }
    if (effectiveFrom < dateOnly(groupClass.startDate) || effectiveTo > (plannedEnd ?? dateOnly(groupClass.endDate))) {
      throw new HttpError(409, 'Khoảng ngày lặp nằm ngoài thời hạn của lớp.', 'RECURRENCE_OUTSIDE_CLASS_DATES')
    }

    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
    const signature = new Set<string>()
    const sessions: Omit<CreateSessionInput, 'classId'>[] = []
    for (const pattern of patterns) {
      if (!Number.isSafeInteger(pattern.roomId) || pattern.roomId <= 0) {
        throw new HttpError(400, 'Phòng học không hợp lệ.', 'INVALID_ROOM_ID')
      }
      if (!Number.isInteger(pattern.dayOfWeek) || pattern.dayOfWeek < 0 || pattern.dayOfWeek > 6) {
        throw new HttpError(400, 'dayOfWeek phải nằm trong khoảng 0 đến 6.', 'INVALID_DAY_OF_WEEK')
      }
      if (!timePattern.test(pattern.startTime) || !timePattern.test(pattern.endTime) || pattern.startTime >= pattern.endTime) {
        throw new HttpError(400, 'Khung giờ học không hợp lệ.', 'INVALID_SESSION_TIME')
      }
      const key = `${pattern.dayOfWeek}:${pattern.startTime}:${pattern.endTime}:${pattern.roomId}`
      if (signature.has(key)) throw new HttpError(409, 'Lịch lặp có ca bị trùng.', 'DUPLICATE_RECURRENCE_PATTERN')
      signature.add(key)
      const firstOccurrence = new Date(effectiveFrom)
      firstOccurrence.setUTCDate(firstOccurrence.getUTCDate() + (pattern.dayOfWeek - firstOccurrence.getUTCDay() + 7) % 7)
      for (const date = new Date(firstOccurrence); date <= effectiveTo; date.setUTCDate(date.getUTCDate() + 7)) {
        sessions.push({
          roomId: pattern.roomId,
          startsAt: usesLegacyRecurrence
            ? timeOnDate(date, { hours: Number(pattern.startTime.slice(0, 2)), minutes: Number(pattern.startTime.slice(3, 5)) })
            : centerTimeOnDate(date, pattern.startTime),
          endsAt: usesLegacyRecurrence
            ? timeOnDate(date, { hours: Number(pattern.endTime.slice(0, 2)), minutes: Number(pattern.endTime.slice(3, 5)) })
            : centerTimeOnDate(date, pattern.endTime),
          note: input.note,
        })
      }
    }
    if (sessions.length === 0) throw new HttpError(400, 'Khoảng ngày không chứa buổi học nào.', 'NO_RECURRENCE_OCCURRENCES')
    sessions.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    if (groupClass.totalSessions) {
      if (sessions.length < groupClass.totalSessions) throw new HttpError(400, 'Khoảng ngày không đủ số buổi đã đăng ký.', 'INSUFFICIENT_CLASS_SESSIONS')
      sessions.length = groupClass.totalSessions
    }
    const finalDate = groupClass.totalSessions
      ? new Date(new Date(new Date(sessions.at(-1)!.startsAt).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00.000Z')
      : undefined
    return { sessions, finalDate }
  }

  private async previewPreparedSessions(classId: number, sessions: Omit<CreateSessionInput, 'classId'>[]) {
    const occurrences: Array<{ startsAt: string; endsAt: string; roomId: number; valid: boolean; code?: string; message?: string }> = []
    for (const session of sessions) {
      try {
        await this.prepareSession({ ...session, classId })
        occurrences.push({ startsAt: new Date(session.startsAt).toISOString(), endsAt: new Date(session.endsAt).toISOString(), roomId: session.roomId, valid: true })
      } catch (error) {
        if (!(error instanceof HttpError)) throw error
        occurrences.push({ startsAt: new Date(session.startsAt).toISOString(), endsAt: new Date(session.endsAt).toISOString(), roomId: session.roomId, valid: false, code: error.code, message: error.message })
      }
    }
    for (let i = 0; i < sessions.length; i += 1) {
      for (let j = i + 1; j < sessions.length; j += 1) {
        const first = sessions[i]!
        const second = sessions[j]!
        if (new Date(first.startsAt) < new Date(second.endsAt) && new Date(first.endsAt) > new Date(second.startsAt)) {
          for (const index of [i, j]) {
            occurrences[index] = { ...occurrences[index]!, valid: false, code: 'SESSION_SCHEDULE_CONFLICT', message: 'Các ca đã chọn bị chồng lấn.' }
          }
        }
      }
    }
    return { canCreate: occurrences.every((item) => item.valid), total: occurrences.length, conflicts: occurrences.filter((item) => !item.valid).length, occurrences }
  }

  async getClassSessions(classId: number) {
    const groupClass = await prisma.groupClass.findUnique({
      where: { id: classId },
      select: { id: true },
    })
    if (!groupClass) {
      throw new HttpError(404, 'Không tìm thấy lớp học.', 'CLASS_NOT_FOUND')
    }
    return prisma.classSession.findMany({
      where: { classId },
      include: { room: true },
      orderBy: { startsAt: 'asc' },
    })
  }

  /**
   * FR-20 / BR-21:
   * Đổi thời gian hoặc phòng buổi học.
   * Lưu lịch sử và tạo thông báo trong cùng transaction.
   */
  async changeSession(
    sessionId: number,
    changedById: number,
    data: {
      newStartsAt?: string | Date
      newRoomId?: number
      reason: string
    },
  ) {
    // 1. Kiểm tra dữ liệu đầu vào.
    if (typeof data.reason !== 'string' || !data.reason.trim()) {
      throw new HttpError(400, 'Lý do đổi lịch là bắt buộc.', 'CHANGE_REASON_REQUIRED')
    }

    if (
      data.newStartsAt !== undefined &&
      !Number.isFinite(new Date(data.newStartsAt).getTime())
    ) {
      throw new HttpError(400, 'Thời gian bắt đầu mới không hợp lệ.', 'INVALID_SESSION_TIME')
    }

    if (
      data.newRoomId !== undefined &&
      (!Number.isInteger(data.newRoomId) || data.newRoomId <= 0)
    ) {
      throw new HttpError(400, 'ID phòng tập không hợp lệ.', 'INVALID_ROOM_ID')
    }

    // 2. Lấy buổi học, lớp và các hội viên đã xác nhận đăng ký.
    const session = await prisma.classSession.findUnique({
      where: { id: sessionId },
      include: {
        groupClass: {
          include: {
            registrations: {
              where: {
                status: 'CONFIRMED',
              },
              select: {
                memberId: true,
              },
            },
          },
        },
      },
    })

    if (!session) {
      throw new HttpError(404, 'Không tìm thấy buổi học.', 'SESSION_NOT_FOUND')
    }

    if (session.status !== SessionStatus.SCHEDULED) {
      throw new HttpError(409, 'Chỉ có thể đổi lịch buổi học đang được lên lịch.', 'SESSION_NOT_SCHEDULED')
    }

    // 3. Tính thời gian mới, giữ nguyên thời lượng buổi học.
    const newStartsAt =
      data.newStartsAt !== undefined
        ? new Date(data.newStartsAt)
        : session.startsAt

    const durationMs =
      session.endsAt.getTime() - session.startsAt.getTime()

    const newEndsAt = new Date(newStartsAt.getTime() + durationMs)
    const newRoomId = data.newRoomId ?? session.roomId

    if (newStartsAt >= newEndsAt) {
      throw new HttpError(400,
        'Thời gian kết thúc buổi học phải sau thời gian bắt đầu.',
        'INVALID_TIME_RANGE',
      )
    }

    // 4. Kiểm tra buổi học vẫn nằm trong thời gian của lớp.
    if (
      dateOnly(newStartsAt) < dateOnly(session.groupClass.startDate) ||
      dateOnly(newEndsAt) > dateOnly(session.groupClass.endDate)
    ) {
      throw new HttpError(409,
        'Lịch mới nằm ngoài khoảng thời gian diễn ra của lớp.',
        'SESSION_OUTSIDE_CLASS_DATES',
      )
    }

    // 5. Kiểm tra phòng mới tồn tại, khả dụng và đủ sức chứa.
    const room = await prisma.room.findUnique({
      where: { id: newRoomId },
    })

    if (!room || room.status !== 'AVAILABLE') {
      throw new HttpError(409, 'Phòng tập mới không tồn tại hoặc không khả dụng.', 'ROOM_UNAVAILABLE')
    }

    if (room.capacity < session.groupClass.capacity) {
      throw new HttpError(409,
        'Sức chứa của phòng mới không đủ đáp ứng số lượng học viên của lớp.',
        'ROOM_CAPACITY_INSUFFICIENT',
      )
    }

    // 6. Kiểm tra xung đột phòng.
    const isRoomBusy = await this.checkRoomConflict(
      newRoomId,
      newStartsAt,
      newEndsAt,
      sessionId,
    )

    if (isRoomBusy) {
      throw new HttpError(409,
        'Phòng tập mới đã bị trùng lịch trong khung giờ này.',
        'ROOM_SCHEDULE_CONFLICT',
      )
    }
    if (await this.checkPrivateScheduleConflict(newStartsAt, newEndsAt, { roomId: newRoomId })) {
      throw new HttpError(409, 'Phòng tập mới đã có lịch khóa học cá nhân.', 'ROOM_SCHEDULE_CONFLICT')
    }

    // 7. Kiểm tra xung đột huấn luyện viên.
    const isCoachBusy = await this.checkCoachConflict(
      session.groupClass.coachId,
      newStartsAt,
      newEndsAt,
      sessionId,
    )

    if (isCoachBusy) {
      throw new HttpError(409,
        'Huấn luyện viên bị trùng lịch trong khung giờ mới này.',
        'COACH_SCHEDULE_CONFLICT',
      )
    }

    if (!await coachService.isAvailableForSession(
      session.groupClass.coachId,
      newStartsAt,
      newEndsAt,
    )) {
      throw new HttpError(409, 'Huấn luyện viên không khả dụng trong khung giờ mới.', 'COACH_UNAVAILABLE')
    }

    // Kiểm tra xung đột lịch của các hội viên đã đăng ký lớp.
    const memberIds = session.groupClass.registrations.map((registration) => registration.memberId)
    if (memberIds.length > 0) {
      const overlappingClass = await prisma.classSession.findFirst({
        where: {
          id: { not: sessionId },
          status: SessionStatus.SCHEDULED,
          startsAt: { lt: newEndsAt },
          endsAt: { gt: newStartsAt },
          groupClass: {
            registrations: {
              some: { memberId: { in: memberIds }, status: 'CONFIRMED' },
            },
          },
        },
      })
      if (overlappingClass) {
        throw new HttpError(409, 'Lịch của hội viên bị trùng với buổi học khác.', 'MEMBER_SCHEDULE_CONFLICT')
      }

      const memberScheduleConflict = await this.checkPrivateScheduleConflict(
        newStartsAt,
        newEndsAt,
        { memberIds },
      )
      if (memberScheduleConflict) {
        throw new HttpError(409, 'Lịch của hội viên bị trùng với khóa học cá nhân.', 'MEMBER_SCHEDULE_CONFLICT')
      }
    }

    // Chuẩn bị người nhận thông báo.
    const recipientIds = [
      session.groupClass.coachId,
      ...session.groupClass.registrations.map(
        (registration) => registration.memberId,
      ),
    ]

    const uniqueRecipientIds = [...new Set(recipientIds)]
    const reason = data.reason.trim()

    const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Ho_Chi_Minh',
    })

    const content =
      `Lịch buổi học "${session.groupClass.name}" đã thay đổi. ` +
      `Thời gian mới: ${timeFormatter.format(newStartsAt)} – ` +
      `${timeFormatter.format(newEndsAt)} tại phòng ${room.name}. ` +
      `Lý do: ${reason}`

    // 9. Cập nhật lịch, lưu lịch sử và tạo thông báo nguyên tử.
    return prisma.$transaction(async (tx) => {
      const updatedSession = await tx.classSession.update({
        where: { id: sessionId },
        data: {
          startsAt: newStartsAt,
          endsAt: newEndsAt,
          roomId: newRoomId,
        },
      })

      await tx.scheduleChange.create({
        data: {
          classSessionId: sessionId,
          changedById,
          oldStartsAt: session.startsAt,
          newStartsAt,
          oldRoomId: session.roomId,
          newRoomId,
          reason,
        },
      })

      await audit(tx, {
        actorId: changedById,
        action: 'CLASS_SESSION_RESCHEDULED',
        entityType: 'CLASS_SESSION',
        entityId: sessionId,
        oldData: { startsAt: session.startsAt, endsAt: session.endsAt, roomId: session.roomId },
        newData: { startsAt: newStartsAt, endsAt: newEndsAt, roomId: newRoomId, reason },
      })
      await notify(tx, {
        userIds: uniqueRecipientIds,
        type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Thông báo thay đổi lịch học',
        content,
      })

      return updatedSession
    })
  }

  async cancelSession(sessionId: number, actorId: number, reason: string) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new HttpError(400, 'Lý do hủy buổi học là bắt buộc.', 'CANCELLATION_REASON_REQUIRED')
    }
    return prisma.$transaction(async (tx) => {
      const session = await tx.classSession.findUnique({
        where: { id: sessionId },
        include: {
          groupClass: {
            include: {
              registrations: {
                where: { status: 'CONFIRMED' },
                select: { memberId: true },
              },
            },
          },
          attendances: { select: { id: true } },
        },
      })
      if (!session) throw new HttpError(404, 'Không tìm thấy buổi học.', 'SESSION_NOT_FOUND')
      if (session.status !== SessionStatus.SCHEDULED) {
        throw new HttpError(409, 'Chỉ có thể hủy buổi học đang được lên lịch.', 'SESSION_NOT_SCHEDULED')
      }
      if (session.startsAt <= new Date() || session.attendances.length > 0) {
        throw new HttpError(409, 'Không thể hủy buổi học đã bắt đầu hoặc đã có attendance.', 'SESSION_ALREADY_STARTED')
      }

      const updated = await tx.classSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.CANCELLED },
      })
      const cleanReason = reason.trim()
      await audit(tx, {
        actorId,
        action: 'CLASS_SESSION_CANCELLED',
        entityType: 'CLASS_SESSION',
        entityId: sessionId,
        oldData: { status: session.status, startsAt: session.startsAt, endsAt: session.endsAt, roomId: session.roomId },
        newData: { status: SessionStatus.CANCELLED, reason: cleanReason },
      })
      await notify(tx, {
        userIds: [session.groupClass.coachId, ...session.groupClass.registrations.map((item) => item.memberId)],
        type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Buổi học đã bị hủy',
        content: `Buổi học "${session.groupClass.name}" vào ${new Intl.DateTimeFormat('vi-VN', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Asia/Ho_Chi_Minh',
        }).format(session.startsAt)} đã bị hủy. Lý do: ${cleanReason}`,
      })
      return updated
    })
  }
}

export default new SessionService()
