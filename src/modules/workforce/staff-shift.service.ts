import { Prisma } from '@prisma/client'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import type { AuthUser } from '../../middleware/auth.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'
import type { AdjustmentRequestInput, CreateShiftInput, ListShiftsQuery, UpdateShiftInput } from './staff-shift.schema.js'
import { WORKFORCE_RULES, centerDayRange, formatCenterTime, ms } from './workforce.config.js'

// FR-67: ca làm và chấm công của lễ tân.
// Manager xếp ca, sửa/hủy ca chưa vào làm, duyệt yêu cầu sửa công. Lễ tân xem ca của mình, bấm vào/ra ca, xin sửa công.

type Db = Prisma.TransactionClient | typeof prisma

const adjustmentSelect = {
  id: true,
  clockInAt: true,
  clockOutAt: true,
  oldClockInAt: true,
  oldClockOutAt: true,
  reason: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TimeClockAdjustmentSelect

const shiftSelect = {
  id: true,
  staffId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  note: true,
  cancelReason: true,
  clockInAt: true,
  clockOutAt: true,
  createdAt: true,
  staff: { select: { id: true, displayName: true, receptionist: { select: { staffCode: true } } } },
  // note: chỉ lấy 3 yêu cầu sửa công gần nhất để hiển thị
  adjustments: { select: adjustmentSelect, orderBy: { createdAt: 'desc' }, take: 3 },
} satisfies Prisma.StaffShiftSelect

type ShiftRow = Prisma.StaffShiftGetPayload<{ select: typeof shiftSelect }>

const minutesBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / ms.minute)

// note: tình trạng chấm công của ca, tính tại thời điểm xem
export function attendanceState(shift: Pick<ShiftRow, 'status' | 'startsAt' | 'endsAt' | 'clockInAt' | 'clockOutAt'>, now = new Date()) {
  if (shift.status === 'CANCELLED') return 'CANCELLED'
  if (shift.clockOutAt) return 'COMPLETED'
  if (shift.clockInAt) {
    return now.getTime() > shift.endsAt.getTime() + WORKFORCE_RULES.clockOutLateHours * ms.hour ? 'MISSING_CLOCK_OUT' : 'WORKING'
  }
  if (now < shift.startsAt) return 'UPCOMING'
  return now < shift.endsAt ? 'NOT_CLOCKED_IN' : 'ABSENT'
}

// note: số phút đi trễ / về sớm / làm thực tế (dưới ngưỡng 5 phút thì coi như 0)
export function clockMetrics(shift: Pick<ShiftRow, 'startsAt' | 'endsAt' | 'clockInAt' | 'clockOutAt'>) {
  const late = shift.clockInAt ? minutesBetween(shift.startsAt, shift.clockInAt) : 0
  const early = shift.clockOutAt ? minutesBetween(shift.clockOutAt, shift.endsAt) : 0
  return {
    lateMinutes: late > WORKFORCE_RULES.graceMinutes ? late : 0,
    earlyLeaveMinutes: early > WORKFORCE_RULES.graceMinutes ? early : 0,
    workedMinutes: shift.clockInAt && shift.clockOutAt ? minutesBetween(shift.clockInAt, shift.clockOutAt) : null,
  }
}

function canClockIn(shift: ShiftRow, now: Date) {
  return shift.status === 'SCHEDULED' && !shift.clockInAt &&
    now.getTime() >= shift.startsAt.getTime() - WORKFORCE_RULES.clockInEarlyMinutes * ms.minute && now < shift.endsAt
}

function canClockOut(shift: ShiftRow, now: Date) {
  return shift.status === 'SCHEDULED' && !!shift.clockInAt && !shift.clockOutAt &&
    now.getTime() <= shift.endsAt.getTime() + WORKFORCE_RULES.clockOutLateHours * ms.hour
}

function toView(shift: ShiftRow, now = new Date()) {
  const { adjustments, staff, ...rest } = shift
  return {
    ...rest,
    staff: { id: staff.id, displayName: staff.displayName, staffCode: staff.receptionist?.staffCode ?? null },
    ...clockMetrics(shift),
    attendance: attendanceState(shift, now),
    canClockIn: canClockIn(shift, now),
    canClockOut: canClockOut(shift, now),
    // note: còn được sửa/hủy khi ca chưa hủy và chưa vào làm
    editable: shift.status === 'SCHEDULED' && !shift.clockInAt,
    pendingAdjustment: adjustments.find((item) => item.status === 'PENDING') ?? null,
    adjustments,
  }
}

