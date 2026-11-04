import type { Prisma } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import { audit } from '../../lib/audit.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import { sendAvailabilityEmail } from './coach-availability.mail.js'
import { AVAILABILITY_SHIFTS, shiftByCode } from './coach-availability.constants.js'
import { validateAvailabilitySelections, type AvailabilitySelectionInput } from './coach-availability.rules.js'

type SelectionInput = AvailabilitySelectionInput
type Db = Prisma.TransactionClient

const DAY_MS = 86_400_000

function monthDate(month: string) {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 7) !== month) {
    throw new HttpError(400, 'Tháng không hợp lệ', 'INVALID_MONTH')
  }
  return date
}

function monthEnd(month: Date) {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
}

function nextMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  return new Date(Date.UTC(year, month, 1))
}

function centerDayOfMonth(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit' }).format(now))
}

function timeValue(value: string) {
  return new Date(`1970-01-01T${value}:00.000Z`)
}

function timeText(value: Date) {
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`
}

function shiftForTime(start: Date, end: Date) {
  const startText = timeText(start)
  const endText = timeText(end)
  return AVAILABILITY_SHIFTS.find((shift) => shift.startTime === startText && shift.endTime === endText)
}

function slotKey(dayOfWeek: number, shiftCode: string) {
  return `${dayOfWeek}:${shiftCode}`
}

function assertSubmissionWindow(month: Date, status: string, now = new Date()) {
  const target = nextMonth(now)
  if (month.getTime() !== target.getTime()) {
    throw new HttpError(409, 'Chỉ được đăng ký availability cho tháng kế tiếp', 'MONTH_NOT_OPEN')
  }
  const deadline = status === 'REJECTED' ? 28 : 25
  if (centerDayOfMonth(now) > deadline) {
    throw new HttpError(409, `Đã quá hạn ngày ${deadline} để gửi lịch`, 'SUBMISSION_DEADLINE_PASSED')
  }
}

function dateAtShift(date: Date, shiftCode: string) {
  const shift = shiftByCode.get(shiftCode)
  if (!shift) throw new HttpError(422, 'Ca làm việc không hợp lệ', 'INVALID_SHIFT')
  const [startHour = 0, startMinute = 0] = shift.startTime.split(':').map(Number)
  const [endHour = 0, endMinute = 0] = shift.endTime.split(':').map(Number)
  const start = new Date(date)
  start.setUTCHours(startHour, startMinute, 0, 0)
  const end = new Date(date)
  end.setUTCHours(endHour, endMinute, 0, 0)
  return { start, end, shift }
}

function datesForWeekday(month: Date, dayOfWeek: number) {
  const end = monthEnd(month)
  const first = new Date(month)
  first.setUTCDate(first.getUTCDate() + (dayOfWeek - first.getUTCDay() + 7) % 7)
  const dates: Date[] = []
  for (const cursor = new Date(first); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) dates.push(new Date(cursor))
  return dates
}

async function assignedSlots(coachId: number, month: Date) {
  const endExclusive = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))
  const [groupSessions, privateSchedules] = await Promise.all([
    prisma.classSession.findMany({
      where: { status: 'SCHEDULED', startsAt: { lt: endExclusive }, endsAt: { gt: month }, groupClass: { coachId } },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.privateCourseSchedule.findMany({
      where: {
        status: 'ACTIVE',
        effectiveFrom: { lt: endExclusive },
        effectiveTo: { gte: month },
        enrollment: { coachId, status: 'ACTIVE' },
      },
      select: { dayOfWeek: true, startTime: true, endTime: true },
    }),
  ])
  const result = new Set<string>()
  for (const session of groupSessions) {
    const shift = shiftForTime(session.startsAt, session.endsAt)
    if (shift) result.add(slotKey(session.startsAt.getUTCDay(), shift.code))
  }
  for (const schedule of privateSchedules) {
    const shift = shiftForTime(schedule.startTime, schedule.endTime)
    if (shift) result.add(slotKey(schedule.dayOfWeek, shift.code))
  }
  return result
}

const submissionInclude = {
  coach: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } } },
  reviewer: { select: { id: true, displayName: true } },
  selections: { orderBy: [{ dayOfWeek: 'asc' as const }, { shiftCode: 'asc' as const }] },
} satisfies Prisma.CoachAvailabilitySubmissionInclude

async function ensureDraft(coachId: number, month: Date) {
  const existing = await prisma.coachAvailabilitySubmission.findUnique({
    where: { coachId_month: { coachId, month } }, include: submissionInclude,
  })
  if (existing) return existing
  const previousMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))
  const previous = await prisma.coachAvailabilitySubmission.findUnique({
    where: { coachId_month: { coachId, month: previousMonth } }, include: { selections: true },
  })
  const locked = await assignedSlots(coachId, month)
  const copied = previous?.status === 'APPROVED'
    ? previous.selections.map(({ dayOfWeek, shiftCode }) => ({ dayOfWeek, shiftCode }))
    : []
  for (const key of locked) {
    const [dayOfWeek = '0', shiftCode = ''] = key.split(':')
    if (!copied.some((item) => item.dayOfWeek === Number(dayOfWeek) && item.shiftCode === shiftCode)) {
      copied.push({ dayOfWeek: Number(dayOfWeek), shiftCode })
    }
  }
  return prisma.coachAvailabilitySubmission.create({
    data: {
      coachId, month, copiedFromId: previous?.status === 'APPROVED' ? previous.id : null,
      selections: { create: copied.map((item) => ({ ...item, isAssigned: locked.has(slotKey(item.dayOfWeek, item.shiftCode)) })) },
    }, include: submissionInclude,
  })
}

async function emailSafely(to: string, subject: string, message: string) {
  try { await sendAvailabilityEmail({ to, subject, message }) } catch (error) { console.error('Availability email failed', error) }
}

export async function getMyCalendar(coachId: number, monthInput: string) {
  const month = monthDate(monthInput)
  const submission = await ensureDraft(coachId, month)
  const locked = await assignedSlots(coachId, month)
  const selections = submission.selections.map((selection) => ({
    ...selection,
    isAssigned: selection.isAssigned || locked.has(slotKey(selection.dayOfWeek, selection.shiftCode)),
  }))
  return {
    month: monthInput,
    timeZone: 'Asia/Ho_Chi_Minh',
    shifts: AVAILABILITY_SHIFTS,
    submission: { ...submission, selections },
    rules: { minimumShifts: 10, minimumDays: 5, minimumPerSelectedDay: 2, maximumPerDay: 4, submitDeadlineDay: 25, resubmitDeadlineDay: 28 },
  }
}

export async function saveDraft(coachId: number, monthInput: string, selections: SelectionInput[]) {
  const month = monthDate(monthInput)
  const current = await ensureDraft(coachId, month)
  assertSubmissionWindow(month, current.status)
  if (!['DRAFT', 'REJECTED'].includes(current.status)) throw new HttpError(409, 'Chỉ có thể sửa lịch nháp hoặc lịch bị từ chối', 'SUBMISSION_NOT_EDITABLE')
  const locked = await assignedSlots(coachId, month)
  for (const key of locked) {
    if (!selections.some((selection) => slotKey(selection.dayOfWeek, selection.shiftCode) === key)) {
      throw new HttpError(409, 'Không thể bỏ ca đã được phân công', 'ASSIGNED_SHIFT_LOCKED')
    }
  }
  const unique = [...new Map(selections.map((selection) => [slotKey(selection.dayOfWeek, selection.shiftCode), selection])).values()]
  for (const selection of unique) if (!shiftByCode.has(selection.shiftCode)) throw new HttpError(422, 'Ca làm việc không hợp lệ', 'INVALID_SHIFT')
  return prisma.$transaction(async (tx) => {
    await tx.coachAvailabilitySelection.deleteMany({ where: { submissionId: current.id } })
    await tx.coachAvailabilitySubmission.update({
      where: { id: current.id },
      data: {
        status: current.status, reviewedAt: null, reviewedById: null,
        selections: { create: unique.map((selection) => ({ ...selection, isAssigned: locked.has(slotKey(selection.dayOfWeek, selection.shiftCode)) })) },
      },
    })
    return tx.coachAvailabilitySubmission.findUniqueOrThrow({ where: { id: current.id }, include: submissionInclude })
  })
}

export async function submit(coachId: number, monthInput: string) {
  const month = monthDate(monthInput)
  const current = await ensureDraft(coachId, month)
  assertSubmissionWindow(month, current.status)
  if (!['DRAFT', 'REJECTED'].includes(current.status)) throw new HttpError(409, 'Lịch này không thể gửi duyệt', 'SUBMISSION_NOT_SUBMITTABLE')
  const summary = validateAvailabilitySelections(current.selections)
  const managers = await prisma.user.findMany({ where: { role: { name: 'CENTER_MANAGER' }, status: 'ACTIVE', deletedAt: null }, select: { id: true, email: true } })
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.coachAvailabilitySubmission.update({
      where: { id: current.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), revision: { increment: current.status === 'REJECTED' ? 1 : 0 }, rejectionReason: null },
      include: submissionInclude,
    })
    await notify(tx, { userIds: managers.map((manager) => manager.id), type: NOTIFICATION_TYPES.COACH_AVAILABILITY, title: 'Coach gửi lịch availability', content: `${result.coach.user.displayName} đã gửi lịch tháng ${monthInput} để duyệt.` })
    await audit(tx, { actorId: coachId, action: 'AVAILABILITY_SUBMITTED', entityType: 'CoachAvailabilitySubmission', entityId: result.id, newData: { month: monthInput, revision: result.revision, ...summary } })
    return result
  })
  await Promise.all(managers.map((manager) => emailSafely(manager.email, 'Lịch availability mới cần duyệt', `${updated.coach.user.displayName} đã gửi lịch availability tháng ${monthInput}.`)))
  return updated
}

export async function listSubmissions(filters: { month?: string; status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'; coachId?: number }) {
  return prisma.coachAvailabilitySubmission.findMany({
    where: { month: filters.month ? monthDate(filters.month) : undefined, status: filters.status, coachId: filters.coachId },
    include: submissionInclude,
    orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
  })
}

export async function getSubmission(id: number) {
  const submission = await prisma.coachAvailabilitySubmission.findUnique({ where: { id }, include: submissionInclude })
  if (!submission) throw new HttpError(404, 'Không tìm thấy lịch availability', 'SUBMISSION_NOT_FOUND')
  return submission
}

export async function reviewSubmission(id: number, managerId: number, input: { decision: 'APPROVE' | 'REJECT'; reason?: string }) {
  const current = await getSubmission(id)
  if (current.status !== 'SUBMITTED') throw new HttpError(409, 'Chỉ lịch đang chờ duyệt mới được xử lý', 'SUBMISSION_NOT_PENDING')
  if (input.decision === 'REJECT') {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.coachAvailabilitySubmission.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: input.reason!, reviewedAt: new Date(), reviewedById: managerId }, include: submissionInclude })
      await notify(tx, { userIds: [current.coachId], type: NOTIFICATION_TYPES.COACH_AVAILABILITY, title: 'Lịch availability cần chỉnh sửa', content: `Lịch tháng ${current.month.toISOString().slice(0, 7)} bị từ chối: ${input.reason}` })
      await audit(tx, { actorId: managerId, action: 'AVAILABILITY_REJECTED', entityType: 'CoachAvailabilitySubmission', entityId: id, newData: { reason: input.reason } })
      return result
    })
    await emailSafely(current.coach.user.email, 'Lịch availability cần chỉnh sửa', `Lịch của bạn bị từ chối. Lý do: ${input.reason}`)
    return updated
  }
  const summary = validateAvailabilitySelections(current.selections)
  const locked = await assignedSlots(current.coachId, current.month)
  for (const key of locked) {
    if (!current.selections.some((selection) => slotKey(selection.dayOfWeek, selection.shiftCode) === key)) {
      throw new HttpError(409, 'Lịch gửi duyệt thiếu ca đã được phân công', 'ASSIGNED_SHIFT_MISSING')
    }
  }
  const month = current.month
  const end = monthEnd(month)
  const approved = await prisma.$transaction(async (tx) => {
    const selectionIds = current.selections.map((selection) => selection.approvedAvailabilityId).filter((value): value is number => value !== null)
    if (selectionIds.length) await tx.coachAvailability.deleteMany({ where: { id: { in: selectionIds } } })
    await tx.coachAvailability.deleteMany({ where: { coachId: current.coachId, effectiveFrom: month, effectiveTo: end } })
    for (const selection of current.selections) {
      const shift = shiftByCode.get(selection.shiftCode)!
      const availability = await tx.coachAvailability.create({ data: { coachId: current.coachId, dayOfWeek: selection.dayOfWeek, startTime: timeValue(shift.startTime), endTime: timeValue(shift.endTime), effectiveFrom: month, effectiveTo: end, status: 'AVAILABLE' } })
      await tx.coachAvailabilitySelection.update({ where: { id: selection.id }, data: { approvedAvailabilityId: availability.id } })
    }
    const result = await tx.coachAvailabilitySubmission.update({ where: { id }, data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: managerId, rejectionReason: null }, include: submissionInclude })
    await notify(tx, { userIds: [current.coachId], type: NOTIFICATION_TYPES.COACH_AVAILABILITY, title: 'Lịch availability đã được duyệt', content: `Lịch tháng ${month.toISOString().slice(0, 7)} đã có hiệu lực để xếp lớp.` })
    await audit(tx, { actorId: managerId, action: 'AVAILABILITY_APPROVED', entityType: 'CoachAvailabilitySubmission', entityId: id, newData: summary })
    return result
  })
  await emailSafely(current.coach.user.email, 'Lịch availability đã được duyệt', `Lịch tháng ${month.toISOString().slice(0, 7)} của bạn đã được duyệt.`)
  return approved
}

export async function createChangeRequest(coachId: number, input: { month: string; oldDayOfWeek: number; oldShiftCode: string; newDayOfWeek: number; newShiftCode: string; reason: string }) {
  const month = monthDate(input.month)
  const submission = await prisma.coachAvailabilitySubmission.findUnique({ where: { coachId_month: { coachId, month } }, include: { selections: true } })
  if (!submission || submission.status !== 'APPROVED') throw new HttpError(409, 'Chỉ lịch đã duyệt mới được yêu cầu đổi ca', 'SUBMISSION_NOT_APPROVED')
  const oldSelection = submission.selections.find((selection) => selection.dayOfWeek === input.oldDayOfWeek && selection.shiftCode === input.oldShiftCode)
  const locked = await assignedSlots(coachId, month)
  if (!oldSelection || !locked.has(slotKey(input.oldDayOfWeek, input.oldShiftCode))) throw new HttpError(409, 'Chỉ ca đã phân công mới cần gửi yêu cầu đổi', 'SHIFT_NOT_ASSIGNED')
  if (submission.selections.some((selection) => selection.dayOfWeek === input.newDayOfWeek && selection.shiftCode === input.newShiftCode)) throw new HttpError(409, 'Ca thay thế đã có trong availability', 'REPLACEMENT_ALREADY_SELECTED')
  const pending = await prisma.coachAvailabilityChangeRequest.findFirst({ where: { coachId, submissionId: submission.id, oldDayOfWeek: input.oldDayOfWeek, oldShiftCode: input.oldShiftCode, status: 'SUBMITTED' } })
  if (pending) throw new HttpError(409, 'Ca này đã có yêu cầu đổi đang chờ duyệt', 'CHANGE_REQUEST_PENDING')
  const managers = await prisma.user.findMany({ where: { role: { name: 'CENTER_MANAGER' }, status: 'ACTIVE', deletedAt: null }, select: { id: true, email: true } })
  const created = await prisma.$transaction(async (tx) => {
    const created = await tx.coachAvailabilityChangeRequest.create({ data: { coachId, submissionId: submission.id, oldDayOfWeek: input.oldDayOfWeek, oldShiftCode: input.oldShiftCode, newDayOfWeek: input.newDayOfWeek, newShiftCode: input.newShiftCode, reason: input.reason } })
    await notify(tx, { userIds: managers.map((manager) => manager.id), type: NOTIFICATION_TYPES.COACH_AVAILABILITY, title: 'Yêu cầu đổi ca availability', content: `Coach #${coachId} yêu cầu đổi ${input.oldShiftCode} sang ${input.newShiftCode}.` })
    await audit(tx, { actorId: coachId, action: 'AVAILABILITY_CHANGE_REQUESTED', entityType: 'CoachAvailabilityChangeRequest', entityId: created.id, newData: input })
    return created
  })
  await Promise.all(managers.map((manager) => emailSafely(manager.email, 'Yêu cầu đổi ca availability', `Coach #${coachId} vừa gửi yêu cầu đổi ca ${input.oldShiftCode} sang ${input.newShiftCode}.`)))
  return created
}

