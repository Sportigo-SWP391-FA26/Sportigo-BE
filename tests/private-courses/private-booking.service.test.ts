import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db } = vi.hoisted(() => ({ db: {
  privateCourse: { findUnique: vi.fn() }, coachPrivateCourse: { findFirst: vi.fn() }, coach: { findUnique: vi.fn() },
  privateCourseEnrollment: { findFirst: vi.fn(), create: vi.fn() }, coachAvailability: { findMany: vi.fn() },
  room: { findMany: vi.fn() }, privateCourseSchedule: { findMany: vi.fn() }, classSession: { findMany: vi.fn() },
  serviceOrder: { create: vi.fn() }, orderItem: { create: vi.fn() }, $transaction: vi.fn(),
} }))
vi.mock('../../src/lib/prisma.js', () => ({ prisma: db }))
vi.mock('../../src/modules/finance/finance.service.js', () => ({ settleZeroAmountOrder: vi.fn() }))
import { createShiftBooking, previewShiftBooking } from '../../src/modules/private-courses/private-booking.service.js'

const slot = { dayOfWeek: 2, shiftCode: 'S2' }
const input = { memberId: 5, privateCourseId: 9, coachId: 12, startDate: '2030-01-01', schedules: [slot, { dayOfWeek: 4, shiftCode: 'S2' }] }

describe('private course shift booking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db))
    db.privateCourse.findUnique.mockResolvedValue({ id: 9, sportId: 1, name: 'Bơi 1–1', status: 'ACTIVE', totalSessions: 3, sessionDurationMinutes: 60, validityDays: 30, price: 900000 })
    db.coachPrivateCourse.findFirst.mockResolvedValue({ coachId: 12, customPrice: null })
    db.coach.findUnique.mockResolvedValue({ status: 'ACTIVE', coachSports: [{ sportId: 1 }] })
    db.privateCourseEnrollment.findFirst.mockResolvedValue(null)
    db.coachAvailability.findMany.mockResolvedValue([2, 4].map((dayOfWeek) => ({ dayOfWeek, effectiveFrom: new Date('2029-12-01'), effectiveTo: null, startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T10:30:00Z') })))
    db.room.findMany.mockResolvedValue([{ id: 1 }])
    db.privateCourseSchedule.findMany.mockResolvedValue([])
    db.classSession.findMany.mockResolvedValue([])
    db.privateCourseEnrollment.create.mockImplementation(async ({ data }) => ({ id: 33, ...data }))
    db.serviceOrder.create.mockResolvedValue({ id: 77, finalAmount: 900000 })
    db.orderItem.create.mockResolvedValue({ id: 88 })
  })

  it('stops at purchased session count, assigns a room, and creates an order', async () => {
    const preview = await previewShiftBooking(input)
    expect(preview.occurrences).toHaveLength(3)
    expect(preview.occurrences.every((item) => item.roomId === 1)).toBe(true)
    expect(preview.occurrences[0]?.endsAt.getTime() - preview.occurrences[0]?.startsAt.getTime()).toBe(60 * 60_000)
    const created = await createShiftBooking(input)
    expect(created.order.id).toBe(77)
    const schedules = db.privateCourseEnrollment.create.mock.calls[0]?.[0].data.schedules.create
    expect(schedules).toHaveLength(2)
    expect(schedules.map((item: { effectiveTo: Date }) => item.effectiveTo.toISOString().slice(0, 10))).toEqual(['2030-01-08', '2030-01-03'])
  })

  it('rejects a booked Coach before creating any order', async () => {
    db.classSession.findMany.mockResolvedValue([{ startsAt: new Date('2030-01-01T02:00:00Z'), endsAt: new Date('2030-01-01T03:30:00Z'), coachId: 12, roomId: 1, groupClass: { coachId: 12, registrations: [] } }])
    await expect(createShiftBooking(input)).rejects.toThrow('trùng lịch')
    expect(db.serviceOrder.create).not.toHaveBeenCalled()
  })
})
