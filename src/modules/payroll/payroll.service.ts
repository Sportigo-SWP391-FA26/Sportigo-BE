import { Prisma, type PayrollEntry } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { HttpError } from '../../lib/http-error.js'
import { monthRange, monthSchema, type compensationSchema, type recurringItemSchema } from './payroll.schema.js'
import { centerDateTime, wallClock } from '../../lib/center-time.js'
import { audit } from '../../lib/audit.js'
import { calculatePay } from './payroll.calc.js'
import type { z } from 'zod'

type CompensationInput = z.infer<typeof compensationSchema>
type RecurringInput = z.infer<typeof recurringItemSchema>
const money = (value: Prisma.Decimal | number) => Number(value)
const roundMoney = (value: number) => Math.round(value)
const activeMonth = (from: string, to: string | null, month: string) => from <= month && (!to || to >= month)

function privateOccurrences(schedules: Awaited<ReturnType<typeof loadPrivateSchedules>>, start: Date, endExclusive: Date) {
  const result: { coachId: number; scheduleId: number; startsAt: Date; attendanceStatus: string | null }[] = []
  const fromDay = new Date(start.getTime() + 7 * 3_600_000)
  const lastDay = new Date(endExclusive.getTime() + 7 * 3_600_000 - 1)
  for (const schedule of schedules) {
    for (let day = new Date(Date.UTC(fromDay.getUTCFullYear(), fromDay.getUTCMonth(), fromDay.getUTCDate())); day <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
      if (day < schedule.effectiveFrom || day > schedule.effectiveTo || day.getUTCDay() !== schedule.dayOfWeek) continue
      const exception = schedule.exceptions.find((item) => item.sessionDate.getTime() === day.getTime())
      if (exception?.action === 'CANCELLED') continue
      const startsAt = exception?.rescheduledStartsAt ?? centerDateTime(day, wallClock(schedule.startTime))
      if (startsAt < start || startsAt >= endExclusive) continue
      const attendance = schedule.attendances.find((item) => item.sessionDate.getTime() === day.getTime())
      result.push({ coachId: attendance?.markedById ?? exception?.newCoachId ?? schedule.enrollment.coachId, scheduleId: schedule.id, startsAt, attendanceStatus: attendance?.status ?? null })
    }
  }
  return result
}

function loadPrivateSchedules(start: Date, endExclusive: Date) {
  const fromDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const toDate = new Date(Date.UTC(endExclusive.getUTCFullYear(), endExclusive.getUTCMonth(), endExclusive.getUTCDate()))
  return prisma.privateCourseSchedule.findMany({ where: { status: 'ACTIVE', effectiveFrom: { lte: toDate }, effectiveTo: { gte: fromDate } }, include: { enrollment: { select: { coachId: true } }, exceptions: { where: { OR: [{ sessionDate: { gte: fromDate, lte: toDate } }, { rescheduledStartsAt: { gte: start, lt: endExclusive } }] } }, attendances: { where: { startsAt: { gte: start, lt: endExclusive } } } } })
}

async function staffUser(staffId: number) {
  const user = await prisma.user.findUnique({ where: { id: staffId }, include: { role: true, coach: true, receptionist: true } })
  if (!user || user.deletedAt || !['COACH', 'RECEPTIONIST'].includes(user.role.name)) throw new HttpError(404, 'Không tìm thấy nhân sự', 'STAFF_NOT_FOUND')
  return user
}

export async function listCompensation(staffId: number) {
  await staffUser(staffId)
  return prisma.payrollCompensation.findMany({ where: { staffId }, orderBy: { effectiveFromMonth: 'desc' } })
}

