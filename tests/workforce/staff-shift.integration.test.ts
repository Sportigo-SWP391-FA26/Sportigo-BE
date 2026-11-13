import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { attendanceState, clockMetrics } from '../../src/modules/workforce/staff-shift.service.js'
import { hasTestDatabase } from '../support/test-database.js'
import { DAY as DAY_MS, HOUR, createCoach, createManager, createReceptionist, resetDatabase } from '../training/fixtures.js'

const MINUTE = 60 * 1000

// FR-67: ca làm và chấm công lễ tân – test với database thật
describe.skipIf(!hasTestDatabase)('FR-67 Ca làm và chấm công lễ tân', () => {
  let manager: Awaited<ReturnType<typeof createManager>>
  let receptionist: Awaited<ReturnType<typeof createReceptionist>>
  let otherReceptionist: Awaited<ReturnType<typeof createReceptionist>>
  let coach: Awaited<ReturnType<typeof createCoach>>
  let currentShiftId: number

  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()
  const create = (body: object, auth = manager.auth) =>
    request(app).post('/api/staff-shifts').set('Authorization', auth).send(body)
  const post = (path: string, auth: string, body: object = {}) =>
    request(app).post(`/api/staff-shifts${path}`).set('Authorization', auth).send(body)

  beforeAll(async () => {
    await resetDatabase()
    manager = await createManager()
    receptionist = await createReceptionist()
    otherReceptionist = await createReceptionist()
    coach = await createCoach()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('Manager xếp ca cho lễ tân: 201, báo cho lễ tân, ghi audit', async () => {
    // note: ca đã bắt đầu 20 phút trước để test vào ca trễ
    const response = await create({ staffId: receptionist.id, startsAt: iso(-20 * MINUTE), endsAt: iso(3 * HOUR), note: 'Ca sáng' })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ status: 'SCHEDULED', note: 'Ca sáng', attendance: 'NOT_CLOCKED_IN', canClockIn: true, editable: true })
    currentShiftId = response.body.id
    expect(await prisma.notification.count({ where: { userId: receptionist.id, title: 'Bạn có ca làm mới' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'STAFF_SHIFT_CREATED' } })).toBe(1)
  })

  it('chặn xếp ca sai: không phải lễ tân, trùng ca, quá 12 giờ, ca đã kết thúc, role khác', async () => {
    expect((await create({ staffId: coach.id, startsAt: iso(DAY_MS), endsAt: iso(DAY_MS + 4 * HOUR) })).body.code).toBe('STAFF_NOT_RECEPTIONIST')
    expect((await create({ staffId: receptionist.id, startsAt: iso(HOUR), endsAt: iso(5 * HOUR) })).body.code).toBe('SHIFT_OVERLAP')
    expect((await create({ staffId: receptionist.id, startsAt: iso(DAY_MS), endsAt: iso(DAY_MS + 13 * HOUR) })).body.code).toBe('INVALID_SHIFT_TIME')
    expect((await create({ staffId: receptionist.id, startsAt: iso(-5 * HOUR), endsAt: iso(-HOUR) })).body.code).toBe('SHIFT_IN_PAST')
    // note: giờ không có múi giờ bị Zod chặn
    expect((await create({ staffId: receptionist.id, startsAt: '2026-12-01T08:00:00', endsAt: '2026-12-01T12:00:00' })).status).toBe(400)
    expect((await create({ staffId: receptionist.id, startsAt: iso(DAY_MS), endsAt: iso(DAY_MS + HOUR) }, receptionist.auth)).status).toBe(403)
  })

  it('hai yêu cầu xếp ca trùng đồng thời chỉ một ca được tạo', async () => {
    const startsAt = iso(20 * DAY_MS)
    const endsAt = iso(20 * DAY_MS + 4 * HOUR)
    const results = await Promise.all([
      create({ staffId: otherReceptionist.id, startsAt, endsAt }),
      create({ staffId: otherReceptionist.id, startsAt, endsAt }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect(await prisma.staffShift.count({ where: { staffId: otherReceptionist.id, startsAt: new Date(startsAt), status: 'SCHEDULED' } })).toBe(1)
  })

  it('lễ tân vào ca (trễ ~20 phút), không vào 2 lần, người khác không thao tác được ca này', async () => {
    expect((await post(`/${currentShiftId}/clock-in`, otherReceptionist.auth)).status).toBe(404)
    const response = await post(`/${currentShiftId}/clock-in`, receptionist.auth)
    expect(response.status).toBe(200)
    expect(response.body.attendance).toBe('WORKING')
    expect(response.body.lateMinutes).toBeGreaterThanOrEqual(19)
    expect((await post(`/${currentShiftId}/clock-in`, receptionist.auth)).body.code).toBe('CLOCK_IN_NOT_ALLOWED')
    // note: đã vào làm thì Manager không sửa/hủy ca được nữa
    const edit = await request(app).patch(`/api/staff-shifts/${currentShiftId}`).set('Authorization', manager.auth).send({ note: 'Đổi' })
    expect(edit.body.code).toBe('SHIFT_LOCKED')
  })

  it('lễ tân ra ca sớm: ghi giờ ra, tính phút về sớm và phút làm', async () => {
    const response = await post(`/${currentShiftId}/clock-out`, receptionist.auth)
    expect(response.status).toBe(200)
    expect(response.body.attendance).toBe('COMPLETED')
    expect(response.body.earlyLeaveMinutes).toBeGreaterThan(170)
    expect(response.body.workedMinutes).toBeGreaterThanOrEqual(0)
    expect((await post(`/${currentShiftId}/clock-out`, receptionist.auth)).body.code).toBe('CLOCK_OUT_NOT_ALLOWED')
  })

  it('xin sửa công → chỉ 1 yêu cầu chờ duyệt → Manager duyệt thì giờ vào được sửa, hết trễ', async () => {
    const shift = await prisma.staffShift.findUniqueOrThrow({ where: { id: currentShiftId } })
    const requestBody = { clockInAt: shift.startsAt.toISOString(), reason: 'Quên bấm vào ca đúng giờ' }
    const created = await post(`/${currentShiftId}/adjustments`, receptionist.auth, requestBody)
    expect(created.status).toBe(201)
    expect(created.body.pendingAdjustment).toMatchObject({ status: 'PENDING', reason: 'Quên bấm vào ca đúng giờ' })
    expect((await post(`/${currentShiftId}/adjustments`, receptionist.auth, requestBody)).body.code).toBe('ADJUSTMENT_PENDING')
    expect(await prisma.notification.count({ where: { userId: manager.id, title: 'Yêu cầu sửa chấm công mới' } })).toBe(1)

    const pending = await request(app).get('/api/staff-shifts/adjustments').set('Authorization', manager.auth)
    expect(pending.body.items).toHaveLength(1)
    const adjustmentId = pending.body.items[0].id

    const approved = await post(`/adjustments/${adjustmentId}/approve`, manager.auth, { note: 'OK' })
    expect(approved.status).toBe(200)
    const after = await prisma.staffShift.findUniqueOrThrow({ where: { id: currentShiftId } })
    expect(after.clockInAt?.getTime()).toBe(shift.startsAt.getTime())
    expect(clockMetrics(after).lateMinutes).toBe(0)
    const adjustment = await prisma.timeClockAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } })
    expect(adjustment).toMatchObject({ status: 'APPROVED', reviewedById: manager.id })
    expect(adjustment.oldClockInAt?.getTime()).toBe(shift.clockInAt?.getTime())
    expect(await prisma.auditLog.count({ where: { action: 'TIME_CLOCK_ADJUSTMENT_APPROVED' } })).toBe(1)
    // note: duyệt lần 2 bị chặn
    expect((await post(`/adjustments/${adjustmentId}/approve`, manager.auth)).body.code).toBe('ADJUSTMENT_ALREADY_REVIEWED')
  })

  it('từ chối sửa công cần lý do; giờ sửa ở tương lai hoặc ca chưa bắt đầu bị chặn', async () => {
    const shift = await create({ staffId: otherReceptionist.id, startsAt: iso(-HOUR), endsAt: iso(2 * HOUR) })
    const shiftId = shift.body.id
    expect((await post(`/${shiftId}/adjustments`, otherReceptionist.auth, { clockInAt: iso(HOUR), reason: 'Giờ tương lai' })).body.code).toBe('INVALID_ADJUSTMENT_TIME')
    expect((await post(`/${shiftId}/adjustments`, otherReceptionist.auth, { reason: 'Không có giờ' })).status).toBe(400)
    const created = await post(`/${shiftId}/adjustments`, otherReceptionist.auth, { clockInAt: iso(-HOUR), reason: 'Máy hỏng' })
    expect(created.status).toBe(201)
    const adjustmentId = created.body.pendingAdjustment.id
    expect((await post(`/adjustments/${adjustmentId}/reject`, manager.auth, {})).status).toBe(400)
    const rejected = await post(`/adjustments/${adjustmentId}/reject`, manager.auth, { note: 'Không có bằng chứng' })
    expect(rejected.status).toBe(200)
    expect((await prisma.staffShift.findUniqueOrThrow({ where: { id: shiftId } })).clockInAt).toBeNull()

    const future = await create({ staffId: otherReceptionist.id, startsAt: iso(DAY_MS), endsAt: iso(DAY_MS + 4 * HOUR) })
    expect((await post(`/${future.body.id}/adjustments`, otherReceptionist.auth, { clockInAt: iso(-HOUR), reason: 'Sớm quá' })).body.code).toBe('ADJUSTMENT_WINDOW_CLOSED')
  })

  it('Manager sửa giờ và hủy ca chưa vào làm; lễ tân xem ca của mình kèm tổng hợp', async () => {
    const shift = await create({ staffId: receptionist.id, startsAt: iso(2 * DAY_MS), endsAt: iso(2 * DAY_MS + 4 * HOUR) })
    const edited = await request(app).patch(`/api/staff-shifts/${shift.body.id}`).set('Authorization', manager.auth)
      .send({ endsAt: iso(2 * DAY_MS + 6 * HOUR) })
    expect(edited.status).toBe(200)
    expect(await prisma.notification.count({ where: { userId: receptionist.id, title: 'Ca làm của bạn đã đổi giờ' } })).toBe(1)
    expect((await post(`/${shift.body.id}/cancel`, manager.auth, {})).status).toBe(400)
    const cancelled = await post(`/${shift.body.id}/cancel`, manager.auth, { reason: 'Đổi lịch trung tâm' })
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', attendance: 'CANCELLED', cancelReason: 'Đổi lịch trung tâm' })
    expect((await post(`/${shift.body.id}/cancel`, manager.auth, { reason: 'Hủy lần 2' })).body.code).toBe('SHIFT_LOCKED')

    const day = (offset: number) => new Date(Date.now() + offset * DAY_MS + 7 * HOUR).toISOString().slice(0, 10)
    const mine = await request(app).get(`/api/staff-shifts/me?from=${day(-1)}&to=${day(3)}`).set('Authorization', receptionist.auth)
    expect(mine.status).toBe(200)
    expect(mine.body.items).toHaveLength(2)
    expect(mine.body.summary).toMatchObject({ completed: 1, scheduled: 1 })
    expect((await request(app).get(`/api/staff-shifts/me?from=${day(-1)}&to=${day(3)}`).set('Authorization', manager.auth)).status).toBe(403)

    const all = await request(app).get(`/api/staff-shifts?from=${day(-1)}&to=${day(3)}&staffId=${otherReceptionist.id}`).set('Authorization', manager.auth)
    expect(all.body.items.every((item: { staff: { id: number } }) => item.staff.id === otherReceptionist.id)).toBe(true)
  })

  it('tình trạng ca được tính đúng theo thời điểm', () => {
    const base = { status: 'SCHEDULED' as const, startsAt: new Date('2026-11-12T01:00:00Z'), endsAt: new Date('2026-11-12T05:00:00Z'), clockInAt: null, clockOutAt: null }
    expect(attendanceState(base, new Date('2026-11-12T00:00:00Z'))).toBe('UPCOMING')
    expect(attendanceState(base, new Date('2026-11-12T02:00:00Z'))).toBe('NOT_CLOCKED_IN')
    expect(attendanceState(base, new Date('2026-11-12T06:00:00Z'))).toBe('ABSENT')
    const working = { ...base, clockInAt: new Date('2026-11-12T01:03:00Z') }
    expect(attendanceState(working, new Date('2026-11-12T10:00:00Z'))).toBe('MISSING_CLOCK_OUT')
    // note: trễ 3 phút nằm trong ngưỡng 5 phút → không tính trễ
    expect(clockMetrics(working).lateMinutes).toBe(0)
  })
})
