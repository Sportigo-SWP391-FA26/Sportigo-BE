import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({
  prisma: {
    groupClass: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    classRegistration: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    classSession: { findMany: vi.fn() },
    privateCourseSchedule: { findMany: vi.fn() },
    member: { findUnique: vi.fn() },
    serviceOrder: { create: vi.fn(), updateMany: vi.fn() },
    orderItem: { create: vi.fn() },
    classWaitlist: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    wallet: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    walletTransaction: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function PrismaClientMock() {
    return prisma
  }),
  ClassStatus: { OPEN: 'OPEN', CANCELLED: 'CANCELLED' },
  RegistrationStatus: {
    CONFIRMED: 'CONFIRMED',
    PENDING_PAYMENT: 'PENDING_PAYMENT',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
  },
  WaitlistStatus: {
    WAITING: 'WAITING',
    OFFERED: 'OFFERED',
    EXPIRED: 'EXPIRED',
    CANCELLED: 'CANCELLED',
    ACCEPTED: 'ACCEPTED',
  },
  OrderStatus: { PENDING_PAYMENT: 'PENDING_PAYMENT', CANCELLED: 'CANCELLED' },
  OrderItemType: { GROUP_CLASS: 'GROUP_CLASS' },
}))

import { BookingService } from '../../src/modules/bookings/booking.service.js'

const service = new BookingService()

