import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({ prisma: {
  groupClass: { findUnique: vi.fn() }, classRegistration: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, classWaitlist: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  classWaitlistInvitation: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  serviceOrder: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(async () => ({ id: 1, memberId: 1, orderNumber: 'ORD-1', payments: [] })) }, orderItem: { create: vi.fn() },
  payment: { findMany: vi.fn(), updateMany: vi.fn() }, onlineTransaction: { updateMany: vi.fn() }, $transaction: vi.fn(),
  // FR-54: offerNextInTransaction tạo thông báo mời cho người được chọn
  notification: { createMany: vi.fn(async () => ({ count: 1 })) },
  $queryRaw: vi.fn(),
} }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }), ClassStatus: { OPEN: 'OPEN' }, RegistrationStatus: { CONFIRMED: 'CONFIRMED', PENDING_PAYMENT: 'PENDING_PAYMENT', CANCELLED: 'CANCELLED' }, OrderStatus: { PENDING_PAYMENT: 'PENDING_PAYMENT', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED' }, OrderItemType: { GROUP_CLASS: 'GROUP_CLASS' }, WaitlistStatus: { WAITING: 'WAITING', OFFERED: 'OFFERED', ACCEPTED: 'ACCEPTED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED' }, WaitlistInvitationStatus: { OFFERED: 'OFFERED', ACCEPTED: 'ACCEPTED', DECLINED: 'DECLINED', EXPIRED: 'EXPIRED', PAYMENT_FAILED: 'PAYMENT_FAILED', PAYMENT_EXPIRED: 'PAYMENT_EXPIRED', FULFILLED: 'FULFILLED' } }))
import { WaitlistService } from '../../src/modules/waitlist/waitlist.service.js'
const service = new WaitlistService()
const fullClass = () => ({ id: 1, status: 'OPEN', capacity: 1, _count: { registrations: 1 } })
describe('FR-25 / FR-26 Waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }])
    prisma.classWaitlist.updateMany.mockResolvedValue({ count: 1 })
    prisma.classWaitlist.findMany.mockResolvedValue([])
    prisma.classWaitlistInvitation.updateMany.mockResolvedValue({ count: 1 })
    prisma.serviceOrder.findMany.mockResolvedValue([])
    prisma.serviceOrder.updateMany.mockResolvedValue({ count: 1 })
    prisma.classRegistration.updateMany.mockResolvedValue({ count: 1 })
    prisma.payment.findMany.mockResolvedValue([])
    prisma.payment.updateMany.mockResolvedValue({ count: 0 })
    prisma.onlineTransaction.updateMany.mockResolvedValue({ count: 0 })
    prisma.classWaitlistInvitation.findFirst.mockResolvedValue({ id: 90 })
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))
  })
  it('only allows joining when the class is full and open', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), _count: { registrations: 0 } })
    await expect(service.joinWaitlist(2, 1)).rejects.toThrow('vẫn còn chỗ trống')
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), status: 'CLOSED' })
    await expect(service.joinWaitlist(2, 1)).rejects.toThrow('không mở đăng ký')
  })
  it('rejects a member who already has an active registration', async () => {
    prisma.groupClass.findUnique.mockResolvedValue(fullClass())
    prisma.classRegistration.findUnique.mockResolvedValue({ id: 5, status: 'CONFIRMED' })
    await expect(service.joinWaitlist(2, 1)).rejects.toThrow('đăng ký chính thức')
  })
  it('rejects duplicate active waitlist membership', async () => {
    prisma.groupClass.findUnique.mockResolvedValue(fullClass())
    prisma.classRegistration.findUnique.mockResolvedValue(null)
    prisma.classWaitlist.findUnique.mockResolvedValue({ id: 7, status: 'WAITING' })
    await expect(service.joinWaitlist(2, 1)).rejects.toThrow('đã nằm trong danh sách chờ')
  })
  it('creates a WAITING record for a full class', async () => {
    prisma.groupClass.findUnique.mockResolvedValue(fullClass())
    prisma.classRegistration.findUnique.mockResolvedValue(null)
    prisma.classWaitlist.findUnique.mockResolvedValue(null)
    prisma.classWaitlist.create.mockResolvedValue({ id: 9, memberId: 2, classId: 1, status: 'WAITING' })
    await expect(service.joinWaitlist(2, 1)).resolves.toMatchObject({ status: 'WAITING' })
  })
  it('lists only the supplied Member waitlists and manager results are paginated', async () => {
    prisma.classWaitlist.findMany.mockResolvedValue([{ id: 9, memberId: 2, status: 'WAITING' }])
    prisma.classWaitlist.count.mockResolvedValue(1)
    await expect(service.getMemberWaitlists(2)).resolves.toEqual([{ id: 9, memberId: 2, status: 'WAITING' }])
    expect(prisma.classWaitlist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: 2 } }))
    await expect(service.listWaitlists({ classId: 1, status: 'WAITING' as never, page: 2, limit: 10 })).resolves.toMatchObject({
      items: [{ id: 9 }],
      page: 2,
      limit: 10,
      total: 1,
    })
    expect(prisma.classWaitlist.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { classId: 1, status: 'WAITING' },
      skip: 10,
      take: 10,
    }))
  })
  it('offers the earliest WAITING record and sets a response deadline', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), capacity: 2, _count: { registrations: 1 } })
    prisma.classWaitlist.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 8, memberId: 2, joinedAt: new Date('2026-10-01') })
    prisma.classWaitlist.findUnique.mockResolvedValue({ id: 8, status: 'OFFERED' })
    const result = await service.processWaitlistOffer(1)
    expect(result.status).toBe('OFFERED')
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 2, type: 'WAITLIST_OFFER' })],
    })
    expect(prisma.classWaitlist.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8, status: 'WAITING' },
      data: expect.objectContaining({ status: 'OFFERED' }),
    }))
    expect(prisma.classWaitlist.findFirst).toHaveBeenLastCalledWith({
      where: { classId: 1, status: 'WAITING' },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    })
  })
  it('expires due offers once per class and is safe to rerun', async () => {
    prisma.classWaitlist.findMany.mockResolvedValueOnce([{ classId: 1 }, { classId: 1 }])
    prisma.classWaitlist.findMany.mockResolvedValueOnce([{ id: 8 }])
    prisma.groupClass.findUnique.mockResolvedValue(fullClass())

    await expect(service.expireOffers()).resolves.toMatchObject({ expiredCount: 1, processedClasses: 1 })
    expect(prisma.classWaitlistInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { waitlistId: { in: [8] }, status: 'OFFERED' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }))
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
  it('creates a pending order and registration only when a member accepts an active offer', async () => {
    prisma.classWaitlist.findUnique.mockResolvedValue({ id: 8, status: 'OFFERED', offerExpiresAt: new Date(Date.now() + 60_000) })
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), capacity: 2, name: 'Swimming', tuitionFee: 500, registrationOpenAt: new Date(Date.now() - 60_000), registrationCloseAt: new Date(Date.now() + 60_000), _count: { registrations: 1 } })
    prisma.serviceOrder.create.mockResolvedValue({ id: 11, orderNumber: 'ORD-1', finalAmount: 500 })
    prisma.classRegistration.create.mockResolvedValue({ id: 12, status: 'PENDING_PAYMENT' })
    prisma.classWaitlist.findUnique
      .mockResolvedValueOnce({ id: 8, status: 'OFFERED', offerExpiresAt: new Date(Date.now() + 60_000) })
      .mockResolvedValueOnce({ id: 8, status: 'ACCEPTED' })
    const result = await service.respondToOffer(2, 1, true)
    expect(result.registration).toMatchObject({ id: 12, status: 'PENDING_PAYMENT' })
    expect(prisma.classWaitlist.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 8, status: 'OFFERED', offerExpiresAt: expect.objectContaining({ gt: expect.any(Date) }) },
      data: { status: 'ACCEPTED' },
    }))
    expect(prisma.orderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orderId: 11, classRegistrationId: 12 }) })
    expect(prisma.classWaitlistInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 90, status: 'OFFERED' },
      data: expect.objectContaining({ status: 'ACCEPTED', orderId: 11 }),
    }))
  })
  it('declines an offer and passes it to the next waiting member', async () => {
    prisma.classWaitlist.findUnique
      .mockResolvedValueOnce({ id: 8, status: 'OFFERED', offerExpiresAt: new Date(Date.now() + 60_000) })
      .mockResolvedValueOnce({ id: 8, status: 'CANCELLED' })
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), capacity: 2, _count: { registrations: 1 } })
    prisma.classWaitlist.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await expect(service.respondToOffer(2, 1, false)).resolves.toMatchObject({ order: null })
    expect(prisma.classWaitlistInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 90, status: 'OFFERED' },
      data: expect.objectContaining({ status: 'DECLINED' }),
    }))
  })
  it('releases accepted waitlist bookings after a failed payment and advances the queue', async () => {
    prisma.classWaitlistInvitation.findUnique.mockResolvedValue({
      id: 90,
      waitlistId: 8,
      status: 'ACCEPTED',
      waitlist: { memberId: 2, classId: 1 },
    })
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), capacity: 2, _count: { registrations: 0 } })
    prisma.classWaitlist.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await expect(service.failAcceptedInvitationInTransaction(prisma as never, 11, new Date())).resolves.toBe(true)
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    })
    expect(prisma.classRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId: 2, classId: 1, status: 'PENDING_PAYMENT' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }))
    expect(prisma.classWaitlistInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 90, status: 'ACCEPTED' },
      data: expect.objectContaining({ status: 'PAYMENT_FAILED', failureReason: 'PAYMENT_FAILED' }),
    }))
  })
  it('expires accepted orders, releases reserved capacity, and invites the next Member', async () => {
    prisma.serviceOrder.findMany
      .mockResolvedValueOnce([{ id: 11, waitlistInvitation: { waitlist: { classId: 1 } } }])
      .mockResolvedValueOnce([{
        id: 11,
        waitlistInvitation: { id: 90, waitlistId: 8, waitlist: { memberId: 2, classId: 1 } },
        items: [{ classRegistrationId: 12 }],
        payments: [{ id: 14, status: 'PENDING', amount: 0, adjustments: [] }],
      }])
    prisma.classWaitlist.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), _count: { registrations: 0 } })
    prisma.classWaitlist.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await expect(service.expireOffers(new Date())).resolves.toMatchObject({
      expiredCount: 0,
      expiredPaymentCount: 1,
      processedClasses: 1,
    })
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 11, status: 'PENDING_PAYMENT' }),
      data: { status: 'EXPIRED' },
    }))
    expect(prisma.classWaitlistInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 90, status: 'ACCEPTED' },
      data: expect.objectContaining({ status: 'PAYMENT_EXPIRED', failureReason: 'PAYMENT_EXPIRED' }),
    }))
    expect(prisma.onlineTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { paymentId: { in: [14] }, status: 'PENDING' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }))
  })
  it('marks a waitlist invitation fulfilled only after a paid order is finalized', async () => {
    await service.markInvitationFulfilled(prisma as never, 11, new Date())
    expect(prisma.classWaitlistInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 11, status: 'ACCEPTED' },
      data: expect.objectContaining({ status: 'FULFILLED' }),
    }))
  })
})
