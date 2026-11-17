import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }))
vi.mock('../../src/lib/prisma.js', () => ({ prisma: { $queryRaw: queryRaw } }))
import { changeRate, periodStart, revenueAnalytics, shiftPeriod } from '../../src/modules/finance/revenue-analytics.js'

describe('revenue period analytics', () => {
  beforeEach(() => queryRaw.mockReset())

  it('uses calendar month, quarter and year boundaries', () => {
    expect(periodStart('2026-11-17', 'MONTH')).toBe('2026-11-01')
    expect(periodStart('2026-11-17', 'QUARTER')).toBe('2026-10-01')
    expect(periodStart('2026-11-17', 'YEAR')).toBe('2026-01-01')
    expect(shiftPeriod('2024-02-01', 'MONTH', 1)).toBe('2024-03-01')
    expect(shiftPeriod('2026-10-01', 'QUARTER', -1)).toBe('2026-07-01')
    expect(changeRate(100, 0)).toBeNull()
  })

  it('compares an unfinished month with the same number of days', async () => {
    queryRaw.mockResolvedValue([
      { day: '2025-11-16', gross: 50, refunds: 0, transactions: 1n },
      { day: '2026-10-17', gross: 100, refunds: 0, transactions: 1n },
      { day: '2026-10-18', gross: 900, refunds: 0, transactions: 1n },
      { day: '2026-11-17', gross: 250, refunds: 50, transactions: 2n },
    ])
    const result = await revenueAnalytics({ period: 'MONTH' }, new Date('2026-11-17T10:00:00+07:00'))
    expect(result.current.net).toBe(200)
    expect(result.previous.net).toBe(100)
    expect(result.yearAgo.net).toBe(50)
    expect(result.change).toEqual({ previous: 1, yearAgo: 3 })
    expect(result.current.averageTransaction).toBe(125)
    expect(result.current.refundRate).toBe(.2)
    expect(result.trend).toHaveLength(12)
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it('rejects a future report period', async () => {
    await expect(revenueAnalytics({ period: 'YEAR', anchor: '2027-01-01' }, new Date('2026-11-17T10:00:00+07:00'))).rejects.toMatchObject({ status: 422 })
  })

  it('returns zero values and no growth rate when the comparison period has no data', async () => {
    queryRaw.mockResolvedValue([])
    const result = await revenueAnalytics({ period: 'QUARTER' }, new Date('2026-11-17T10:00:00+07:00'))
    expect(result.current).toEqual({ gross: 0, refunds: 0, net: 0, transactions: 0, averageTransaction: 0, refundRate: 0 })
    expect(result.change).toEqual({ previous: null, yearAgo: null })
    expect(result.trend).toHaveLength(8)
  })
})
