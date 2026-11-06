import { describe, expect, it } from 'vitest'
import { validateAvailabilitySelections } from '../src/modules/coach-availability/coach-availability.rules.js'

const valid = [
  { dayOfWeek: 1, shiftCode: 'S1' }, { dayOfWeek: 1, shiftCode: 'S2' }, { dayOfWeek: 1, shiftCode: 'S3' }, { dayOfWeek: 1, shiftCode: 'S4' },
  { dayOfWeek: 2, shiftCode: 'S1' }, { dayOfWeek: 2, shiftCode: 'S2' }, { dayOfWeek: 2, shiftCode: 'S3' }, { dayOfWeek: 2, shiftCode: 'S4' },
  { dayOfWeek: 3, shiftCode: 'S1' }, { dayOfWeek: 3, shiftCode: 'S2' }, { dayOfWeek: 3, shiftCode: 'S3' }, { dayOfWeek: 3, shiftCode: 'S4' },
  { dayOfWeek: 4, shiftCode: 'S1' }, { dayOfWeek: 4, shiftCode: 'S2' }, { dayOfWeek: 4, shiftCode: 'S3' }, { dayOfWeek: 4, shiftCode: 'S4' },
  { dayOfWeek: 5, shiftCode: 'S1' }, { dayOfWeek: 5, shiftCode: 'S2' }, { dayOfWeek: 5, shiftCode: 'S3' }, { dayOfWeek: 5, shiftCode: 'S4' },
]

describe('Coach availability validation', () => {
  it('accepts 20 fixed shifts across at least 5 days with 2-4 shifts per day', () => {
    expect(validateAvailabilitySelections(valid)).toMatchObject({ totalShifts: 20, totalDays: 5 })
  })

  it('rejects fewer than 20 shifts', () => {
    expect(() => validateAvailabilitySelections(valid.slice(0, 19))).toThrow('tối thiểu 20 ca')
  })

  it('rejects fewer than 5 selected days', () => {
    const fourDays = Array.from({ length: 4 }, (_, dayIndex) =>
      Array.from({ length: 5 }, (_, shiftIndex) => ({ dayOfWeek: dayIndex + 1, shiftCode: `S${shiftIndex + 1}` })),
    ).flat()
    expect(() => validateAvailabilitySelections(fourDays)).toThrow('ít nhất 5 ngày')
  })

  it('rejects a selected day with only one shift', () => {
    const oneShiftDay = [...valid.slice(0, 16), { dayOfWeek: 5, shiftCode: 'S1' }, { dayOfWeek: 6, shiftCode: 'S1' }, { dayOfWeek: 6, shiftCode: 'S2' }, { dayOfWeek: 6, shiftCode: 'S3' }]
    expect(() => validateAvailabilitySelections(oneShiftDay)).toThrow('từ 2 đến 4 ca')
  })

  it('rejects more than four shifts on a day', () => {
    const fiveOnMonday = [...valid, { dayOfWeek: 1, shiftCode: 'S5' }]
    expect(() => validateAvailabilitySelections(fiveOnMonday)).toThrow('từ 2 đến 4 ca')
  })

  it('rejects shifts outside the fixed catalog', () => {
    expect(() => validateAvailabilitySelections([...valid.slice(0, 19), { dayOfWeek: 5, shiftCode: 'S8' }])).toThrow('không hợp lệ')
  })
})
