import { describe, expect, it } from 'vitest'
import { SCORE_LEVELS, SCORE_MAX, toScoreLevel } from '../../src/modules/training/assessment-level.js'

describe('FR-52 / FR-53 Mức đánh giá theo Điểm tổng (thang 10)', () => {
  it('xếp mức theo ngưỡng 8,5 / 7 / 5, kể cả điểm lẻ ở sát ngưỡng', () => {
    expect(toScoreLevel(10)).toBe('EXCELLENT')
    expect(toScoreLevel(8.5)).toBe('EXCELLENT')
    expect(toScoreLevel(8.45)).toBe('GOOD')
    expect(toScoreLevel(7)).toBe('GOOD')
    expect(toScoreLevel(6.99)).toBe('AVERAGE')
    expect(toScoreLevel(5)).toBe('AVERAGE')
    expect(toScoreLevel(4.99)).toBe('NEEDS_IMPROVEMENT')
    expect(toScoreLevel(0)).toBe('NEEDS_IMPROVEMENT')
  })

  it('đọc được Decimal của Prisma và trả null khi không chấm điểm', () => {
    expect(toScoreLevel({ toString: () => '7.80' })).toBe('GOOD')
    expect(toScoreLevel(null)).toBeNull()
  })

  it('các mức phủ kín 0–10, liền nhau theo bước 0,1', () => {
    const sorted = [...SCORE_LEVELS].sort((a, b) => a.min - b.min)
    expect(sorted[0]!.min).toBe(0)
    expect(sorted.at(-1)!.max).toBe(SCORE_MAX)
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]!.min).toBeCloseTo(sorted[index - 1]!.max + 0.1)
    }
  })
})
