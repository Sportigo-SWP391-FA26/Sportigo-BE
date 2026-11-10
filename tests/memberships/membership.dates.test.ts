import { describe, expect, it } from 'vitest'
import { centerToday, nextSubscriptionStart, subscriptionEndDate, toDateText } from '../../src/modules/memberships/membership.dates.js'
import { generateMemberCode } from '../../src/lib/member-code.js'

const day = (text: string) => new Date(`${text}T00:00:00.000Z`)
const end = (start: string, months: number) => toDateText(subscriptionEndDate(day(start), months))

describe('subscriptionEndDate', () => {
  it('kết thúc trước ngày cùng số của tháng đích', () => {
    expect(end('2026-01-15', 1)).toBe('2026-02-14')
    expect(end('2026-01-01', 1)).toBe('2026-01-31')
    expect(end('2026-01-15', 3)).toBe('2026-04-14')
    expect(end('2026-01-15', 6)).toBe('2026-07-14')
  })

  it('kẹp vào cuối tháng khi tháng đích không đủ ngày', () => {
    expect(end('2026-01-31', 1)).toBe('2026-02-28')
    expect(end('2028-01-31', 1)).toBe('2028-02-29')
    expect(end('2026-08-31', 6)).toBe('2027-02-28')
  })

  it('vắt qua năm', () => {
    expect(end('2026-11-20', 3)).toBe('2027-02-19')
  })
})

describe('nextSubscriptionStart', () => {
  const today = day('2026-11-10')

  it('bắt đầu hôm nay khi chưa có gói hoặc gói cũ đã hết', () => {
    expect(nextSubscriptionStart(today, null)).toEqual(today)
    expect(nextSubscriptionStart(today, day('2026-10-01'))).toEqual(today)
  })

  it('nối ngay sau ngày cuối của gói còn hạn', () => {
    expect(toDateText(nextSubscriptionStart(today, day('2026-12-05')))).toBe('2026-12-06')
    expect(toDateText(nextSubscriptionStart(today, today))).toBe('2026-11-11')
  })
})

describe('centerToday', () => {
  it('dùng ngày theo giờ Việt Nam', () => {
    expect(toDateText(centerToday(new Date('2026-11-10T17:30:00.000Z')))).toBe('2026-11-11')
    expect(toDateText(centerToday(new Date('2026-11-10T16:30:00.000Z')))).toBe('2026-11-10')
  })
})

describe('generateMemberCode', () => {
  it('ngắn và không có ký tự dễ nhầm', () => {
    for (let index = 0; index < 500; index += 1) expect(generateMemberCode()).toMatch(/^SG[2-9A-HJKMNP-Z]{6}$/)
  })
})