async function loadShift(id: number, db: Db = prisma) {
  const shift = await db.staffShift.findUnique({ where: { id }, select: shiftSelect })
  if (!shift) throw new HttpError(404, 'Không tìm thấy ca làm.', 'SHIFT_NOT_FOUND')
  return shift
}

// note: lễ tân chỉ được thao tác trên ca của chính mình; báo 404 để không lộ ca của người khác
async function loadOwnShift(actor: AuthUser, id: number) {
  const shift = await loadShift(id)
  if (shift.staffId !== actor.id) throw new HttpError(404, 'Không tìm thấy ca làm.', 'SHIFT_NOT_FOUND')
  return shift
}

// note: kiểm tra giờ ca: kết thúc sau bắt đầu, dài 1–12 giờ, chưa kết thúc, không chồng ca khác của cùng người
async function assertShiftTimes(db: Db, staffId: number, startsAt: Date, endsAt: Date, excludeId?: number) {
  const minutes = minutesBetween(startsAt, endsAt)
  if (minutes < WORKFORCE_RULES.shiftMinMinutes || minutes > WORKFORCE_RULES.shiftMaxMinutes) {
    throw new HttpError(400, 'Ca làm phải dài từ 1 đến 12 giờ và kết thúc sau khi bắt đầu.', 'INVALID_SHIFT_TIME')
  }
  if (endsAt <= new Date()) {
    throw new HttpError(409, 'Không thể xếp ca đã kết thúc.', 'SHIFT_IN_PAST')
  }
  const overlap = await db.staffShift.findFirst({
    where: { staffId, status: 'SCHEDULED', id: excludeId ? { not: excludeId } : undefined, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true },
  })
  if (overlap) throw new HttpError(409, 'Nhân sự đã có ca khác trùng khung giờ này.', 'SHIFT_OVERLAP', { shiftId: overlap.id })
}

function shiftLabel(shift: { startsAt: Date; endsAt: Date }) {
  return `${formatCenterTime(shift.startsAt)} – ${formatCenterTime(shift.endsAt)}`
}

// ===== Manager =====

export async function listShifts(query: ListShiftsQuery) {
  const { start, endExclusive } = centerDayRange(query.from, query.to)
  const rows = await prisma.staffShift.findMany({
    where: { startsAt: { gte: start, lt: endExclusive }, staffId: query.staffId },
    select: shiftSelect,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: 1000,
  })
  const now = new Date()
  return { items: rows.map((row) => toView(row, now)) }
}

export async function createShift(actor: AuthUser, input: CreateShiftInput) {
  // note: chỉ xếp ca cho lễ tân đang hoạt động
  const staff = await prisma.user.findUnique({
    where: { id: input.staffId },
    select: { status: true, deletedAt: true, role: { select: { name: true } } },
  })
  if (!staff || staff.deletedAt || staff.role.name !== 'RECEPTIONIST') {
    throw new HttpError(409, 'Chỉ xếp ca cho tài khoản Lễ tân.', 'STAFF_NOT_RECEPTIONIST')
  }
  if (staff.status !== 'ACTIVE') throw new HttpError(409, 'Tài khoản lễ tân đang không hoạt động.', 'STAFF_INACTIVE')

  const created = await prisma.$transaction(async (tx) => {
    await assertShiftTimes(tx, input.staffId, input.startsAt, input.endsAt)
    const shift = await tx.staffShift.create({
      data: { staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, note: input.note || null, createdById: actor.id },
      select: shiftSelect,
    })
    await audit(tx, {
      actorId: actor.id,
      action: 'STAFF_SHIFT_CREATED',
      entityType: 'STAFF_SHIFT',
      entityId: shift.id,
      newData: { staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, note: input.note },
    })
    await notify(tx, {
      userIds: [input.staffId],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Bạn có ca làm mới',
      content: `Ca làm ${shiftLabel(shift)}.${input.note ? ` Ghi chú: ${input.note}` : ''}`,
    })
    return shift
  })
  return toView(created)
}

