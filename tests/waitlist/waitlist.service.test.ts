import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prisma } = vi.hoisted(() => ({ prisma: {
  groupClass: { findUnique: vi.fn() }, classRegistration: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, classWaitlist: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  serviceOrder: { create: vi.fn() }, orderItem: { create: vi.fn() }, $transaction: vi.fn(),
  $queryRaw: vi.fn(),
} }))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function PrismaClientMock() { return prisma }), ClassStatus: { OPEN: 'OPEN' }, RegistrationStatus: { CONFIRMED: 'CONFIRMED', PENDING_PAYMENT: 'PENDING_PAYMENT', CANCELLED: 'CANCELLED' }, OrderStatus: { PENDING_PAYMENT: 'PENDING_PAYMENT' }, OrderItemType: { GROUP_CLASS: 'GROUP_CLASS' }, WaitlistStatus: { WAITING: 'WAITING', OFFERED: 'OFFERED', ACCEPTED: 'ACCEPTED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED' } }))
import { WaitlistService } from '../../src/modules/waitlist/waitlist.service.js'
const service = new WaitlistService()
const fullClass = () => ({ id: 1, status: 'OPEN', capacity: 1, _count: { registrations: 1 } })
describe('FR-25 / FR-26 Waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }])
    prisma.classWaitlist.updateMany.mockResolvedValue({ count: 1 })
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
  it('offers the earliest WAITING record and sets a response deadline', async () => {
    prisma.groupClass.findUnique.mockResolvedValue({ ...fullClass(), capacity: 2, _count: { registrations: 1 } })
    prisma.classWaitlist.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 8, joinedAt: new Date('2026-10-01') })
    prisma.classWaitlist.findUnique.mockResolvedValue({ id: 8, status: 'OFFERED' })
    const result = await service.processWaitlistOffer(1)
    expect(result.status).toBe('OFFERED')
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
    prisma.classWaitlist.findMany
      .mockResolvedValueOnce([{ classId: 1 }, { classId: 1 }])
      .mockResolvedValueOnce([])
    prisma.classWaitlist.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    prisma.groupClass.findUnique.mockResolvedValue(fullClass())

    await expect(service.expireOffers()).resolves.toMatchObject({ expiredCount: 1, processedClasses: 1 })
    await expect(service.expireOffers()).resolves.toMatchObject({ expiredCount: 0, processedClasses: 0 })
    expect(prisma.classWaitlist.findMany).toHaveBeenCalledTimes(2)
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
  })
})
