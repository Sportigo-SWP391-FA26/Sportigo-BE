import { describe, expect, it } from 'vitest'
import { validateAvailabilitySelections } from '../src/modules/coach-availability/coach-availability.rules.js'

const valid = [
  { dayOfWeek: 1, shiftCode: 'S1' }, { dayOfWeek: 1, shiftCode: 'S2' },
  { dayOfWeek: 2, shiftCode: 'S1' }, { dayOfWeek: 2, shiftCode: 'S2' },
  { dayOfWeek: 3, shiftCode: 'S3' }, { dayOfWeek: 3, shiftCode: 'S4' },
  { dayOfWeek: 4, shiftCode: 'S5' }, { dayOfWeek: 4, shiftCode: 'S6' },
  { dayOfWeek: 5, shiftCode: 'S6' }, { dayOfWeek: 5, shiftCode: 'S7' },
]

describe('Coach availability validation', () => {
  it('accepts 10 fixed shifts across 5 days with 2 shifts per day', () => {
    expect(validateAvailabilitySelections(valid)).toMatchObject({ totalShifts: 10, totalDays: 5 })
  })

  it('rejects fewer than 10 shifts', () => {
    expect(() => validateAvailabilitySelections(valid.slice(0, 9))).toThrow('tối thiểu 10 ca')
  })

  it('rejects fewer than 5 selected days', () => {
    const fourDays = [...valid.slice(0, 8), { dayOfWeek: 1, shiftCode: 'S3' }, { dayOfWeek: 2, shiftCode: 'S3' }]
    expect(() => validateAvailabilitySelections(fourDays)).toThrow('ít nhất 5 ngày')
  })

  it('rejects a selected day with only one shift', () => {
    const oneShiftDay = [...valid.slice(0, 8), { dayOfWeek: 5, shiftCode: 'S7' }, { dayOfWeek: 6, shiftCode: 'S1' }]
    expect(() => validateAvailabilitySelections(oneShiftDay)).toThrow('từ 2 đến 4 ca')
  })

  it('rejects more than four shifts on a day', () => {
    const fiveOnMonday = [...valid, { dayOfWeek: 1, shiftCode: 'S3' }, { dayOfWeek: 1, shiftCode: 'S4' }, { dayOfWeek: 1, shiftCode: 'S5' }]
    expect(() => validateAvailabilitySelections(fiveOnMonday)).toThrow('từ 2 đến 4 ca')
  })

  it('rejects shifts outside the fixed catalog', () => {
    expect(() => validateAvailabilitySelections([...valid.slice(0, 9), { dayOfWeek: 5, shiftCode: 'S8' }])).toThrow('không hợp lệ')
  })
})
