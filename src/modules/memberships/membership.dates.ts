const CENTER_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** Ngày hiện tại theo giờ trung tâm, biểu diễn ở 00:00 UTC như các cột @db.Date. */
export function centerToday(now = new Date()) {
  const text = new Intl.DateTimeFormat('en-CA', { timeZone: CENTER_TIME_ZONE }).format(now)
  return new Date(`${text}T00:00:00.000Z`)
}

export function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}

/**
 * Ngày cuối cùng (tính cả ngày đó) của gói kéo dài `months` tháng.
 * 15/01 + 1 tháng hết 14/02; tháng đích không đủ ngày thì hết vào ngày cuối tháng đó.
 */
export function subscriptionEndDate(startDate: Date, months: number) {
  const day = startDate.getUTCDate()
  const lastDayOfTarget = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + months + 1, 0))
  if (day > lastDayOfTarget.getUTCDate()) return lastDayOfTarget
  return new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + months, day - 1))
}

/** Gói mới nối tiếp ngay sau gói đang có, không làm mất ngày nào. */
export function nextSubscriptionStart(today: Date, latestEndDate: Date | null | undefined) {
  if (!latestEndDate) return today
  const dayAfter = addDays(latestEndDate, 1)
  return dayAfter > today ? dayAfter : today
}

export function toDateText(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null
}
