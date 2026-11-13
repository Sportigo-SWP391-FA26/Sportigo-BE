import { HttpError } from '../../lib/http-error.js'

// FR-66/67: các mốc thời gian của phần nhân sự. Đây là giá trị ví dụ theo hieusuat_luong.md, trung tâm chốt lại sau.
export const WORKFORCE_RULES = {
  // note: Manager được ghi nhận dạy thay / vắng tới tối đa 24 giờ sau khi buổi kết thúc (nếu chưa ai điểm danh)
  coachChangeGraceHours: 24,
  // note: lễ tân được bấm "vào ca" sớm nhất 30 phút trước giờ bắt đầu ca
  clockInEarlyMinutes: 30,
  // note: được bấm "ra ca" muộn nhất 4 giờ sau giờ kết thúc ca, quá thì phải gửi yêu cầu sửa công
  clockOutLateHours: 4,
  // note: đi trễ/về sớm dưới 5 phút thì không tính
  graceMinutes: 5,
  // note: gửi yêu cầu sửa công trong vòng 7 ngày sau khi ca kết thúc
  adjustmentWindowDays: 7,
  // note: giờ sửa phải nằm trong [bắt đầu ca − 2 giờ, kết thúc ca + 6 giờ]
  adjustmentSlackHours: { before: 2, after: 6 },
  // note: một ca dài từ 1 đến 12 giờ
  shiftMinMinutes: 60,
  shiftMaxMinutes: 12 * 60,
  // note: xem danh sách tối đa 31 ngày một lần
  maxRangeDays: 31,
} as const

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
export const ms = { hour: HOUR, minute: MINUTE, day: 24 * HOUR }

// note: ngày trong query là ngày theo giờ Việt Nam (UTC+7), đổi sang khoảng thời gian UTC [from, toExclusive)
export function centerDayRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+07:00`)
  const endExclusive = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + ms.day)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(endExclusive.getTime()) || start >= endExclusive) {
    throw new HttpError(400, 'Khoảng ngày không hợp lệ.', 'INVALID_DATE_RANGE')
  }
  if (endExclusive.getTime() - start.getTime() > WORKFORCE_RULES.maxRangeDays * ms.day) {
    throw new HttpError(400, `Chỉ xem tối đa ${WORKFORCE_RULES.maxRangeDays} ngày một lần.`, 'DATE_RANGE_TOO_LARGE')
  }
  return { start, endExclusive }
}

// note: định dạng giờ Việt Nam cho nội dung thông báo
export function formatCenterTime(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date)
}
