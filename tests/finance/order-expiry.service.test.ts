import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, tx, offerNext } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    serviceOrder: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    payment: { updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    onlineTransaction: { updateMany: vi.fn(), update: vi.fn() },
    classRegistration: { updateMany: vi.fn() },
    privateCourseEnrollment: { updateMany: vi.fn() },
    privateCourseSchedule: { updateMany: vi.fn() },
    promotionReservation: { updateMany: vi.fn() },
    walletTransaction: { findUnique: vi.fn(), create: vi.fn() },
    paymentAdjustment: { create: vi.fn() },
    wallet: { upsert: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { createMany: vi.fn() },
  }
  const prismaMock = {
    serviceOrder: { findMany: vi.fn() },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  }
  return { prismaMock, tx, offerNext: vi.fn() }
})

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../../src/modules/waitlist/waitlist.service.js', () => ({
  default: { offerNextInTransaction: offerNext },
}))

import { expirePendingOrders } from '../../src/modules/finance/order-expiry.service.js'
import { refundLateVnpayPayment } from '../../src/modules/finance/expired-payment-refund.js'

const decimal = (value: number) => new Prisma.Decimal(value)
const now = new Date('2026-11-10T10:00:00.000Z')

function dueOrder(classId?: number) {
  prismaMock.serviceOrder.findMany.mockResolvedValue([
    { id: 5, items: classId ? [{ classRegistration: { classId } }] : [{ classRegistration: null }] },
  ])
}

function loadedOrder(items: object[], payments: object[] = []) {
  tx.serviceOrder.findUniqueOrThrow.mockResolvedValue({ id: 5, memberId: 2, orderNumber: 'ORD-5', items, payments })
}

describe('expirePendingOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.$queryRaw.mockResolvedValue([{ id: 7 }])
    tx.notification.createMany.mockResolvedValue({ count: 1 })
    tx.serviceOrder.updateMany.mockResolvedValue({ count: 1 })
    tx.wallet.upsert.mockResolvedValue({ id: 9, balance: decimal(10), version: 1 })
    tx.wallet.updateMany.mockResolvedValue({ count: 1 })
    tx.walletTransaction.findUnique.mockResolvedValue(null)
  })

  it('frees the class seat and offers it to the waitlist', async () => {
    dueOrder(7)
    loadedOrder(
      [{ classRegistrationId: 11, privateEnrollmentId: null }],
      [{ id: 31, status: 'PENDING', amount: decimal(100), channel: 'ONLINE', adjustments: [] }],
    )

    await expect(expirePendingOrders(now)).resolves.toEqual({ expiredCount: 1, failedCount: 0 })

    expect(tx.classRegistration.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [11] }, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', cancelledAt: now },
    })
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [31] }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    expect(tx.promotionReservation.updateMany).toHaveBeenCalled()
    expect(offerNext).toHaveBeenCalledWith(tx, 7, now)
    expect(tx.wallet.updateMany).not.toHaveBeenCalled()
  })

  it('cancels a private enrollment so its schedule slots are released', async () => {
    dueOrder()
    loadedOrder([{ classRegistrationId: null, privateEnrollmentId: 21 }])

    await expirePendingOrders(now)

    expect(tx.privateCourseEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [21] }, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    })
    expect(tx.privateCourseSchedule.updateMany).toHaveBeenCalledWith({
      where: { enrollmentId: { in: [21] }, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    })
  })

  it('returns a partial wallet payment to the wallet', async () => {
    dueOrder(7)
    loadedOrder(
      [{ classRegistrationId: 11, privateEnrollmentId: null }],
      [{ id: 32, status: 'SUCCESS', amount: decimal(40), channel: 'WALLET', adjustments: [] }],
    )

    await expirePendingOrders(now)

    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: 32 }, data: { status: 'REFUNDED' } })
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ORDER_DEBIT_REVERSAL',
        amount: decimal(40),
        balanceAfter: decimal(50),
        idempotencyKey: 'EXPIRED_ORDER_REFUND:32',
      }),
    })
  })

  it('does nothing when the order was paid before the claim', async () => {
    dueOrder(7)
    tx.serviceOrder.updateMany.mockResolvedValue({ count: 0 })

    await expect(expirePendingOrders(now)).resolves.toEqual({ expiredCount: 0, failedCount: 0 })
    expect(tx.classRegistration.updateMany).not.toHaveBeenCalled()
    expect(offerNext).not.toHaveBeenCalled()
  })

  it('keeps processing other orders when one fails', async () => {
    prismaMock.serviceOrder.findMany.mockResolvedValue([{ id: 5, items: [] }, { id: 6, items: [] }])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    tx.serviceOrder.updateMany.mockRejectedValueOnce(new Error('boom'))
    loadedOrder([])

    await expect(expirePendingOrders(now)).resolves.toEqual({ expiredCount: 1, failedCount: 1 })
    consoleError.mockRestore()
  })
})

describe('refundLateVnpayPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.notification.createMany.mockResolvedValue({ count: 1 })
    tx.wallet.upsert.mockResolvedValue({ id: 9, balance: decimal(0), version: 1 })
    tx.wallet.updateMany.mockResolvedValue({ count: 1 })
    tx.walletTransaction.findUnique.mockResolvedValue(null)
  })

  it('records the late money and credits the wallet without activating the service', async () => {
    tx.payment.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findUniqueOrThrow.mockResolvedValue({
      id: 31, amount: decimal(100), channel: 'ONLINE', adjustments: [],
      order: { id: 5, memberId: 2, orderNumber: 'ORD-5' },
    })

    await expect(refundLateVnpayPayment(31, { vnp_TransactionNo: 'T1' })).resolves.toBe(true)

    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'REFUND_CREDIT', amount: decimal(100) }),
    })
    expect(tx.classRegistration.updateMany).not.toHaveBeenCalled()
  })

  it('ignores payments that are not on an expired order', async () => {
    tx.payment.updateMany.mockResolvedValue({ count: 0 })

    await expect(refundLateVnpayPayment(31, {})).resolves.toBe(false)
    expect(tx.wallet.updateMany).not.toHaveBeenCalled()
  })
})