export async function listMyChangeRequests(coachId: number) {
  return prisma.coachAvailabilityChangeRequest.findMany({ where: { coachId }, include: { reviewer: { select: { id: true, displayName: true } }, submission: true }, orderBy: { submittedAt: 'desc' } })
}

export async function listChangeRequests(filters: { status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED'; coachId?: number }) {
  return prisma.coachAvailabilityChangeRequest.findMany({ where: filters, include: { coach: { include: { user: { select: { displayName: true, email: true } } } }, submission: true, reviewer: { select: { displayName: true } } }, orderBy: { submittedAt: 'desc' } })
}

async function assertGroupMoveFree(tx: Db, session: { id: number; roomId: number; groupClass: { coachId: number; registrations: { memberId: number }[] } }, start: Date, end: Date) {
  const memberIds = session.groupClass.registrations.map((registration) => registration.memberId)
  const [groupConflict, privateConflict] = await Promise.all([
    tx.classSession.findFirst({ where: { id: { not: session.id }, status: 'SCHEDULED', startsAt: { lt: end }, endsAt: { gt: start }, OR: [{ roomId: session.roomId }, { groupClass: { coachId: session.groupClass.coachId } }, { groupClass: { registrations: { some: { memberId: { in: memberIds }, status: 'CONFIRMED' } } } }] } }),
    tx.privateCourseSchedule.findFirst({ where: { status: 'ACTIVE', dayOfWeek: start.getUTCDay(), effectiveFrom: { lte: start }, effectiveTo: { gte: start }, OR: [{ roomId: session.roomId }, { enrollment: { coachId: session.groupClass.coachId } }, { enrollment: { memberId: { in: memberIds } } }], startTime: { lt: timeValue(timeText(end)) }, endTime: { gt: timeValue(timeText(start)) } } }),
  ])
  const room = await tx.room.findUnique({ where: { id: session.roomId }, select: { status: true } })
  if (!room || room.status !== 'AVAILABLE' || groupConflict || privateConflict) throw new HttpError(409, 'Coach, Member hoặc phòng cũ bị trùng tại ca mới', 'CHANGE_SCHEDULE_CONFLICT')
}

async function assertPrivateMoveFree(tx: Db, schedule: { id: number; roomId: number; enrollment: { coachId: number; memberId: number } }, start: Date, end: Date) {
  const [groupConflict, privateConflict] = await Promise.all([
    tx.classSession.findFirst({ where: { status: 'SCHEDULED', startsAt: { lt: end }, endsAt: { gt: start }, OR: [{ roomId: schedule.roomId }, { groupClass: { coachId: schedule.enrollment.coachId } }, { groupClass: { registrations: { some: { memberId: schedule.enrollment.memberId, status: 'CONFIRMED' } } } }] } }),
    tx.privateCourseSchedule.findFirst({ where: { id: { not: schedule.id }, status: 'ACTIVE', dayOfWeek: start.getUTCDay(), effectiveFrom: { lte: start }, effectiveTo: { gte: start }, OR: [{ roomId: schedule.roomId }, { enrollment: { coachId: schedule.enrollment.coachId } }, { enrollment: { memberId: schedule.enrollment.memberId } }], startTime: { lt: timeValue(timeText(end)) }, endTime: { gt: timeValue(timeText(start)) } } }),
  ])
  const room = await tx.room.findUnique({ where: { id: schedule.roomId }, select: { status: true } })
  if (!room || room.status !== 'AVAILABLE' || groupConflict || privateConflict) throw new HttpError(409, 'Coach, Member hoặc phòng cũ bị trùng tại ca mới', 'CHANGE_SCHEDULE_CONFLICT')
}

export async function reviewChangeRequest(id: number, managerId: number, input: { decision: 'APPROVE' | 'REJECT'; reason?: string }) {
  const request = await prisma.coachAvailabilityChangeRequest.findUnique({ where: { id }, include: { coach: { include: { user: true } }, submission: { include: { selections: true } } } })
  if (!request) throw new HttpError(404, 'Không tìm thấy yêu cầu đổi ca', 'CHANGE_REQUEST_NOT_FOUND')
  if (request.status !== 'SUBMITTED') throw new HttpError(409, 'Yêu cầu đã được xử lý', 'CHANGE_REQUEST_PROCESSED')
  if (input.decision === 'REJECT') {
    const rejected = await prisma.$transaction(async (tx) => {
      const updated = await tx.coachAvailabilityChangeRequest.update({ where: { id }, data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: managerId, rejectionReason: input.reason! } })
      await notify(tx, { userIds: [request.coachId], type: NOTIFICATION_TYPES.COACH_AVAILABILITY, title: 'Yêu cầu đổi ca bị từ chối', content: input.reason! })
      await audit(tx, { actorId: managerId, action: 'AVAILABILITY_CHANGE_REJECTED', entityType: 'CoachAvailabilityChangeRequest', entityId: id, newData: { reason: input.reason } })
      return updated
    })
    await emailSafely(request.coach.user.email, 'Yêu cầu đổi ca bị từ chối', input.reason!)
    return rejected
  }
  const replacementSelections = request.submission.selections.map((selection) => selection.id === request.submission.selections.find((item) => item.dayOfWeek === request.oldDayOfWeek && item.shiftCode === request.oldShiftCode)?.id ? { dayOfWeek: request.newDayOfWeek, shiftCode: request.newShiftCode } : { dayOfWeek: selection.dayOfWeek, shiftCode: selection.shiftCode })
  validateAvailabilitySelections(replacementSelections)
  const month = request.submission.month
  const endExclusive = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))
  const cutoff = new Date(Date.now() + 7 * DAY_MS)
  const oldShift = shiftByCode.get(request.oldShiftCode)!
  const newShift = shiftByCode.get(request.newShiftCode)!
  const result = await prisma.$transaction(async (tx) => {
    const sessions = await tx.classSession.findMany({ where: { status: 'SCHEDULED', startsAt: { gte: cutoff, lt: endExclusive }, groupClass: { coachId: request.coachId } }, include: { groupClass: { include: { registrations: { where: { status: 'CONFIRMED' }, select: { memberId: true } } } } } })
    const matching = sessions.filter((session) => session.startsAt.getUTCDay() === request.oldDayOfWeek && timeText(session.startsAt) === oldShift.startTime && timeText(session.endsAt) === oldShift.endTime)
    const movedMemberIds = new Set<number>()
    for (const session of matching) {
      const delta = request.newDayOfWeek - request.oldDayOfWeek
      const targetDate = new Date(session.startsAt.getTime() + delta * DAY_MS)
      const { start, end } = dateAtShift(targetDate, request.newShiftCode)
      if (start < cutoff || start < month || start >= endExclusive) continue
      await assertGroupMoveFree(tx, session, start, end)
      await tx.classSession.update({ where: { id: session.id }, data: { startsAt: start, endsAt: end } })
      await tx.scheduleChange.create({ data: { classSessionId: session.id, changedById: managerId, oldStartsAt: session.startsAt, newStartsAt: start, oldRoomId: session.roomId, newRoomId: session.roomId, reason: request.reason } })
      session.groupClass.registrations.forEach((registration) => movedMemberIds.add(registration.memberId))
    }
    const privateSchedules = await tx.privateCourseSchedule.findMany({
      where: {
        status: 'ACTIVE', dayOfWeek: request.oldDayOfWeek,
        startTime: timeValue(oldShift.startTime), endTime: timeValue(oldShift.endTime),
        effectiveFrom: { lt: endExclusive }, effectiveTo: { gte: month },
        enrollment: { coachId: request.coachId, status: 'ACTIVE' },
      },
      include: { enrollment: { select: { coachId: true, memberId: true } }, exceptions: true },
    })
    let movedPrivateOccurrences = 0
    let unchangedWithinSevenDays = 0
    for (const schedule of privateSchedules) {
      for (const occurrence of datesForWeekday(month, request.oldDayOfWeek)) {
        if (occurrence < schedule.effectiveFrom || occurrence > schedule.effectiveTo) continue
        const oldOccurrence = dateAtShift(occurrence, request.oldShiftCode)
        if (oldOccurrence.start < cutoff) { unchangedWithinSevenDays += 1; continue }
        if (schedule.exceptions.some((exception) => exception.sessionDate.getTime() === occurrence.getTime())) continue
        const targetDate = new Date(occurrence.getTime() + (request.newDayOfWeek - request.oldDayOfWeek) * DAY_MS)
        const target = dateAtShift(targetDate, request.newShiftCode)
        if (target.start < month || target.start >= endExclusive) continue
        await assertPrivateMoveFree(tx, schedule, target.start, target.end)
        await tx.privateCourseScheduleException.create({ data: { scheduleId: schedule.id, sessionDate: occurrence, action: 'RESCHEDULED', rescheduledStartsAt: target.start, rescheduledEndsAt: target.end, newRoomId: schedule.roomId, reason: request.reason } })
        movedMemberIds.add(schedule.enrollment.memberId)
        movedPrivateOccurrences += 1
      }
    }
    const oldSelection = request.submission.selections.find((selection) => selection.dayOfWeek === request.oldDayOfWeek && selection.shiftCode === request.oldShiftCode)!
    const oldAvailabilityId = oldSelection.approvedAvailabilityId
    if (oldAvailabilityId) await tx.coachAvailability.delete({ where: { id: oldAvailabilityId } })
    const availability = await tx.coachAvailability.create({ data: { coachId: request.coachId, dayOfWeek: request.newDayOfWeek, startTime: timeValue(newShift.startTime), endTime: timeValue(newShift.endTime), effectiveFrom: month, effectiveTo: monthEnd(month), status: 'AVAILABLE' } })
    await tx.coachAvailabilitySelection.update({ where: { id: oldSelection.id }, data: { dayOfWeek: request.newDayOfWeek, shiftCode: request.newShiftCode, approvedAvailabilityId: availability.id, isAssigned: matching.length > 0 } })
    const updated = await tx.coachAvailabilityChangeRequest.update({ where: { id }, data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: managerId, affectedSummary: { movedGroupSessions: matching.length, movedPrivateOccurrences, unchangedWithinSevenDays } } })
    await notify(tx, { userIds: [request.coachId, ...movedMemberIds], type: NOTIFICATION_TYPES.SCHEDULE_CHANGE, title: 'Lịch học đã được chuyển ca', content: `Ca ${request.oldShiftCode} đã được chuyển sang ${request.newShiftCode}. Các buổi trong 7 ngày tới giữ nguyên.` })
    await audit(tx, { actorId: managerId, action: 'AVAILABILITY_CHANGE_APPROVED', entityType: 'CoachAvailabilityChangeRequest', entityId: id, newData: updated.affectedSummary })
    return { updated, memberIds: [...movedMemberIds] }
  })
  const affected = result.updated.affectedSummary as { movedGroupSessions?: number; movedPrivateOccurrences?: number } | null
  const memberEmails = await prisma.user.findMany({ where: { id: { in: result.memberIds } }, select: { email: true } })
  await Promise.all([
    emailSafely(request.coach.user.email, 'Yêu cầu đổi ca đã được duyệt', `Ca ${request.oldShiftCode} đã được đổi sang ${request.newShiftCode}.`),
    ...memberEmails.map((member) => emailSafely(member.email, 'Lịch học Sportigo đã thay đổi', `Một buổi học của bạn đã được chuyển lịch. ${affected?.movedGroupSessions ?? 0} buổi lớp nhóm và ${affected?.movedPrivateOccurrences ?? 0} buổi 1–1 đã được cập nhật.`)),
  ])
  return result.updated
}

