import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({ prisma: {
  privateCourse: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() }, sport: { findUnique: vi.fn() },
  coach: { findUnique: vi.fn() }, coachPrivateCourse: { findFirst: vi.fn(), upsert: vi.fn() },
  coachAvailability: { findMany: vi.fn() }, room: { findMany: vi.fn(), findUnique: vi.fn() },
  privateCourseEnrollment: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  privateCourseSchedule: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  privateCourseScheduleException: { findUnique: vi.fn(), create: vi.fn() },
  privateCourseAttendance: { createMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  classSession: { findMany: vi.fn() },
  serviceOrder: { create: vi.fn() }, orderItem: { create: vi.fn() },
  auditLog: { create: vi.fn() }, notification: { createMany: vi.fn() }, $transaction: vi.fn(),
} }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }), EnrollmentStatus: { PENDING_PAYMENT: 'PENDING_PAYMENT', ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED' }, OrderStatus: { PENDING_PAYMENT: 'PENDING_PAYMENT' }, OrderItemType: { PRIVATE_COURSE: 'PRIVATE_COURSE' }, ScheduleStatus: { ACTIVE: 'ACTIVE' } }))
import { PrivateCourseService } from '../../src/modules/private-courses/private.service.js'
const service = new PrivateCourseService()
describe('FR-33 / FR-34 Private course enrollment and schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.coachAvailability.findMany.mockResolvedValue([])
    prisma.room.findMany.mockResolvedValue([])
    prisma.privateCourseSchedule.findMany.mockResolvedValue([])
    prisma.privateCourseScheduleException.findUnique.mockResolvedValue(null)
    prisma.notification.createMany.mockResolvedValue({ count: 1 })
    prisma.classSession.findMany.mockResolvedValue([])
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))
  })
  afterEach(() => vi.useRealTimers())
  it('rejects missing or inactive private courses', async () => {
    prisma.privateCourse.findUnique.mockResolvedValue({ id: 1, status: 'INACTIVE' })
    await expect(service.createEnrollment({ memberId: 2, coachId: 3, privateCourseId: 1 })).rejects.toThrow('không ở trạng thái hoạt động')
    expect(prisma.privateCourseEnrollment.create).not.toHaveBeenCalled()
  })
  it('requires the coach to be assigned to the selected course', async () => {
    prisma.privateCourse.findUnique.mockResolvedValue({ id: 1, status: 'ACTIVE', totalSessions: 12, validityDays: 90, price: 1200 })
    prisma.coachPrivateCourse.findFirst.mockResolvedValue(null)
    await expect(service.createEnrollment({ memberId: 2, coachId: 3, privateCourseId: 1, startDate: '2026-10-01', schedules: [{ dayOfWeek: 2, startTime: '09:00', roomId: 1 }] })).rejects.toThrow('không được gán')
  })
  it('rejects an inactive Coach even when the course assignment is active', async () => {
    prisma.privateCourse.findUnique.mockResolvedValue({ id: 1, sportId: 5, status: 'ACTIVE', totalSessions: 12, validityDays: 90, price: 1200 })
    prisma.coachPrivateCourse.findFirst.mockResolvedValue({ coachId: 3, privateCourseId: 1, isActive: true })
    prisma.coach.findUnique.mockResolvedValue({ userId: 3, status: 'INACTIVE', coachSports: [{ sportId: 5 }] })
    await expect(service.createEnrollment({
      memberId: 2,
      coachId: 3,
      privateCourseId: 1,
      startDate: '2026-10-01',
      schedules: [{ dayOfWeek: 2, startTime: '09:00', roomId: 1 }],
    })).rejects.toThrow('không được gán')
    expect(prisma.privateCourseEnrollment.create).not.toHaveBeenCalled()
  })
  it('creates a pending-payment enrollment with purchased session and price snapshots', async () => {
    prisma.privateCourse.findUnique.mockResolvedValue({ id: 1, name: 'Private swimming', sportId: 5, status: 'ACTIVE', totalSessions: 12, sessionDurationMinutes: 60, validityDays: 90, price: 1200 })
    prisma.coachPrivateCourse.findFirst.mockResolvedValue({ coachId: 3, privateCourseId: 1, isActive: true, customPrice: null })
    prisma.coach.findUnique.mockResolvedValue({ userId: 3, status: 'ACTIVE', coachSports: [{ sportId: 5 }] })
    prisma.coachAvailability.findMany.mockResolvedValue([{ dayOfWeek: 4, startTime: new Date('1970-01-01T09:00:00Z'), endTime: new Date('1970-01-01T11:00:00Z'), effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null, status: 'AVAILABLE' }])
    prisma.room.findMany.mockResolvedValue([{ id: 1, status: 'AVAILABLE' }])
    prisma.privateCourseEnrollment.create.mockImplementation(async ({ data }) => ({ id: 10, ...data }))
    prisma.serviceOrder.create.mockResolvedValue({ id: 4, status: 'PENDING_PAYMENT' })
    const result = await service.createEnrollment({
      memberId: 2,
      coachId: 3,
      privateCourseId: 1,
      startDate: '2026-01-01',
      schedules: [{ dayOfWeek: 4, startTime: '09:00', roomId: 1 }],
    })
    expect(result.enrollment).toMatchObject({ memberId: 2, coachId: 3, privateCourseId: 1, purchasedSessions: 12, remainingSessions: 12, purchasedPrice: 1200, status: 'PENDING_PAYMENT' })
    expect(result.enrollment.expiryDate.getTime()).toBeGreaterThan(result.enrollment.startDate.getTime())
    expect(prisma.orderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orderId: 4, privateEnrollmentId: expect.anything(), itemType: 'PRIVATE_COURSE' }) })
  })
  it('requires an ACTIVE enrollment before adding a recurring schedule', async () => {
    prisma.privateCourseEnrollment.findUnique.mockResolvedValue({ id: 4, memberId: 2, status: 'PENDING_PAYMENT', coachId: 3 })
    await expect(service.addCourseSchedule(4, { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', effectiveFrom: '2026-10-01', effectiveTo: '2026-12-01', roomId: 1 }, 2)).rejects.toThrow('chưa ở trạng thái hoạt động')
  })
  it('prevents members from adding schedules to another member enrollment', async () => {
    prisma.privateCourseEnrollment.findUnique.mockResolvedValue({ id: 4, memberId: 2, status: 'ACTIVE', coachId: 3 })
    await expect(service.addCourseSchedule(4, { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', effectiveFrom: '2026-10-01', effectiveTo: '2026-12-01', roomId: 1 }, 5)).rejects.toThrow('Bạn không có quyền')
    expect(prisma.privateCourseSchedule.create).not.toHaveBeenCalled()
  })
  it('rejects invalid time ranges for recurring schedules', async () => {
    prisma.privateCourseEnrollment.findUnique.mockResolvedValue({ id: 4, memberId: 2, status: 'ACTIVE', coachId: 3 })
    await expect(service.addCourseSchedule(4, { dayOfWeek: 2, startTime: '10:00', endTime: '09:00', effectiveFrom: '2026-10-01', effectiveTo: '2026-12-01', roomId: 1 }, 2)).rejects.toThrow('kết thúc phải sau thời gian bắt đầu')
  })
  it('rejects a recurring slot that overlaps the same coach schedule', async () => {
    prisma.privateCourseEnrollment.findUnique.mockResolvedValue({
      id: 4,
      memberId: 2,
      status: 'ACTIVE',
      coachId: 3,
      startDate: new Date('2026-10-01T00:00:00Z'),
      expiryDate: new Date('2026-12-01T00:00:00Z'),
    })
    prisma.room.findUnique.mockResolvedValue({ id: 1, status: 'AVAILABLE' })
    prisma.coachAvailability.findMany.mockResolvedValue([{
      dayOfWeek: 2,
      startTime: new Date('1970-01-01T08:00:00Z'),
      endTime: new Date('1970-01-01T12:00:00Z'),
      effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      effectiveTo: new Date('2026-12-01T00:00:00Z'),
    }])
    prisma.privateCourseSchedule.findMany.mockResolvedValue([{
      startTime: new Date('1970-01-01T09:30:00Z'),
      endTime: new Date('1970-01-01T10:30:00Z'),
      roomId: 2,
      dayOfWeek: 2,
      effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      effectiveTo: new Date('2026-12-01T00:00:00Z'),
      enrollment: { coachId: 3, memberId: 2 },
    }])
    await expect(service.addCourseSchedule(4, { dayOfWeek: 2, startTime: '10:00', endTime: '11:00', effectiveFrom: '2026-10-01', effectiveTo: '2026-12-01', roomId: 1 }, 2)).rejects.toThrow('bị chồng lấn')
    expect(prisma.privateCourseSchedule.create).not.toHaveBeenCalled()
  })
  it('decrements a private enrollment once when its coach records a completed occurrence', async () => {
    prisma.privateCourseSchedule.findUnique.mockResolvedValue({
      id: 6,
      enrollmentId: 4,
      dayOfWeek: 4,
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T10:00:00Z'),
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-12-31T00:00:00Z'),
      status: 'ACTIVE',
      enrollment: { coachId: 3, status: 'ACTIVE', remainingSessions: 1, startDate: new Date('2026-01-01T00:00:00Z'), expiryDate: new Date('2026-12-31T00:00:00Z') },
    })
    prisma.privateCourseAttendance.createMany.mockResolvedValue({ count: 1 })
    prisma.privateCourseEnrollment.updateMany.mockResolvedValue({ count: 1 })
    prisma.privateCourseEnrollment.findUniqueOrThrow.mockResolvedValue({ remainingSessions: 0 })
    prisma.privateCourseAttendance.findUniqueOrThrow.mockResolvedValue({ id: 8 })
    const result = await service.recordCompletedSession(6, '2026-10-22', 3)
    expect(result).toMatchObject({ attendance: { id: 8 }, remainingSessions: 0, alreadyRecorded: false })
    expect(prisma.privateCourseEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 4, remainingSessions: { gt: 0 } }),
      data: { remainingSessions: { decrement: 1 } },
    }))
    expect(prisma.privateCourseEnrollment.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { status: 'COMPLETED' },
    })
  })
  it('does not decrement the enrollment again for a duplicate occurrence', async () => {
    prisma.privateCourseSchedule.findUnique.mockResolvedValue({
      id: 6,
      enrollmentId: 4,
      dayOfWeek: 4,
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T10:00:00Z'),
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-12-31T00:00:00Z'),
      status: 'ACTIVE',
      enrollment: { coachId: 3, status: 'ACTIVE', remainingSessions: 4, startDate: new Date('2026-01-01T00:00:00Z'), expiryDate: new Date('2026-12-31T00:00:00Z') },
    })
    prisma.privateCourseAttendance.createMany.mockResolvedValue({ count: 0 })
    prisma.privateCourseAttendance.findUnique.mockResolvedValue({ id: 8 })
    prisma.privateCourseEnrollment.findUniqueOrThrow.mockResolvedValue({ remainingSessions: 3 })
    const result = await service.recordCompletedSession(6, '2026-10-22', 3)
    expect(result).toMatchObject({ attendance: { id: 8 }, remainingSessions: 3, alreadyRecorded: true })
    expect(prisma.privateCourseEnrollment.updateMany).not.toHaveBeenCalled()
  })
  it('only lets the enrollment owner change a private-course occurrence', async () => {
    prisma.privateCourseSchedule.findFirst.mockResolvedValue({
      id: 6,
      enrollmentId: 4,
      enrollment: { memberId: 2 },
    })

    await expect(service.changePrivateCourseOccurrence(
      4,
      6,
      '2026-10-21',
      5,
      { action: 'CANCELLED', reason: 'Schedule conflict' },
    )).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(prisma.privateCourseScheduleException.create).not.toHaveBeenCalled()
  })
  it('allows a private-course cancellation exactly 24 hours before the original start', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T08:00:00.000Z'))
    prisma.privateCourseSchedule.findFirst.mockResolvedValue({
      id: 6,
      enrollmentId: 4,
      dayOfWeek: 3,
      startTime: new Date('1970-01-01T08:00:00.000Z'),
      endTime: new Date('1970-01-01T09:00:00.000Z'),
      effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-11-30T00:00:00.000Z'),
      status: 'ACTIVE',
      roomId: 1,
      enrollment: {
        memberId: 2,
        coachId: 3,
        status: 'ACTIVE',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        expiryDate: new Date('2026-11-30T00:00:00.000Z'),
      },
      room: { id: 1 },
      exceptions: [],
      attendances: [],
    })
    prisma.privateCourseScheduleException.findUnique.mockResolvedValue(null)
    prisma.privateCourseScheduleException.create.mockImplementation(async ({ data }) => data)

    const result = await service.changePrivateCourseOccurrence(
      4,
      6,
      '2026-10-21',
      2,
      { action: 'CANCELLED', reason: 'Unavailable' },
    )

    expect(result).toMatchObject({ action: 'CANCELLED', reason: 'Unavailable' })
    expect(prisma.privateCourseScheduleException.create).toHaveBeenCalledOnce()
    expect(prisma.auditLog.create).toHaveBeenCalledOnce()
  })
  it('limits members to their own enrollments', async () => {
    prisma.privateCourseEnrollment.findMany.mockResolvedValue([])
    await service.getEnrollments(2, 'MEMBER')
    expect(prisma.privateCourseEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId: 2 },
      orderBy: { id: 'desc' },
      include: expect.objectContaining({
        member: { select: { userId: true, memberCode: true } },
        schedules: true,
      }),
    }))
  })
  it('limits coaches to enrollments they teach', async () => {
    prisma.privateCourseEnrollment.findMany.mockResolvedValue([])
    await service.getEnrollments(3, 'COACH')
    expect(prisma.privateCourseEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { coachId: 3 },
    }))
  })
  it.each(['RECEPTIONIST', 'CENTER_MANAGER'])('%s can view all enrollments newest first', async (role) => {
    prisma.privateCourseEnrollment.findMany.mockResolvedValue([])
    await service.getEnrollments(1, role)
    expect(prisma.privateCourseEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { id: 'desc' },
      include: expect.objectContaining({
        member: { select: { userId: true, memberCode: true } },
        schedules: true,
      }),
    }))
    expect(prisma.privateCourseEnrollment.findMany.mock.calls[0][0]).not.toHaveProperty('where')
  })
  it('rejects unsupported roles instead of returning all enrollments', async () => {
    await expect(service.getEnrollments(1, 'UNKNOWN')).rejects.toThrow('Bạn không có quyền')
    expect(prisma.privateCourseEnrollment.findMany).not.toHaveBeenCalled()
  })
})
