import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  SCORE_MAX,
  toScoreLevel,
} from '../src/modules/training/assessment-level.js'

// Điểm tổng dùng thang 10 (FR-52). Đổi các điểm lỡ chấm theo thang 100 (> 10) về thang 10 để mức đánh giá tính đúng.
// Mặc định chỉ xem trước; thêm --apply mới ghi. Chạy lại an toàn: sau lần đầu không còn điểm > 10.
//   npx tsx prisma/rescale-assessment-scores.ts           (xem trước)
//   npx tsx prisma/rescale-assessment-scores.ts --apply   (ghi)
const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  console.log(`Database: ${url.hostname}${url.pathname}`)

  const rows = await prisma.progressAssessment.findMany({
    where: { score: { gt: SCORE_MAX } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      score: true,
      assessmentDate: true,
      member: { select: { memberCode: true } },
    },
  })

  if (rows.length === 0) {
    console.log('Không có đánh giá nào vượt thang 10. Không cần sửa.')
    return
  }

  const rescaled = (score: { toString(): string }) =>
    Math.round(Number(score.toString()) * 10) / 100

  console.table(
    rows.map((row) => ({
      id: row.id,
      member: row.member.memberCode,
      date: row.assessmentDate.toISOString().slice(0, 10),
      old: row.score!.toString(),
      new: rescaled(row.score!),
      level: toScoreLevel(rescaled(row.score!)),
    })),
  )

  if (!apply) {
    console.log(
      `Xem trước ${rows.length} đánh giá. Chạy lại với --apply để ghi.`,
    )
    return
  }

  await prisma.$transaction(
    rows.map((row) =>
      prisma.progressAssessment.update({
        where: { id: row.id },
        data: { score: rescaled(row.score!) },
      }),
    ),
  )
  console.log(`Đã đổi ${rows.length} đánh giá về thang 10.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
