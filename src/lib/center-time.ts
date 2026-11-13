// Giờ chuẩn của trung tâm là giờ Việt Nam (UTC+7, không có giờ mùa hè).
// Ngày (cột @db.Date) được biểu diễn ở 00:00 UTC; giờ trong ngày (cột @db.Time,
// chuỗi "HH:mm") luôn là giờ đồng hồ tại trung tâm. Mọi chỗ ghép ngày + giờ
// hoặc lấy thứ/giờ từ một thời điểm phải đi qua các hàm dưới đây.
export const CENTER_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

const shifted = (value: Date) => new Date(value.getTime() + CENTER_UTC_OFFSET_MS)

/** Ngày theo giờ Việt Nam của một thời điểm, ở 00:00 UTC. Giữ nguyên nếu đã là cột ngày. */
export function centerDateOnly(value: Date) {
  const local = shifted(value)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
}

/** Thời điểm tương ứng với giờ đồng hồ `hours:minutes` tại trung tâm vào ngày `date`. */
export function centerDateTime(date: Date, time: { hours: number; minutes: number }) {
  const day = centerDateOnly(date)
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), time.hours, time.minutes) - CENTER_UTC_OFFSET_MS)
}

/** Thứ trong tuần (0 = Chủ nhật) theo giờ Việt Nam. */
export function centerDayOfWeek(value: Date) {
  return shifted(value).getUTCDay()
}

/** Giờ và phút theo giờ Việt Nam của một thời điểm. */
export function centerClock(value: Date) {
  const local = shifted(value)
  return { hours: local.getUTCHours(), minutes: local.getUTCMinutes() }
}

/** Giờ đồng hồ đọc từ cột @db.Time (đã là giờ trung tâm). */
export function wallClock(value: Date) {
  return { hours: value.getUTCHours(), minutes: value.getUTCMinutes() }
}

export function clockText(time: { hours: number; minutes: number }) {
  return `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`
}
