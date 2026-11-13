import { describe, expect, it } from 'vitest'
import { centerClock, centerDateOnly, centerDateTime, centerDayOfWeek } from '../../src/lib/center-time.js'

describe('giờ chuẩn Việt Nam', () => {
  it('ghép ngày và giờ đồng hồ thành thời điểm UTC+7', () => {
    const monday = new Date('2026-11-16T00:00:00.000Z')
    expect(centerDateTime(monday, { hours: 18, minutes: 0 }).toISOString()).toBe('2026-11-16T11:00:00.000Z')
    expect(centerDateTime(monday, { hours: 6, minutes: 30 }).toISOString()).toBe('2026-11-15T23:30:00.000Z')
  })

  it('lấy ngày, thứ và giờ theo giờ Việt Nam kể cả khi UTC đã sang ngày khác', () => {
    const earlyMorning = new Date('2026-11-15T23:30:00.000Z') // 06:30 thứ Hai 16/11 tại trung tâm
    expect(centerDateOnly(earlyMorning).toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(centerDayOfWeek(earlyMorning)).toBe(1)
    expect(centerClock(earlyMorning)).toEqual({ hours: 6, minutes: 30 })
  })

  it('giữ nguyên giá trị đã là cột ngày', () => {
    const day = new Date('2026-11-16T00:00:00.000Z')
    expect(centerDateOnly(day)).toEqual(day)
  })

  it('lớp nhóm 18:00 và lịch 1-1 18:00 cùng ngày là cùng một thời điểm', () => {
    const day = new Date('2026-11-16T00:00:00.000Z')
    const groupSession = new Date('2026-11-16T18:00:00+07:00')
    expect(centerDateTime(day, { hours: 18, minutes: 0 })).toEqual(groupSession)
  })
})