describe('FR-21–FR-24 / FR-28 Group class booking', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prisma.classSession.findMany.mockResolvedValue([])
    prisma.privateCourseSchedule.findMany.mockResolvedValue([])
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }])
    prisma.member.findUnique.mockResolvedValue({ userId: 2 })
    prisma.classWaitlist.updateMany.mockResolvedValue({ count: 0 })
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    )
  })

  it('applies filters and pagination to public class listing', async () => {
    prisma.groupClass.findMany.mockResolvedValue([])
    prisma.groupClass.count.mockResolvedValue(0)
    const result = await service.getPublicClasses({
      sportId: 2,
      coachId: 3,
      page: 2,
      limit: 5,
    })

    expect(result.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 0,
      totalPages: 0,
    })
    expect(prisma.groupClass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'OPEN', sportId: 2, coachId: 3 },
        skip: 5,
        take: 5,
      }),
    )
  })

  it('calculates confirmed count and remaining seats in class detail', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      capacity: 12,
      _count: { registrations: 7 },
      name: 'Swimming',
    })
    prisma.classRegistration.count.mockResolvedValue(0)

    await expect(service.getClassDetail(1)).resolves.toMatchObject({
      confirmedCount: 7,
      remainingSeats: 5,
    })
  })

  it('rejects registration when class is not open', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      status: 'DRAFT',
      registrationOpenAt: new Date(0),
      registrationCloseAt: new Date(Date.now() + 100000),
      startDate: new Date(Date.now() + 200000),
      capacity: 10,
      _count: { registrations: 0 },
    })
    await expect(service.registerClass(2, 1)).rejects.toThrow(
      'không mở đăng ký',
    )
  })

  it('rejects registration when the registration window has not opened', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      status: 'OPEN',
      registrationOpenAt: new Date(Date.now() + 60_000),
      registrationCloseAt: new Date(Date.now() + 120_000),
      startDate: new Date(Date.now() + 180_000),
      capacity: 10,
      _count: { registrations: 0 },
    })
    await expect(service.registerClass(2, 1)).rejects.toThrow(
      'Chưa đến thời gian mở đăng ký',
    )
  })

  it('rejects a full class before creating an order', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      name: 'Swimming',
      status: 'OPEN',
      registrationOpenAt: new Date(Date.now() - 60_000),
      registrationCloseAt: new Date(Date.now() + 60_000),
      startDate: new Date(Date.now() + 120_000),
      capacity: 1,
      _count: { registrations: 1 },
    })
    await expect(service.registerClass(2, 1)).rejects.toThrow('hết chỗ')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates pending registration, order and order item for a valid request', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      name: 'Swimming',
      status: 'OPEN',
      tuitionFee: 500,
      registrationOpenAt: new Date(Date.now() - 60_000),
      registrationCloseAt: new Date(Date.now() + 60_000),
      startDate: new Date(Date.now() + 120_000),
      capacity: 10,
      _count: { registrations: 0 },
    })
    prisma.classRegistration.findUnique.mockResolvedValue(null)
    prisma.serviceOrder.create.mockResolvedValue({
      id: 11,
      orderNumber: 'ORD-1',
      finalAmount: 500,
      expiresAt: new Date(),
    })
    prisma.classRegistration.create.mockResolvedValue({
      id: 12,
      status: 'PENDING_PAYMENT',
    })
    prisma.orderItem.create.mockResolvedValue({ id: 13 })

    const result = await service.registerClass(2, 1)

    expect(result).toMatchObject({
      orderId: 11,
      registrationId: 12,
      amount: 500,
      status: 'PENDING_PAYMENT',
    })
    expect(prisma.orderItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 11,
        classRegistrationId: 12,
        itemType: 'GROUP_CLASS',
      }),
    })
  })

  it('rejects a class booking that overlaps a confirmed class session', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      name: 'Swimming',
      status: 'OPEN',
      tuitionFee: 500,
      registrationOpenAt: new Date(Date.now() - 60_000),
      registrationCloseAt: new Date(Date.now() + 60_000),
      startDate: new Date(Date.now() + 120_000),
      capacity: 10,
      _count: { registrations: 0 },
    })
    prisma.classRegistration.findUnique.mockResolvedValue(null)
    prisma.classSession.findMany
      .mockResolvedValueOnce([
        {
          startsAt: new Date('2026-11-10T10:00:00Z'),
          endsAt: new Date('2026-11-10T11:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          startsAt: new Date('2026-11-10T10:30:00Z'),
          endsAt: new Date('2026-11-10T11:30:00Z'),
        },
      ])
    await expect(service.registerClass(2, 1)).rejects.toThrow(
      'Lịch học của hội viên bị chồng lấn',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('allows a receptionist to register a known member through the same booking rules', async () => {
    prisma.member.findUnique.mockResolvedValue({ userId: 2 })
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      name: 'Swimming',
      status: 'OPEN',
      tuitionFee: 500,
      registrationOpenAt: new Date(Date.now() - 60_000),
      registrationCloseAt: new Date(Date.now() + 60_000),
      startDate: new Date(Date.now() + 120_000),
      capacity: 10,
      _count: { registrations: 0 },
    })
    prisma.classRegistration.findUnique.mockResolvedValue(null)
    prisma.serviceOrder.create.mockResolvedValue({
      id: 11,
      orderNumber: 'ORD-1',
      finalAmount: 500,
      expiresAt: new Date(),
    })
    prisma.classRegistration.create.mockResolvedValue({
      id: 12,
      status: 'PENDING_PAYMENT',
    })

    await service.registerClassOnBehalf(2, 1)

    expect(prisma.member.findUnique).toHaveBeenCalledWith({
      where: { userId: 2 },
      select: { userId: true },
    })
    expect(prisma.classRegistration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 2, classId: 1 }),
    })
  })

  it('refunds confirmed members and cancels pending registrations when the center cancels a class', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({
      id: 1,
      name: 'Swimming',
      status: 'OPEN',
      registrations: [
        { id: 12, memberId: 2, status: 'CONFIRMED', price: 500 },
        { id: 13, memberId: 3, status: 'PENDING_PAYMENT', price: 500 },
      ],
    })
    prisma.wallet.upsert.mockResolvedValue({ id: 8, balance: 100 })
    prisma.groupClass.update.mockResolvedValue({ id: 1, status: 'CANCELLED' })

    const result = await service.cancelGroupClass(1, 99)

    expect(result).toMatchObject({
      classId: 1,
      refundedAmount: 500,
      cancelledRegistrations: 2,
    })
    expect(prisma.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdById: 99,
        amount: 500,
        idempotencyKey: 'CLASS-CANCEL-1-12',
      }),
    })
    expect(prisma.classRegistration.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({ status: 'REFUNDED' }),
    })
    expect(prisma.classRegistration.update).toHaveBeenCalledWith({
      where: { id: 13 },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    })
  })
})