export async function updateShift(actor: AuthUser, id: number, input: UpdateShiftInput) {
  const shift = await loadShift(id)
  if (shift.status !== 'SCHEDULED' || shift.clockInAt) {
    throw new HttpError(409, 'Chỉ sửa được ca chưa hủy và chưa vào làm.', 'SHIFT_LOCKED')
  }
  const startsAt = input.startsAt ?? shift.startsAt
  const endsAt = input.endsAt ?? shift.endsAt
  const updated = await prisma.$transaction(async (tx) => {
    await assertShiftTimes(tx, shift.staffId, startsAt, endsAt, id)
    // note: điều kiện clockInAt null trong where để không ghi đè nếu lễ tân vừa bấm vào ca
    const result = await tx.staffShift.updateMany({
      where: { id, status: 'SCHEDULED', clockInAt: null },
      data: { startsAt, endsAt, ...(input.note !== undefined ? { note: input.note || null } : {}) },
    })
    if (result.count === 0) throw new HttpError(409, 'Chỉ sửa được ca chưa hủy và chưa vào làm.', 'SHIFT_LOCKED')
    await audit(tx, {
      actorId: actor.id,
      action: 'STAFF_SHIFT_UPDATED',
      entityType: 'STAFF_SHIFT',
      entityId: id,
      oldData: { startsAt: shift.startsAt, endsAt: shift.endsAt, note: shift.note },
      newData: { startsAt, endsAt, note: input.note },
    })
    if (startsAt.getTime() !== shift.startsAt.getTime() || endsAt.getTime() !== shift.endsAt.getTime()) {
      await notify(tx, {
        userIds: [shift.staffId],
        type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Ca làm của bạn đã đổi giờ',
        content: `Ca ${shiftLabel(shift)} đổi thành ${shiftLabel({ startsAt, endsAt })}.`,
      })
    }
    return loadShift(id, tx)
  })
  return toView(updated)
}

export async function cancelShift(actor: AuthUser, id: number, reason: string) {
  const shift = await loadShift(id)
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.staffShift.updateMany({
      where: { id, status: 'SCHEDULED', clockInAt: null },
      data: { status: 'CANCELLED', cancelReason: reason },
    })
    if (result.count === 0) throw new HttpError(409, 'Chỉ hủy được ca chưa hủy và chưa vào làm.', 'SHIFT_LOCKED')
    await audit(tx, {
      actorId: actor.id,
      action: 'STAFF_SHIFT_CANCELLED',
      entityType: 'STAFF_SHIFT',
      entityId: id,
      oldData: { status: shift.status },
      newData: { status: 'CANCELLED', reason },
    })
    await notify(tx, {
      userIds: [shift.staffId],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Ca làm của bạn đã bị hủy',
      content: `Ca ${shiftLabel(shift)} đã bị hủy. Lý do: ${reason}`,
    })
    return loadShift(id, tx)
  })
  return toView(updated)
}

// ===== Lễ tân =====

export async function listMyShifts(actor: AuthUser, range: { from: string; to: string }) {
  const { start, endExclusive } = centerDayRange(range.from, range.to)
  const rows = await prisma.staffShift.findMany({
    where: { staffId: actor.id, startsAt: { gte: start, lt: endExclusive } },
    select: shiftSelect,
    orderBy: { startsAt: 'asc' },
  })
  const now = new Date()
  const items = rows.map((row) => toView(row, now))
  // note: tổng hợp nhanh cho lễ tân: số ca, phút làm, số lần trễ/về sớm, ca vắng
  const summary = {
    scheduled: items.filter((item) => item.status === 'SCHEDULED').length,
    completed: items.filter((item) => item.attendance === 'COMPLETED').length,
    absent: items.filter((item) => item.attendance === 'ABSENT').length,
    lateCount: items.filter((item) => item.lateMinutes > 0).length,
    earlyLeaveCount: items.filter((item) => item.earlyLeaveMinutes > 0).length,
    workedMinutes: items.reduce((sum, item) => sum + (item.workedMinutes ?? 0), 0),
  }
  return { items, summary }
}

export async function clockIn(actor: AuthUser, id: number) {
  const shift = await loadOwnShift(actor, id)
  const now = new Date()
  if (!canClockIn(shift, now)) {
    throw new HttpError(409, `Chỉ vào ca được từ ${WORKFORCE_RULES.clockInEarlyMinutes} phút trước giờ bắt đầu đến khi ca kết thúc, và chưa vào ca trước đó.`, 'CLOCK_IN_NOT_ALLOWED')
  }
  // note: where clockInAt null để bấm 2 lần cùng lúc chỉ ghi 1 lần
  const result = await prisma.staffShift.updateMany({ where: { id, status: 'SCHEDULED', clockInAt: null }, data: { clockInAt: now } })
  if (result.count === 0) throw new HttpError(409, 'Ca đã được vào trước đó.', 'CLOCK_IN_NOT_ALLOWED')
  return toView(await loadShift(id))
}