export async function setCompensation(staffId: number, input: CompensationInput, managerId: number) {
  await staffUser(staffId)
  return prisma.$transaction(async (tx) => {
    const next = await tx.payrollCompensation.findFirst({ where: { staffId, effectiveFromMonth: { gt: input.effectiveFromMonth } }, orderBy: { effectiveFromMonth: 'asc' } })
    if (next && (!input.effectiveToMonth || input.effectiveToMonth >= next.effectiveFromMonth)) throw new HttpError(409, 'Khoảng hiệu lực lương cơ bản chồng với cấu hình tháng sau', 'PAYROLL_COMPENSATION_OVERLAP')
    const current = await tx.payrollCompensation.findFirst({ where: { staffId, effectiveFromMonth: { lte: input.effectiveFromMonth }, OR: [{ effectiveToMonth: null }, { effectiveToMonth: { gte: input.effectiveFromMonth } }] }, orderBy: { effectiveFromMonth: 'desc' } })
    if (current && current.effectiveFromMonth !== input.effectiveFromMonth) {
      const year = Number(input.effectiveFromMonth.slice(0, 4))
      const effectiveMonth = Number(input.effectiveFromMonth.slice(5, 7))
      const previousMonth = new Date(Date.UTC(year, effectiveMonth - 1, 0)).toISOString().slice(0, 7)
      await tx.payrollCompensation.update({ where: { id: current.id }, data: { effectiveToMonth: previousMonth } })
    }
    const result = await tx.payrollCompensation.upsert({ where: { staffId_effectiveFromMonth: { staffId, effectiveFromMonth: input.effectiveFromMonth } }, create: { staffId, ...input }, update: { baseSalary: input.baseSalary, effectiveToMonth: input.effectiveToMonth ?? null } })
    await audit(tx, { actorId: managerId, action: 'PAYROLL_COMPENSATION_SET', entityType: 'PAYROLL_COMPENSATION', entityId: result.id, newData: { staffId, baseSalary: input.baseSalary, effectiveFromMonth: input.effectiveFromMonth } })
    return result
  })
}

export async function listRecurringItems(staffId: number) {
  await staffUser(staffId)
  return prisma.payrollRecurringItem.findMany({ where: { staffId }, orderBy: { id: 'desc' } })
}

export async function createRecurringItem(staffId: number, input: RecurringInput, managerId: number) {
  await staffUser(staffId)
  return prisma.$transaction(async (tx) => {
    const result = await tx.payrollRecurringItem.create({ data: { staffId, ...input } })
    await audit(tx, { actorId: managerId, action: 'PAYROLL_RECURRING_CREATED', entityType: 'PAYROLL_RECURRING_ITEM', entityId: result.id, newData: { staffId, name: input.name, kind: input.kind, amount: input.amount } })
    return result
  })
}

export async function updateRecurringItem(id: number, input: Partial<RecurringInput>, managerId: number) {
  const existing = await prisma.payrollRecurringItem.findUnique({ where: { id } })
  if (!existing) throw new HttpError(404, 'Không tìm thấy khoản lương', 'PAYROLL_ITEM_NOT_FOUND')
  const from = input.effectiveFromMonth ?? existing.effectiveFromMonth
  const to = input.effectiveToMonth === undefined ? existing.effectiveToMonth : input.effectiveToMonth
  if (to && to < from) throw new HttpError(400, 'Tháng kết thúc phải từ tháng bắt đầu trở đi', 'INVALID_EFFECTIVE_MONTH')
  return prisma.$transaction(async (tx) => {
    const result = await tx.payrollRecurringItem.update({ where: { id }, data: input })
    await audit(tx, { actorId: managerId, action: 'PAYROLL_RECURRING_UPDATED', entityType: 'PAYROLL_RECURRING_ITEM', entityId: id, newData: input })
    return result
  })
}

export async function listPeriods() {
  return prisma.payrollPeriod.findMany({ orderBy: { month: 'desc' }, include: { _count: { select: { entries: true } } } })
}

export async function getPeriod(month: string) {
  monthSchema.parse(month)
  const period = await prisma.payrollPeriod.findUnique({ where: { month }, include: { entries: { orderBy: { staffName: 'asc' } } } })
  if (!period) throw new HttpError(404, 'Chưa có bảng lương tháng này', 'PAYROLL_PERIOD_NOT_FOUND')
  return period
}

