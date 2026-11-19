import { EnrollmentStatus, OrderItemType, OrderStatus, Prisma, ScheduleStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { centerDateOnly, centerDateTime, centerDayOfWeek, wallClock } from '../../lib/center-time.js'
import { AVAILABILITY_SHIFTS, shiftByCode } from '../coach-availability/coach-availability.constants.js'
import { settleZeroAmountOrder } from '../finance/finance.service.js'

export type ShiftBookingInput = {
  memberId: number
  privateCourseId: number
  coachId: number
  startDate: string
  schedules: { dayOfWeek: number; shiftCode: string }[]
}

type Db = Prisma.TransactionClient
const dayText = (date: Date) => date.toISOString().slice(0, 10)
const toDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && dayText(date) === value ? date : null
}
const minutes = (value: { hours: number; minutes: number }) => value.hours * 60 + value.minutes
const overlap = (a: Date, b: Date, c: Date, d: Date) => a < d && b > c
const clock = (text: string) => ({ hours: Number(text.slice(0, 2)), minutes: Number(text.slice(3, 5)) })

async function plan(db: Db, input: ShiftBookingInput) {
  const course = await db.privateCourse.findUnique({ where: { id: input.privateCourseId } })
  if (!course || course.status !== 'ACTIVE') throw new HttpError(404, 'Khóa học 1–1 không còn mở đăng ký.', 'PRIVATE_COURSE_UNAVAILABLE')
  if (course.sessionDurationMinutes < 1 || course.sessionDurationMinutes > 90 || course.totalSessions < 2) throw new HttpError(409, 'Thời lượng khóa không phù hợp với ca học 90 phút.', 'INVALID_COURSE')
  if (!input.schedules.length) throw new HttpError(400, 'Chọn ít nhất một ca học mỗi tuần.', 'SCHEDULE_REQUIRED')
  const from = toDate(input.startDate)
  if (!from || from < centerDateOnly(new Date())) throw new HttpError(400, 'Ngày bắt đầu phải từ hôm nay trở đi.', 'INVALID_START_DATE')
  const until = new Date(from)
  until.setUTCDate(until.getUTCDate() + course.validityDays)
  const selected = input.schedules.map((slot) => {
    const shift = shiftByCode.get(slot.shiftCode)
    if (!shift || !Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6) throw new HttpError(400, 'Ca học không hợp lệ.', 'INVALID_SHIFT')
    const key = `${slot.dayOfWeek}:${slot.shiftCode}`
    return { ...slot, key, start: clock(shift.startTime), shiftEnd: clock(shift.endTime) }
  })
  if (new Set(selected.map((slot) => slot.key)).size !== selected.length) throw new HttpError(400, 'Ca học bị chọn trùng.', 'DUPLICATE_SHIFT')
  const [assignment, coach, existingEnrollment] = await Promise.all([
    db.coachPrivateCourse.findFirst({ where: { privateCourseId: course.id, coachId: input.coachId, isActive: true } }),
    db.coach.findUnique({ where: { userId: input.coachId }, include: { coachSports: true } }),
    db.privateCourseEnrollment.findFirst({ where: { memberId: input.memberId, privateCourseId: course.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } }, include: { orderItem: { include: { order: true } } } }),
  ])
  if (!assignment || coach?.status !== 'ACTIVE' || !coach.coachSports.some((sport) => sport.sportId === course.sportId)) throw new HttpError(409, 'Coach chưa được phân công hoặc không đủ chuyên môn.', 'COACH_NOT_ASSIGNED')
  if (existingEnrollment && (existingEnrollment.status === 'ACTIVE' || !existingEnrollment.orderItem?.order.expiresAt || existingEnrollment.orderItem.order.expiresAt > new Date())) throw new HttpError(409, 'Bạn đã có đăng ký khóa học này.', 'ENROLLMENT_EXISTS')

  const occurrences = selected.flatMap((slot) => {
    const dates: { key: string; dayOfWeek: number; shiftCode: string; startsAt: Date; endsAt: Date }[] = []
    const date = new Date(from)
    date.setUTCDate(date.getUTCDate() + (slot.dayOfWeek - date.getUTCDay() + 7) % 7)
    while (date <= until) {
      const startsAt = centerDateTime(date, slot.start)
      const endsAt = new Date(startsAt.getTime() + course.sessionDurationMinutes * 60_000)
      if (startsAt > new Date()) dates.push({ key: slot.key, dayOfWeek: slot.dayOfWeek, shiftCode: slot.shiftCode, startsAt, endsAt })
      date.setUTCDate(date.getUTCDate() + 7)
    }
    return dates
  }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, course.totalSessions)
  if (occurrences.length < course.totalSessions) throw new HttpError(409, 'Các ca đã chọn không đủ số buổi trong thời hạn khóa.', 'INSUFFICIENT_SESSIONS')

  const [availabilities, rooms, privateSchedules, groupSessions] = await Promise.all([
    db.coachAvailability.findMany({ where: { coachId: input.coachId, status: 'AVAILABLE', effectiveFrom: { lte: until }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } }),
    db.room.findMany({ where: { status: 'AVAILABLE', capacity: { gte: 1 } }, orderBy: { id: 'asc' } }),
    db.privateCourseSchedule.findMany({ where: { status: 'ACTIVE', OR: [{ effectiveFrom: { lte: until }, effectiveTo: { gte: from } }, { exceptions: { some: { action: 'RESCHEDULED', rescheduledStartsAt: { lt: new Date(until.getTime() + 86_400_000) }, rescheduledEndsAt: { gt: from } } } }], enrollment: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } } }, include: { enrollment: { include: { orderItem: { include: { order: true } } } }, exceptions: true } }),
    db.classSession.findMany({ where: { status: 'SCHEDULED', startsAt: { lt: new Date(until.getTime() + 86_400_000) }, endsAt: { gt: new Date(from.getTime() - 86_400_000) } }, include: { groupClass: { include: { registrations: { where: { memberId: input.memberId, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } }, select: { id: true } } } } } }),
  ])
  if (!rooms.length) throw new HttpError(409, 'Chưa có phòng học khả dụng.', 'ROOM_UNAVAILABLE')
  const now = new Date()
  const scheduleConflict = (occurrence: typeof occurrences[number], roomId?: number) => privateSchedules.some((existing) => {
    if (existing.enrollment.status === 'PENDING_PAYMENT' && existing.enrollment.orderItem?.order.expiresAt && existing.enrollment.orderItem.order.expiresAt <= now) return false
    const date = dayText(centerDateOnly(occurrence.startsAt))
    const originalDay = existing.dayOfWeek === centerDayOfWeek(occurrence.startsAt) && date >= dayText(existing.effectiveFrom) && date <= dayText(existing.effectiveTo)
    const exception = originalDay ? existing.exceptions.find((item) => dayText(item.sessionDate) === date) : undefined
    const times = [] as { start: Date; end: Date; coachId: number; roomId: number }[]
    if (originalDay && !exception) times.push({ start: centerDateTime(centerDateOnly(occurrence.startsAt), wallClock(existing.startTime)), end: centerDateTime(centerDateOnly(occurrence.startsAt), wallClock(existing.endTime)), coachId: existing.enrollment.coachId, roomId: existing.roomId })
    for (const change of existing.exceptions) if (change.action === 'RESCHEDULED' && change.rescheduledStartsAt && change.rescheduledEndsAt) times.push({ start: change.rescheduledStartsAt, end: change.rescheduledEndsAt, coachId: change.newCoachId ?? existing.enrollment.coachId, roomId: change.newRoomId ?? existing.roomId })
    return times.some((time) => overlap(occurrence.startsAt, occurrence.endsAt, time.start, time.end) && (time.coachId === input.coachId || existing.enrollment.memberId === input.memberId || roomId === time.roomId))
  })
  for (const occurrence of occurrences) {
    const availability = availabilities.some((item) => item.dayOfWeek === occurrence.dayOfWeek && item.effectiveFrom <= centerDateOnly(occurrence.startsAt) && (!item.effectiveTo || item.effectiveTo >= centerDateOnly(occurrence.startsAt)) && minutes(wallClock(item.startTime)) <= minutes(clock(shiftByCode.get(occurrence.shiftCode)!.startTime)) && minutes(wallClock(item.endTime)) >= minutes(clock(shiftByCode.get(occurrence.shiftCode)!.endTime)))
    if (!availability) throw new HttpError(409, `Coach không khả dụng vào ${dayText(centerDateOnly(occurrence.startsAt))}.`, 'COACH_UNAVAILABLE')
    if (scheduleConflict(occurrence) || groupSessions.some((session) => overlap(occurrence.startsAt, occurrence.endsAt, session.startsAt, session.endsAt) && ((session.coachId ?? session.groupClass.coachId) === input.coachId || session.groupClass.registrations.length > 0))) throw new HttpError(409, `Coach hoặc hội viên bị trùng lịch ngày ${dayText(centerDateOnly(occurrence.startsAt))}.`, 'SCHEDULE_CONFLICT')
  }
  const roomByKey = new Map<string, number>()
  for (const slot of selected) {
    const own = occurrences.filter((occurrence) => occurrence.key === slot.key)
    if (!own.length) continue
    const room = rooms.find((candidate) => own.every((occurrence) => !scheduleConflict(occurrence, candidate.id) && !groupSessions.some((session) => session.roomId === candidate.id && overlap(occurrence.startsAt, occurrence.endsAt, session.startsAt, session.endsAt))))
    if (!room) throw new HttpError(409, `Không còn phòng trống cho ca ${slot.shiftCode} vào thứ ${slot.dayOfWeek || 'CN'}.`, 'ROOM_UNAVAILABLE')
    roomByKey.set(slot.key, room.id)
  }
  const schedules = selected.filter((slot) => roomByKey.has(slot.key)).map((slot) => {
    const own = occurrences.filter((occurrence) => occurrence.key === slot.key)
    const last = own.at(-1)!
    const startTime = AVAILABILITY_SHIFTS.find((shift) => shift.code === slot.shiftCode)!.startTime
    const start = new Date(`1970-01-01T${startTime}:00.000Z`)
    const end = new Date(start.getTime() + course.sessionDurationMinutes * 60_000)
    return { roomId: roomByKey.get(slot.key)!, dayOfWeek: slot.dayOfWeek, startTime: start, endTime: end, effectiveFrom: from, effectiveTo: centerDateOnly(last.startsAt), status: ScheduleStatus.ACTIVE }
  })
  return { course, assignment, from, until, schedules, occurrences: occurrences.map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt, roomId: roomByKey.get(item.key)!, shiftCode: item.shiftCode })), price: assignment.customPrice ?? course.price }
}

