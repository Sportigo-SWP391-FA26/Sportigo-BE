import { describe, expect, it } from 'vitest'
import { promotionSchema, refundReviewSchema, walletPaymentSchema } from '../../src/modules/finance/finance.schema.js'

describe('finance request validation', () => {
  it('normalizes promotion codes and rejects an invalid period', () => {
    const valid = promotionSchema.parse({ code: ' sport10 ', name: 'Sportigo 10%', discountType: 'PERCENTAGE', discountValue: 10, startAt: '2026-10-15', endAt: '2026-11-15' })
    expect(valid.code).toBe('SPORT10')
    expect(() => promotionSchema.parse({ ...valid, endAt: new Date('2026-01-01') })).toThrow()
  })

  it('requires a positive wallet amount and a manager note', () => {
    expect(walletPaymentSchema.safeParse({ amount: 0 }).success).toBe(false)
    expect(refundReviewSchema.safeParse({ decision: 'APPROVE', note: '' }).success).toBe(false)
  })
})
