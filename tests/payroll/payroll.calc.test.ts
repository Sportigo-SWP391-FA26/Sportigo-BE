import { describe, expect, it } from 'vitest'
import { calculatePay, employedByPeriodEnd } from '../../src/modules/payroll/payroll.calc.js'
import { monthRange } from '../../src/modules/payroll/payroll.schema.js'

describe('Payroll monthly rules', () => {
  it('pays full base when no shift or session was scheduled', () => {
    expect(calculatePay({ baseSalary: 6_000_000, scheduledUnits: 0, absentUnits: 0, makeupCredit: 0, allowanceTotal: 0, deductionTotal: 0 })).toEqual({ absenceDeduction: 0, netAmount: 6_000_000 })
  })
  it('deducts one missing shift out of 20 and applies recurring items', () => {
    expect(calculatePay({ baseSalary: 6_000_000, scheduledUnits: 20, absentUnits: 1, makeupCredit: 0, allowanceTotal: 500_000, deductionTotal: 100_000 })).toEqual({ absenceDeduction: 300_000, netAmount: 6_100_000 })
  })
  it('credits a completed makeup without losing the original absence record', () => {
    expect(calculatePay({ baseSalary: 6_000_000, scheduledUnits: 20, absentUnits: 1, makeupCredit: 300_000, allowanceTotal: 0, deductionTotal: 0 })).toEqual({ absenceDeduction: 300_000, netAmount: 6_000_000 })
  })
  it('uses exact Vietnam local month boundaries', () => {
    const range = monthRange('2026-11')
    expect(range.start.toISOString()).toBe('2026-10-31T17:00:00.000Z')
    expect(range.endExclusive.toISOString()).toBe('2026-11-30T17:00:00.000Z')
  })
  it('excludes staff hired after the historical payroll period', () => {
    const range = monthRange('2026-10')
    expect(employedByPeriodEnd(new Date('2026-11-07T00:00:00.000Z'), range.endExclusive)).toBe(false)
    expect(employedByPeriodEnd(new Date('2026-05-07T00:00:00.000Z'), range.endExclusive)).toBe(true)
  })
})
