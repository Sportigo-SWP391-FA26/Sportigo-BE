import { describe, expect, it } from 'vitest'
import { auditListSchema, cashOrderSearchSchema, classReportSchema, promotionSchema, promotionUpdateSchema, refundReviewSchema, revenueReportSchema, walletPaymentSchema, walletTopUpSchema } from '../../src/modules/finance/finance.schema.js'

describe('finance request validation', () => {
  it('normalizes promotion codes and rejects an invalid period', () => {
    const valid = promotionSchema.parse({ code: ' sport10 ', name: 'Sportigo 10%', discountType: 'PERCENTAGE', discountValue: 10, startAt: '2026-10-15', endAt: '2026-11-15' })
    expect(valid.code).toBe('SPORT10')
    expect(() => promotionSchema.parse({ ...valid, endAt: new Date('2026-01-01') })).toThrow()
    expect(promotionUpdateSchema.parse({ status: 'INACTIVE' }).status).toBe('INACTIVE')
  })

  it('requires a positive wallet amount and a manager note', () => {
    expect(walletPaymentSchema.safeParse({ amount: 0 }).success).toBe(false)
    expect(refundReviewSchema.safeParse({ decision: 'APPROVE', note: '' }).success).toBe(false)
  })

  it('validates wallet top-up limits and cashier search input', () => {
    expect(walletTopUpSchema.parse({ amount: 100000 }).amount).toBe(100000)
    expect(walletTopUpSchema.safeParse({ amount: 9999 }).success).toBe(false)
    expect(cashOrderSearchSchema.parse({ q: ' MEM-001 ' }).q).toBe('MEM-001')
    expect(cashOrderSearchSchema.safeParse({ q: 'A' }).success).toBe(false)
  })

  it('parses report and audit filters', () => {
    expect(revenueReportSchema.parse({ channel: 'WALLET', itemType: 'GROUP_CLASS' }).channel).toBe('WALLET')
    expect(classReportSchema.parse({ sportId: '2' }).sportId).toBe(2)
    expect(auditListSchema.parse({ actorId: '3', action: 'REFUND' }).actorId).toBe(3)
  })
})