export async function previewShiftBooking(input: ShiftBookingInput) {
  const result = await prisma.$transaction((tx) => plan(tx, input))
  return { coachId: input.coachId, startDate: input.startDate, expiryDate: result.until, price: result.price, totalSessions: result.course.totalSessions, occurrences: result.occurrences }
}

export async function createShiftBooking(input: ShiftBookingInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const result = await plan(tx, input)
        const enrollment = await tx.privateCourseEnrollment.create({ data: { memberId: input.memberId, privateCourseId: input.privateCourseId, coachId: input.coachId, purchasedSessions: result.course.totalSessions, remainingSessions: result.course.totalSessions, purchasedPrice: result.price, startDate: result.from, expiryDate: result.until, status: EnrollmentStatus.PENDING_PAYMENT, schedules: { create: result.schedules } } })
        const order = await tx.serviceOrder.create({ data: { memberId: input.memberId, orderNumber: `ORD-PC-${Date.now()}-${Math.floor(Math.random() * 100000)}`, originalAmount: result.price, finalAmount: result.price, status: OrderStatus.PENDING_PAYMENT, expiresAt: new Date(Date.now() + 15 * 60_000) } })
        await tx.orderItem.create({ data: { orderId: order.id, privateEnrollmentId: enrollment.id, itemType: OrderItemType.PRIVATE_COURSE, itemNameSnapshot: result.course.name, unitPrice: result.price, finalAmount: result.price } })
        return { enrollment, order, preview: { occurrences: result.occurrences, totalSessions: result.course.totalSessions } }
      }, { isolationLevel: 'Serializable', timeout: 15_000 })
      if (Number(created.order.finalAmount) <= 0 && await settleZeroAmountOrder(created.order.id)) return { ...created, enrollment: { ...created.enrollment, status: EnrollmentStatus.ACTIVE } }
      return created
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue
      throw error
    }
  }
  throw new HttpError(409, 'Lịch vừa được đặt bởi người khác. Hãy chọn lại ca.', 'SCHEDULE_CONFLICT')
}
