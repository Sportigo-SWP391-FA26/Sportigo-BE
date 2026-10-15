import { describe, expect, it } from 'vitest'
import { calculateDiscount, calculateRefundable, calculateRemaining, isFullyRefunded } from '../../src/modules/finance/finance.math.js'

describe('finance money invariants', () => {
  it('calculates percentage and capped discounts without making an order negative', () => {
    expect(calculateDiscount({ originalAmount: 1_000_000, discountType: 'PERCENTAGE', discountValue: 20, maxDiscount: 150_000 }).toNumber()).toBe(150_000)
    expect(calculateDiscount({ originalAmount: 100_000, discountType: 'FIXED_AMOUNT', discountValue: 300_000 }).toNumber()).toBe(100_000)
  })

  it('calculates remaining amount for mixed wallet and online payments', () => {
    expect(calculateRemaining(500_000, [{ amount: 100_000, status: 'SUCCESS' }, { amount: 200_000, status: 'PENDING' }]).toNumber()).toBe(400_000)
  })

  it('subtracts completed refunds and detects full refund at payment and order level', () => {
    expect(calculateRefundable(500_000, [{ amount: 100_000, type: 'REFUND' }]).toNumber()).toBe(400_000)
    expect(isFullyRefunded(500_000, [100_000, 150_000], 250_000)).toBe(true)
    expect(isFullyRefunded(800_000, [100_000], 500_000)).toBe(false)
  })
})
