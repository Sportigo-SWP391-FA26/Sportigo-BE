// FR-52, FR-53: Điểm tổng chấm theo thang 10. Mức đánh giá tính một chỗ duy nhất cho mọi màn hình.
export const SCORE_MAX = 10

export const SCORE_LEVELS = [
  { level: 'EXCELLENT', label: 'Xuất sắc', min: 8.5, max: 10 },
  { level: 'GOOD', label: 'Khá', min: 7, max: 8.4 },
  { level: 'AVERAGE', label: 'Trung bình', min: 5, max: 6.9 },
  { level: 'NEEDS_IMPROVEMENT', label: 'Cần cải thiện', min: 0, max: 4.9 },
] as const

export type ScoreLevel = (typeof SCORE_LEVELS)[number]['level']

/** Mức của một điểm; null khi Coach không chấm Điểm tổng (trường tùy chọn) */
export function toScoreLevel(score: { toString(): string } | number | null): ScoreLevel | null {
  if (score === null) return null
  const value = Number(score.toString())
  // Điểm nhiều chữ số thập phân (vd 8.45) thuộc mức có min <= điểm, không rơi vào khoảng trống giữa 8.4 và 8.5
  return SCORE_LEVELS.find((entry) => value >= entry.min)?.level ?? null
}