// Rebuild is allowed only while draft. An approved period is a frozen financial snapshot.
export async function buildPeriod(month: string, managerId: number, now = new Date()) {
  const range = monthRange(month)
  if (range.endExclusive > now) throw new HttpError(409, 'Chỉ lập lương sau khi tháng đã kết thúc', 'PAYROLL_MONTH_NOT_FINISHED')
  const existing = await prisma.payrollPeriod.findUnique({ where: { month } })
  if (existing?.status === 'APPROVED') throw new HttpError(409, 'Bảng lương đã duyệt, không thể tính lại', 'PAYROLL_APPROVED')
  const staff = await prisma.user.findMany({ where: { role: { name: { in: ['COACH', 'RECEPTIONIST'] } }, deletedAt: null }, include: { role: true, coach: true, receptionist: true, payrollCompensations: true, payrollRecurringItems: true } })
  const coachIds = staff.filter((user) => user.role.name === 'COACH').map((user) => user.id)
  const receptionistIds = staff.filter((user) => user.role.name === 'RECEPTIONIST').map((user) => user.id)
  const [sessions, shifts, privateSchedules, groupAbsences, privateAbsences, priorCredits, approvedEntries, privateAttendances] = await Promise.all([
    prisma.classSession.findMany({ where: { startsAt: { gte: range.start, lt: range.endExclusive }, OR: [{ coachId: { in: coachIds } }, { coachId: null, groupClass: { coachId: { in: coachIds } } }] }, include: { groupClass: { select: { coachId: true } }, attendances: { select: { id: true } }, absenceRequest: true, makeupFor: true } }),
    prisma.staffShift.findMany({ where: { staffId: { in: receptionistIds }, status: 'SCHEDULED', startsAt: { gte: range.start, lt: range.endExclusive } }, include: { adjustments: { where: { status: 'PENDING' }, select: { id: true } } } }),
    loadPrivateSchedules(range.start, range.endExclusive),
    prisma.coachAbsenceRequest.findMany({ where: { coachId: { in: coachIds }, status: 'APPROVED', OR: [{ session: { startsAt: { gte: range.start, lt: range.endExclusive } } }, { makeupSession: { startsAt: { gte: range.start, lt: range.endExclusive }, status: 'COMPLETED' } }] }, include: { session: true, makeupSession: true } }),
    prisma.privateCoachAbsenceRequest.findMany({ where: { coachId: { in: coachIds }, status: 'APPROVED', OR: [{ originalStartsAt: { gte: range.start, lt: range.endExclusive } }, { makeupStartsAt: { gte: range.start, lt: range.endExclusive } }] } }),
    prisma.payrollMakeupCredit.findMany({ where: { staffId: { in: coachIds } }, select: { sourceKind: true, sourceId: true } }),
    prisma.payrollEntry.findMany({ where: { staffId: { in: coachIds }, period: { status: 'APPROVED', month: { lt: month } } }, include: { period: { select: { month: true } } } }),
    prisma.privateCourseAttendance.findMany({ where: { startsAt: { gte: range.start, lt: range.endExclusive } }, select: { scheduleId: true, startsAt: true, markedById: true, status: true } }),
  ])
  const credited = new Set(priorCredits.map((v) => `${v.sourceKind}:${v.sourceId}`))
  const privateSlots = privateOccurrences(privateSchedules, range.start, range.endExclusive)
  for (const attendance of privateAttendances) {
    const existingSlot = privateSlots.find((slot) => slot.scheduleId === attendance.scheduleId && slot.startsAt.getTime() === attendance.startsAt.getTime())
    if (existingSlot) { existingSlot.coachId = attendance.markedById; existingSlot.attendanceStatus = attendance.status }
    else privateSlots.push({ scheduleId: attendance.scheduleId, startsAt: attendance.startsAt, coachId: attendance.markedById, attendanceStatus: attendance.status })
  }
  const rows = staff.map((user) => {
    const compensation = user.payrollCompensations.filter((v) => activeMonth(v.effectiveFromMonth, v.effectiveToMonth, month)).sort((a, b) => b.effectiveFromMonth.localeCompare(a.effectiveFromMonth))[0]
    const items = user.payrollRecurringItems.filter((v) => v.isActive && activeMonth(v.effectiveFromMonth, v.effectiveToMonth, month))
    const ownSessions = sessions.filter((v) => (v.coachId ?? v.groupClass.coachId) === user.id && v.status !== 'CANCELLED')
    const ownShifts = shifts.filter((v) => v.staffId === user.id)
    const ownPrivate = privateSlots.filter((v) => v.coachId === user.id)
    const absences = groupAbsences.filter((v) => v.coachId === user.id && v.session.startsAt >= range.start && v.session.startsAt < range.endExclusive)
    const ownPrivateAbsences = privateAbsences.filter((v) => v.coachId === user.id && v.originalStartsAt >= range.start && v.originalStartsAt < range.endExclusive)
    const scheduledUnits = user.role.name === 'COACH' ? ownSessions.length + absences.length + ownPrivateAbsences.length + ownPrivate.length : ownShifts.length
    const absentUnits = user.role.name === 'COACH' ? absences.length + ownPrivateAbsences.length : ownShifts.filter((v) => !v.clockInAt || !v.clockOutAt).length
    const baseSalary = compensation ? money(compensation.baseSalary) : 0
    const unitRate = scheduledUnits ? baseSalary / scheduledUnits : 0
    const absenceDeduction = calculatePay({ baseSalary, scheduledUnits, absentUnits, allowanceTotal: 0, deductionTotal: 0, makeupCredit: 0 }).absenceDeduction
    const missingPriorPay: number[] = []
    const groupCredits = groupAbsences.filter((v) => v.coachId === user.id && v.makeupSession?.status === 'COMPLETED' && v.makeupSession.startsAt >= range.start && v.makeupSession.startsAt < range.endExclusive && !credited.has(`GROUP:${v.id}`)).flatMap((v) => {
      const originalMonth = new Date(v.session.startsAt.getTime() + 7 * 3_600_000).toISOString().slice(0, 7)
      if (originalMonth === month) return [{ sourceKind: 'GROUP', sourceId: v.id, amount: roundMoney(unitRate) }]
      const previous = approvedEntries.find((entry) => entry.staffId === user.id && entry.period.month === originalMonth)
      if (!previous || !previous.absentUnits) { missingPriorPay.push(v.id); return [] }
      return [{ sourceKind: 'GROUP', sourceId: v.id, amount: roundMoney(money(previous.absenceDeduction) / previous.absentUnits) }]
    })
    const privateCredits = privateAbsences.filter((v) => v.coachId === user.id && v.makeupStartsAt && v.makeupStartsAt >= range.start && v.makeupStartsAt < range.endExclusive && !credited.has(`PRIVATE:${v.id}`) && privateAttendances.some((attendance) => attendance.status === 'CONFIRMED' && attendance.scheduleId === v.scheduleId && attendance.startsAt.getTime() === v.makeupStartsAt?.getTime())).flatMap((v) => {
      const originalMonth = new Date(v.originalStartsAt.getTime() + 7 * 3_600_000).toISOString().slice(0, 7)
      if (originalMonth === month) return [{ sourceKind: 'PRIVATE', sourceId: v.id, amount: roundMoney(unitRate) }]
      const previous = approvedEntries.find((entry) => entry.staffId === user.id && entry.period.month === originalMonth)
      if (!previous || !previous.absentUnits) { missingPriorPay.push(v.id); return [] }
      return [{ sourceKind: 'PRIVATE', sourceId: v.id, amount: roundMoney(money(previous.absenceDeduction) / previous.absentUnits) }]
    })
    const makeupCredits = [...groupCredits, ...privateCredits]
    const makeupCredit = makeupCredits.reduce((sum, v) => sum + v.amount, 0)
    const allowanceTotal = items.filter((v) => v.kind === 'ALLOWANCE').reduce((sum, v) => sum + money(v.amount), 0)
    const deductionTotal = items.filter((v) => v.kind === 'DEDUCTION').reduce((sum, v) => sum + money(v.amount), 0)
    const reviewIssues = [
      ...(!compensation ? ['Chưa cấu hình lương cơ bản'] : []),
      ...ownSessions.filter((v) => v.status === 'SCHEDULED' || (v.status === 'COMPLETED' && !v.attendances.length)).map((v) => `Buổi nhóm #${v.id} chưa hoàn tất điểm danh`),
      ...ownPrivate.filter((v) => v.attendanceStatus !== 'CONFIRMED').map((v) => `Buổi 1-1 lịch #${v.scheduleId} ${v.startsAt.toISOString()}: ${v.attendanceStatus ?? 'chưa điểm danh'}`),
      ...ownShifts.flatMap((v) => v.adjustments.map(() => `Ca #${v.id} còn yêu cầu sửa chấm công`)),
      ...missingPriorPay.map((id) => `Buổi bù #${id} chưa có bảng lương kỳ gốc đã duyệt`),
    ]
    return { staffId: user.id, role: user.role.name, staffName: user.displayName, staffCode: user.coach?.coachCode ?? user.receptionist?.staffCode ?? null, baseSalary, scheduledUnits, absentUnits, absenceDeduction, makeupCredit, allowanceTotal, deductionTotal, netAmount: calculatePay({ baseSalary, scheduledUnits, absentUnits, makeupCredit, allowanceTotal, deductionTotal }).netAmount, lineItems: items.map((v) => ({ id: v.id, name: v.name, kind: v.kind, amount: money(v.amount) })), workEvidence: { groupSessionIds: ownSessions.map((v) => v.id), shiftIds: ownShifts.map((v) => v.id), privateScheduleIds: ownPrivate.map((v) => v.scheduleId), absenceRequestIds: absences.map((v) => v.id), privateAbsenceRequestIds: ownPrivateAbsences.map((v) => v.id), makeupCredits }, reviewIssues }
  })
  return prisma.$transaction(async (tx) => {
    const period = existing ?? await tx.payrollPeriod.create({ data: { month, createdById: managerId } })
    await tx.payrollEntry.deleteMany({ where: { periodId: period.id } })
    for (const row of rows) await tx.payrollEntry.create({ data: { ...row, periodId: period.id } })
    await audit(tx, { actorId: managerId, action: 'PAYROLL_PERIOD_BUILT', entityType: 'PAYROLL_PERIOD', entityId: period.id, newData: { month, entries: rows.length } })
    return tx.payrollPeriod.findUniqueOrThrow({ where: { id: period.id }, include: { entries: true } })
  }, { isolationLevel: 'Serializable' })
}

