/** Tạo ba gói mở bán đã được duyệt, chỉ khi chưa có gói cùng thời hạn. */
import { prisma } from '../src/lib/prisma.js'
import { createPlan } from '../src/modules/memberships/membership.service.js'

const plans = [
  { name: 'Sportigo 1 tháng', durationMonths: 1, price: 500_000, description: 'Linh hoạt bắt đầu hành trình tập luyện. Sử dụng phòng tập không giới hạn lượt trong 1 tháng.', imageUrl: 'https://res.cloudinary.com/gnfiha8v/image/upload/v1794929259/sportigo/memberships/one-month.webp' },
  { name: 'Sportigo 3 tháng', durationMonths: 3, price: 1_350_000, description: 'Duy trì thói quen tập luyện đều đặn trong 3 tháng, tiết kiệm so với gia hạn từng tháng.', imageUrl: 'https://res.cloudinary.com/gnfiha8v/image/upload/v1794929260/sportigo/memberships/three-month.webp' },
  { name: 'Sportigo 6 tháng', durationMonths: 6, price: 2_400_000, description: 'Cam kết với mục tiêu dài hạn và sử dụng phòng tập không giới hạn lượt trong 6 tháng.', imageUrl: 'https://res.cloudinary.com/gnfiha8v/image/upload/v1794929261/sportigo/memberships/six-month.webp' },
] as const

async function main() {
  const manager = await prisma.user.findFirst({ where: { role: { name: 'CENTER_MANAGER' }, deletedAt: null }, select: { id: true } })
  if (!manager) throw new Error('Không có Center Manager để ghi audit')
  for (const plan of plans) {
    const existing = await prisma.membershipPlan.findFirst({ where: { durationMonths: plan.durationMonths }, select: { id: true } })
    if (existing) { console.log(`Giữ gói ${plan.durationMonths} tháng hiện có, id=${existing.id}`); continue }
    const created = await createPlan({ ...plan, status: 'ACTIVE' }, manager.id)
    console.log(`Đã tạo gói ${plan.durationMonths} tháng, id=${created.id}`)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
