import { describe, expect, it } from 'vitest'
import { parseDateOnly, toCenterDateOnly, toDateOnly } from '../../src/modules/training/training.common.js'

describe('Flow 4 timezone Asia/Ho_Chi_Minh', () => {
  it('không lệch ngày với instant sát nửa đêm UTC', () => {
    expect(toCenterDateOnly(new Date('2026-11-05T17:30:00.000Z'))).toBe('2026-11-06')
    expect(toCenterDateOnly(new Date('2026-11-05T16:59:59.000Z'))).toBe('2026-11-05')
  })

  it('parse date-only ổn định bất kể timezone máy chủ', () => {
    expect(toDateOnly(parseDateOnly('2026-11-06'))).toBe('2026-11-06')
  })

  it('từ chối chuỗi không phải date-only', () => {
    expect(() => parseDateOnly('2026-11-06T00:00:00Z')).toThrow('Ngày không hợp lệ')
  })
})