export async function approvePeriod(month: string, managerId: number) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.findUnique({ where: { month }, include: { entries: true } })
    if (!period || period.status !== 'DRAFT') throw new HttpError(409, 'Bảng lương không ở trạng thái nháp', 'PAYROLL_NOT_DRAFT')
    if (period.entries.some((entry) => (entry.reviewIssues as string[]).length)) throw new HttpError(409, 'Còn mục cần kiểm tra trước khi duyệt lương', 'PAYROLL_REVIEW_REQUIRED')
    for (const entry of period.entries) {
      const evidence = entry.workEvidence as { makeupCredits?: { sourceKind: string; sourceId: number; amount: number }[] }
      for (const credit of evidence.makeupCredits ?? []) await tx.payrollMakeupCredit.create({ data: { entryId: entry.id, staffId: entry.staffId, ...credit } })
    }
    const approved = await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: 'APPROVED', approvedById: managerId, approvedAt: new Date() } })
    await audit(tx, { actorId: managerId, action: 'PAYROLL_PERIOD_APPROVED', entityType: 'PAYROLL_PERIOD', entityId: period.id, newData: { month } })
    return approved
  }, { isolationLevel: 'Serializable' })
}

export async function ownPayslips(staffId: number) {
  return prisma.payrollEntry.findMany({ where: { staffId, period: { status: 'APPROVED' } }, include: { period: { select: { month: true, approvedAt: true } } }, orderBy: { periodId: 'desc' } })
}

export async function ownPayslip(staffId: number, month: string) {
  const entry = await prisma.payrollEntry.findFirst({ where: { staffId, period: { month, status: 'APPROVED' } }, include: { period: true } })
  if (!entry) throw new HttpError(404, 'Chưa có phiếu lương đã duyệt', 'PAYSLIP_NOT_FOUND')
  return entry
}

export type PayrollEntrySnapshot = PayrollEntry
