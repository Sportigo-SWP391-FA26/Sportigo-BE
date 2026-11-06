import { z } from 'zod'

// note: trung tâm ở Việt Nam (UTC+7, không đổi giờ mùa hè) → mọi mốc ngày tính theo giờ trung tâm
const CENTER_OFFSET_MS = 7 * 60 * 60 * 1000
// note: giới hạn khoảng xem tối đa 1 năm để truy vấn không quá nặng
const MAX_RANGE_DAYS = 366

// note: ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD
export const todayInCenter = () => new Date(Date.now() + CENTER_OFFSET_MS).toISOString().slice(0, 10)

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD')
  // note: chặn ngày không tồn tại như 2026-02-30 (Date tự lăn sang tháng sau nên chuỗi sẽ khác)
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), 'Ngày không hợp lệ')

// FR-65: khoảng thời gian xem hiệu suất; bỏ trống thì mặc định từ đầu tháng tới hôm nay
export const staffPerformanceQuerySchema = z
  .object({ from: dateOnly.optional(), to: dateOnly.optional() })
  .strict()
  .transform(({ from, to }) => {
    const today = todayInCenter()
    return { from: from ?? `${today.slice(0, 8)}01`, to: to ?? today }
  })
  // note: so sánh chuỗi YYYY-MM-DD theo thứ tự từ điển tương đương so sánh ngày
  .refine(({ from, to }) => from <= to, { message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc', path: ['from'] })
  .refine(
    ({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86_400_000 < MAX_RANGE_DAYS,
    { message: `Chỉ xem được tối đa ${MAX_RANGE_DAYS} ngày`, path: ['to'] },
  )

export type StaffPerformanceQuery = z.infer<typeof staffPerformanceQuerySchema>

// note: đổi YYYY-MM-DD sang mốc thời gian thật: [00:00 ngày from, 00:00 ngày sau ngày to) theo giờ Việt Nam
export function toInstantRange({ from, to }: StaffPerformanceQuery) {
  const start = new Date(Date.parse(`${from}T00:00:00.000Z`) - CENTER_OFFSET_MS)
  const endExclusive = new Date(Date.parse(`${to}T00:00:00.000Z`) - CENTER_OFFSET_MS + 86_400_000)
  return { start, endExclusive }
}

// note: cột @db.Date (ngày đánh giá) lưu nửa đêm UTC nên so sánh bằng mốc UTC của chính chuỗi ngày
export function toDateColumnRange({ from, to }: StaffPerformanceQuery) {
  return { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) }
}
