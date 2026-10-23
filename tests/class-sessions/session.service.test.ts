import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({  notification: { createMany: vi.fn() },
  prisma: {
    classSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    privateCourseSchedule: { findFirst: vi.fn(), findMany: vi.fn() },
    classRegistration: { findMany: vi.fn() },
    coachAvailability: { findMany: vi.fn() },
    groupClass: { findUnique: vi.fn() },
    room: { findUnique: vi.fn() },
    notification: { createMany: vi.fn() },
    scheduleChange: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function PrismaClientMock() {
    return prisma
  }),
  SessionStatus: { SCHEDULED: 'SCHEDULED' },
  AvailabilityStatus: { AVAILABLE: 'AVAILABLE' },
}))
import { SessionService } from '../../src/modules/class-sessions/session.service.js'
const service = new SessionService()
describe('FR-17–FR-20 Class session scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.classRegistration.findMany.mockResolvedValue([])
    prisma.privateCourseSchedule.findMany.mockResolvedValue([])
    prisma.coachAvailability.findMany.mockResolvedValue([{
      dayOfWeek: 0,
      startTime: new Date('1970-01-01T00:00:00Z'),
      endTime: new Date('1970-01-01T23:59:00Z'),
      effectiveFrom: new Date('2026-10-01T00:00:00Z'),
      effectiveTo: new Date('2026-12-01T00:00:00Z'),
    }])
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    )
  })
  it('detects room overlap using strict interval overlap', async () => {
    prisma.classSession.findFirst.mockResolvedValue({ id: 2 })
    await expect(
      service.checkRoomConflict(
        3,
        new Date('2026-11-01T10:00:00Z'),
        new Date('2026-11-01T11:00:00Z'),
      ),
    ).resolves.toBe(true)
    expect(prisma.classSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roomId: 3, status: 'SCHEDULED' }),
      }),
    )
  })
  it('detects a coach conflict with another group-class session', async () => {
    prisma.classSession.findFirst.mockResolvedValueOnce({ id: 4 })
    await expect(
      service.checkCoachConflict(
        10,
        new Date('2026-11-01T10:00:00Z'),
        new Date('2026-11-01T11:00:00Z'),
      ),
    ).resolves.toBe(true)
    expect(prisma.privateCourseSchedule.findFirst).not.toHaveBeenCalled()
  })
  it('rejects a session whose end is not after its start', async () => {
    await expect(
      service.createSession({
        classId: 1,
        roomId: 1,
        startsAt: '2026-11-01T11:00:00Z',
        endsAt: '2026-11-01T10:00:00Z',
      }),
    ).rejects.toThrow('phải sau thời gian bắt đầu')
  })
  it('rejects sessions outside the group class date range', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-11-02'),
      endDate: new Date('2026-12-01'),
      capacity: 10,
      coachId: 10,
    })
    await expect(
      service.createSession({
        classId: 1,
        roomId: 1,
        startsAt: '2026-11-01T10:00:00Z',
        endsAt: '2026-11-01T11:00:00Z',
      }),
    ).rejects.toThrow('nằm ngoài khoảng thời gian')
  })
  it('rejects a room in maintenance or with insufficient capacity', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-12-01'),
      capacity: 20,
      coachId: 10,
    })
    prisma.room.findUnique.mockResolvedValue({
      id: 1,
      status: 'MAINTENANCE',
      capacity: 30,
    })
    await expect(
      service.createSession({
        classId: 1,
        roomId: 1,
        startsAt: '2026-11-01T10:00:00Z',
        endsAt: '2026-11-01T11:00:00Z',
      }),
    ).rejects.toThrow('không khả dụng')
    prisma.room.findUnique.mockResolvedValue({
      id: 1,
      status: 'AVAILABLE',
      capacity: 10,
    })
    await expect(
      service.createSession({
        classId: 1,
        roomId: 1,
        startsAt: '2026-11-01T10:00:00Z',
        endsAt: '2026-11-01T11:00:00Z',
      }),
    ).rejects.toThrow('không đủ')
  })
  it('creates a batch of sessions atomically after validating the complete schedule', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-12-01'),
      capacity: 10,
      coachId: 10,
    })
    prisma.room.findUnique.mockResolvedValue({ id: 1, status: 'AVAILABLE', capacity: 20 })
    prisma.classSession.findFirst.mockResolvedValue(null)
    prisma.privateCourseSchedule.findFirst.mockResolvedValue(null)
    prisma.classSession.create.mockImplementation(async ({ data }) => data)
    await expect(service.createSessions(1, [
      { roomId: 1, startsAt: '2026-11-01T10:00:00Z', endsAt: '2026-11-01T11:00:00Z' },
      { roomId: 1, startsAt: '2026-11-08T10:00:00Z', endsAt: '2026-11-08T11:00:00Z' },
    ])).resolves.toHaveLength(2)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
  it('expands an inclusive weekly recurrence into persisted class sessions', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-11-22T00:00:00Z'),
      capacity: 10,
      coachId: 10,
    })
    prisma.room.findUnique.mockResolvedValue({ id: 1, status: 'AVAILABLE', capacity: 20 })
    prisma.classSession.findFirst.mockResolvedValue(null)
    prisma.privateCourseSchedule.findFirst.mockResolvedValue(null)
    prisma.classSession.create.mockImplementation(async ({ data }) => data)

    const result = await service.createRecurringSessions(1, {
      roomId: 1,
      recurrence: {
        dayOfWeek: 0,
        startTime: '10:00',
        endTime: '11:00',
        effectiveFrom: '2026-11-01',
        effectiveTo: '2026-11-22',
      },
    })

    expect(result).toHaveLength(4)
    expect(result.map((session) => session.startsAt.toISOString())).toEqual([
      '2026-11-01T10:00:00.000Z',
      '2026-11-08T10:00:00.000Z',
      '2026-11-15T10:00:00.000Z',
      '2026-11-22T10:00:00.000Z',
    ])
    expect(prisma.classSession.create).toHaveBeenCalledTimes(4)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
  it('validates later recurrence occurrences and writes none when a later week conflicts', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-11-22T00:00:00Z'),
      capacity: 10,
      coachId: 10,
    })
    prisma.room.findUnique.mockResolvedValue({ id: 1, status: 'AVAILABLE', capacity: 20 })
    prisma.classSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99 })

    await expect(service.createRecurringSessions(1, {
      roomId: 1,
      recurrence: {
        dayOfWeek: 0,
        startTime: '10:00',
        endTime: '11:00',
        effectiveFrom: '2026-11-01',
        effectiveTo: '2026-11-15',
      },
    })).rejects.toMatchObject({ status: 409, code: 'ROOM_SCHEDULE_CONFLICT' })

    expect(prisma.classSession.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('allows adjacent intervals and rejects recurrence ranges outside class dates', async () => {
    prisma.classSession.findFirst.mockResolvedValue(null)
    await expect(service.checkRoomConflict(
      3,
      new Date('2026-11-01T10:00:00Z'),
      new Date('2026-11-01T11:00:00Z'),
    )).resolves.toBe(false)
    expect(prisma.classSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          { startsAt: { lt: new Date('2026-11-01T11:00:00Z') } },
          { endsAt: { gt: new Date('2026-11-01T10:00:00Z') } },
        ],
      }),
    }))

    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-11-22T00:00:00Z'),
      capacity: 10,
      coachId: 10,
    })
    await expect(service.createRecurringSessions(1, {
      roomId: 1,
      recurrence: {
        dayOfWeek: 0,
        startTime: '10:00',
        endTime: '11:00',
        effectiveFrom: '2026-10-25',
        effectiveTo: '2026-11-22',
      },
    })).rejects.toMatchObject({ status: 409, code: 'RECURRENCE_OUTSIDE_CLASS_DATES' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('rejects overlapping sessions within a batch before creating any records', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-12-01'),
      capacity: 10,
      coachId: 10,
    })
    prisma.room.findUnique.mockResolvedValue({ id: 1, status: 'AVAILABLE', capacity: 20 })
    prisma.classSession.findFirst.mockResolvedValue(null)
    prisma.privateCourseSchedule.findFirst.mockResolvedValue(null)
    await expect(service.createSessions(1, [
      { roomId: 1, startsAt: '2026-11-01T10:00:00Z', endsAt: '2026-11-01T11:00:00Z' },
      { roomId: 2, startsAt: '2026-11-01T10:30:00Z', endsAt: '2026-11-01T11:30:00Z' },
    ])).rejects.toThrow('cùng yêu cầu bị chồng lấn')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('records old/new schedule details when a session is changed', async () => {
    prisma.classSession.findUnique.mockResolvedValue({
      id: 5,
      status: 'SCHEDULED',
      startsAt: new Date('2026-11-01T10:00:00Z'),
      endsAt: new Date('2026-11-01T11:00:00Z'),
      roomId: 1,
      groupClass: {
        name: 'Test Class',
        coachId: 10,
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: new Date('2026-12-01T00:00:00Z'),
        registrations: [],
      },
    })
    prisma.classSession.findFirst.mockResolvedValue(null)
    prisma.privateCourseSchedule.findFirst.mockResolvedValue(null)
    prisma.classSession.update.mockResolvedValue({ id: 5, roomId: 2 })
    await service.changeSession(5, 99, {
      newRoomId: 2,
      reason: 'Room maintenance',
    })
    expect(prisma.scheduleChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        classSessionId: 5,
        changedById: 99,
        oldRoomId: 1,
        newRoomId: 2,
        reason: 'Room maintenance',
      }),
    })
  })
})
