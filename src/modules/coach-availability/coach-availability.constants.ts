export const AVAILABILITY_TIME_ZONE = 'Asia/Ho_Chi_Minh'

export const AVAILABILITY_SHIFTS = [
  { code: 'S1', startTime: '07:00', endTime: '08:30' },
  { code: 'S2', startTime: '09:00', endTime: '10:30' },
  { code: 'S3', startTime: '11:00', endTime: '12:30' },
  { code: 'S4', startTime: '13:30', endTime: '15:00' },
  { code: 'S5', startTime: '15:30', endTime: '17:00' },
  { code: 'S6', startTime: '17:30', endTime: '19:00' },
  { code: 'S7', startTime: '19:30', endTime: '21:00' },
] as const

export type AvailabilityShiftCode = (typeof AVAILABILITY_SHIFTS)[number]['code']

export const shiftByCode = new Map<string, (typeof AVAILABILITY_SHIFTS)[number]>(AVAILABILITY_SHIFTS.map((shift) => [shift.code, shift]))