export async function clockOut(actor: AuthUser, id: number) {
  const shift = await loadOwnShift(actor, id)
  const now = new Date()
  if (!canClockOut(shift, now) || now <= shift.clockInAt!) {
    throw new HttpError(409, `Chỉ ra ca được sau khi đã vào ca và trước ${WORKFORCE_RULES.clockOutLateHours} giờ sau giờ kết thúc. Quá hạn hãy gửi yêu cầu sửa công.`, 'CLOCK_OUT_NOT_ALLOWED')
  }
  const result = await prisma.staffShift.updateMany({ where: { id, clockInAt: { not: null }, clockOutAt: null }, data: { clockOutAt: now } })
  if (result.count === 0) throw new HttpError(409, 'Ca đã được ra trước đó.', 'CLOCK_OUT_NOT_ALLOWED')
  return toView(await loadShift(id))
}

// note: giờ vào/ra sau khi sửa phải hợp lệ: có giờ vào nếu có giờ ra, ra sau vào, nằm quanh ca, không ở tương lai
function assertAdjustedTimes(shift: Pick<ShiftRow, 'startsAt' | 'endsAt'>, clockInAt: Date | null, clockOutAt: Date | null) {
  const earliest = shift.startsAt.getTime() - WORKFORCE_RULES.adjustmentSlackHours.before * ms.hour
  const latest = shift.endsAt.getTime() + WORKFORCE_RULES.adjustmentSlackHours.after * ms.hour
  const now = Date.now()
  for (const value of [clockInAt, clockOutAt]) {
    if (value && (value.getTime() < earliest || value.getTime() > latest || value.getTime() > now)) {
      throw new HttpError(400, 'Giờ sửa phải nằm quanh giờ ca (trước 2 giờ, sau 6 giờ) và không ở tương lai.', 'INVALID_ADJUSTMENT_TIME')
    }
  }
  if (clockOutAt && !clockInAt) throw new HttpError(400, 'Cần có giờ vào ca trước khi sửa giờ ra.', 'INVALID_ADJUSTMENT_TIME')
  if (clockInAt && clockOutAt && clockOutAt <= clockInAt) {
    throw new HttpError(400, 'Giờ ra phải sau giờ vào.', 'INVALID_ADJUSTMENT_TIME')
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function requestAdjustment(actor: AuthUser, id: number, input: AdjustmentRequestInput) {
  const shift = await loadOwnShift(actor, id)
  const now = Date.now()
  if (shift.status !== 'SCHEDULED') throw new HttpError(409, 'Ca đã bị hủy.', 'SHIFT_CANCELLED')
  if (now < shift.startsAt.getTime() || now > shift.endsAt.getTime() + WORKFORCE_RULES.adjustmentWindowDays * ms.day) {
    throw new HttpError(409, `Chỉ xin sửa công khi ca đã bắt đầu và trong ${WORKFORCE_RULES.adjustmentWindowDays} ngày sau khi ca kết thúc.`, 'ADJUSTMENT_WINDOW_CLOSED')
  }
  if (shift.adjustments.some((item) => item.status === 'PENDING')) {
    throw new HttpError(409, 'Ca này đang có yêu cầu sửa công chờ duyệt.', 'ADJUSTMENT_PENDING')
  }
  assertAdjustedTimes(shift, input.clockInAt ?? shift.clockInAt, input.clockOutAt ?? shift.clockOutAt)

  try {
    await prisma.$transaction(async (tx) => {
      const adjustment = await tx.timeClockAdjustment.create({
        data: { shiftId: id, requestedById: actor.id, clockInAt: input.clockInAt ?? null, clockOutAt: input.clockOutAt ?? null, reason: input.reason },
      })
      await audit(tx, {
        actorId: actor.id,
        action: 'TIME_CLOCK_ADJUSTMENT_REQUESTED',
        entityType: 'TIME_CLOCK_ADJUSTMENT',
        entityId: adjustment.id,
        newData: { shiftId: id, clockInAt: input.clockInAt, clockOutAt: input.clockOutAt, reason: input.reason },
      })
      // note: báo cho các Manager đang hoạt động để duyệt
      const managers = await tx.user.findMany({
        where: { status: 'ACTIVE', deletedAt: null, role: { name: 'CENTER_MANAGER' } },
        select: { id: true },
      })
      await notify(tx, {
        userIds: managers.map((item) => item.id),
        type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
        title: 'Yêu cầu sửa chấm công mới',
        content: `${shift.staff.displayName} xin sửa công ca ${shiftLabel(shift)}. Lý do: ${input.reason}`,
      })
    })
  } catch (error) {
    // note: chỉ mục unique "1 yêu cầu chờ duyệt / ca" chặn trường hợp gửi 2 lần cùng lúc
    if (isUniqueViolation(error)) throw new HttpError(409, 'Ca này đang có yêu cầu sửa công chờ duyệt.', 'ADJUSTMENT_PENDING')
    throw error
  }
  return toView(await loadShift(id))
}

// ===== Manager duyệt sửa công =====

export async function listAdjustments(status: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const rows = await prisma.timeClockAdjustment.findMany({
    where: { status },
    orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 200,
    select: {
      ...adjustmentSelect,
      requestedBy: { select: { id: true, displayName: true } },
      shift: { select: { id: true, startsAt: true, endsAt: true, clockInAt: true, clockOutAt: true, status: true } },
    },
  })
  return { items: rows }
}

async function loadPendingAdjustment(db: Db, id: number) {
  const adjustment = await db.timeClockAdjustment.findUnique({
    where: { id },
    select: { id: true, status: true, requestedById: true, clockInAt: true, clockOutAt: true, shift: { select: { id: true, startsAt: true, endsAt: true, clockInAt: true, clockOutAt: true, status: true } } },
  })
  if (!adjustment) throw new HttpError(404, 'Không tìm thấy yêu cầu sửa công.', 'ADJUSTMENT_NOT_FOUND')
  if (adjustment.status !== 'PENDING') throw new HttpError(409, 'Yêu cầu này đã được xử lý.', 'ADJUSTMENT_ALREADY_REVIEWED')
  return adjustment
}

export async function approveAdjustment(actor: AuthUser, id: number, note?: string) {
  return prisma.$transaction(async (tx) => {
    const adjustment = await loadPendingAdjustment(tx, id)
    const { shift } = adjustment
    if (shift.status !== 'SCHEDULED') throw new HttpError(409, 'Ca đã bị hủy, không thể duyệt.', 'SHIFT_CANCELLED')
    // note: tính lại với giờ hiện tại của ca (ca có thể đã được bấm vào/ra sau khi gửi yêu cầu)
    const clockInAt = adjustment.clockInAt ?? shift.clockInAt
    const clockOutAt = adjustment.clockOutAt ?? shift.clockOutAt
    assertAdjustedTimes(shift, clockInAt, clockOutAt)
    const result = await tx.timeClockAdjustment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note || null, oldClockInAt: shift.clockInAt, oldClockOutAt: shift.clockOutAt },
    })
    if (result.count === 0) throw new HttpError(409, 'Yêu cầu này đã được xử lý.', 'ADJUSTMENT_ALREADY_REVIEWED')
    await tx.staffShift.update({ where: { id: shift.id }, data: { clockInAt, clockOutAt } })
    await audit(tx, {
      actorId: actor.id,
      action: 'TIME_CLOCK_ADJUSTMENT_APPROVED',
      entityType: 'STAFF_SHIFT',
      entityId: shift.id,
      oldData: { clockInAt: shift.clockInAt, clockOutAt: shift.clockOutAt },
      newData: { clockInAt, clockOutAt, adjustmentId: id, note },
    })
    await notify(tx, {
      userIds: [adjustment.requestedById],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Yêu cầu sửa công đã được duyệt',
      content: `Ca ${shiftLabel(shift)} đã được cập nhật giờ vào/ra.${note ? ` Ghi chú: ${note}` : ''}`,
    })
    return { id, status: 'APPROVED' as const, shiftId: shift.id, clockInAt, clockOutAt }
  })
}

export async function rejectAdjustment(actor: AuthUser, id: number, note: string) {
  return prisma.$transaction(async (tx) => {
    const adjustment = await loadPendingAdjustment(tx, id)
    const result = await tx.timeClockAdjustment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note },
    })
    if (result.count === 0) throw new HttpError(409, 'Yêu cầu này đã được xử lý.', 'ADJUSTMENT_ALREADY_REVIEWED')
    await audit(tx, {
      actorId: actor.id,
      action: 'TIME_CLOCK_ADJUSTMENT_REJECTED',
      entityType: 'TIME_CLOCK_ADJUSTMENT',
      entityId: id,
      newData: { status: 'REJECTED', note },
    })
    await notify(tx, {
      userIds: [adjustment.requestedById],
      type: NOTIFICATION_TYPES.SCHEDULE_CHANGE,
      title: 'Yêu cầu sửa công bị từ chối',
      content: `Ca ${shiftLabel(adjustment.shift)}: yêu cầu sửa công bị từ chối. Lý do: ${note}`,
    })
    return { id, status: 'REJECTED' as const, shiftId: adjustment.shift.id }
  })
}
