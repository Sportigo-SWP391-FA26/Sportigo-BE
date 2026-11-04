import { HttpError } from '../../lib/http-error.js'
import { shiftByCode } from './coach-availability.constants.js'

export type AvailabilitySelectionInput = { dayOfWeek: number; shiftCode: string }

export function validateAvailabilitySelections(selections: AvailabilitySelectionInput[]) {
  const unique = new Map(selections.map((selection) => [`${selection.dayOfWeek}:${selection.shiftCode}`, selection]))
  if (unique.size !== selections.length) throw new HttpError(422, 'Thời khóa biểu có ca bị trùng', 'DUPLICATE_SHIFT')
  if (selections.length < 10) throw new HttpError(422, 'Cần chọn tối thiểu 10 ca mỗi tuần', 'MINIMUM_SHIFTS_REQUIRED')
  const perDay = new Map<number, number>()
  for (const selection of selections) {
    if (!shiftByCode.has(selection.shiftCode)) throw new HttpError(422, 'Ca làm việc không hợp lệ', 'INVALID_SHIFT')
    perDay.set(selection.dayOfWeek, (perDay.get(selection.dayOfWeek) ?? 0) + 1)
  }
  if (perDay.size < 5) throw new HttpError(422, 'Cần đăng ký trên ít nhất 5 ngày', 'MINIMUM_DAYS_REQUIRED')
  for (const [day, count] of perDay) {
    if (count < 2 || count > 4) throw new HttpError(422, `Ngày ${day} phải có từ 2 đến 4 ca`, 'INVALID_DAILY_SHIFT_COUNT')
  }
  return { totalShifts: selections.length, totalDays: perDay.size, perDay: Object.fromEntries(perDay) }
}

