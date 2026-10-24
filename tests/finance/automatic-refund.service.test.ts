import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { refundClassRegistrationToWallet } from '../../src/modules/finance/automatic-refund.service.js'

const decimal = (value: number) => new Prisma.Decimal(value)

function createTx() {
  return {
    walletTransaction: { findUnique: vi.fn(), create: vi.fn() },
    serviceOrder: { findFirst: vi.fn(), update: vi.fn() },
    paymentAdjustment: { create: vi.fn() },
    payment: { update: vi.fn() },
    wallet: { upsert: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  }
}

describe('automatic class cancellation refund', () => {
  it('refunds only the amount actually paid and records the complete finance trail', async () => {
    const tx = createTx()
    tx.walletTransaction.findUnique.mockResolvedValue(null)
    tx.serviceOrder.findFirst.mockResolvedValue({
      id: 20,
      memberId: 2,
      payments: [
        { id: 31, status: 'SUCCESS', amount: decimal(100), adjustments: [] },
        { id: 32, status: 'PARTIALLY_REFUNDED', amount: decimal(350), adjustments: [{ type: 'REFUND', amount: decimal(50) }] },
      ],
    })
    tx.wallet.upsert.mockResolvedValue({ id: 9, balance: decimal(25), version: 3 })
    tx.wallet.updateMany.mockResolvedValue({ count: 1 })

    const result = await refundClassRegistrationToWallet(tx as never, {
      registrationId: 12,
      memberId: 2,
      actorId: 2,
      reason: 'Hủy đúng hạn',
      idempotencyKey: 'CLASS_REGISTRATION_AUTO_REFUND:12',
    })

    expect(result).toEqual({ amount: 400, alreadyProcessed: false })
    expect(tx.paymentAdjustment.create).toHaveBeenCalledTimes(2)
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: decimal(400),
        balanceBefore: decimal(25),
        balanceAfter: decimal(425),
        idempotencyKey: 'CLASS_REGISTRATION_AUTO_REFUND:12',
      }),
    })
    expect(tx.serviceOrder.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { status: 'REFUNDED' },
    })
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('returns the previous credit when the same cancellation is retried', async () => {
    const tx = createTx()
    tx.walletTransaction.findUnique.mockResolvedValue({ amount: decimal(450) })

    const result = await refundClassRegistrationToWallet(tx as never, {
      registrationId: 12,
      memberId: 2,
      actorId: 2,
      reason: 'Hủy đúng hạn',
      idempotencyKey: 'CLASS_REGISTRATION_AUTO_REFUND:12',
    })

    expect(result).toEqual({ amount: 450, alreadyProcessed: true })
    expect(tx.serviceOrder.findFirst).not.toHaveBeenCalled()
  })
})
