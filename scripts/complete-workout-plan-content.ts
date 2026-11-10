import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Session = { title: string; content: string; durationMinutes: number; intensity: string }

const swimming: Session[][] = [
  [
    { title: 'Làm quen nhịp thở và nổi người', content: 'Khởi động trên cạn; tập thở ra dưới nước, nổi sấp có hỗ trợ và trượt nước ngắn. Coach quan sát tư thế đầu và nhịp thở.', durationMinutes: 60, intensity: 'Nhẹ' },
    { title: 'Đạp chân ếch cơ bản', content: 'Ôn nhịp thở và nổi; tập gập, mở, khép chân ếch tại thành bể rồi thực hành với ván bơi. Coach sửa chuyển động hai chân cân đối.', durationMinutes: 60, intensity: 'Nhẹ' },
  ],
  [
    { title: 'Quạt tay ếch và lướt nước', content: 'Ôn đạp chân; tập quạt tay, thu tay và duỗi người theo từng nhịp. Ghép quạt tay với pha lướt nước ở quãng ngắn.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Phối hợp tay, chân và thở', content: 'Ghép nhịp quạt tay, hít thở, đạp chân và lướt; bơi quãng ngắn có nghỉ giữa lượt. Coach nhận xét thứ tự động tác.', durationMinutes: 60, intensity: 'Vừa' },
  ],
  [
    { title: 'Ổn định kỹ thuật bơi ếch', content: 'Lặp lại chu kỳ bơi ếch trên nhiều lượt ngắn; tập giữ thân người thẳng và giảm động tác thừa. Nghỉ theo khả năng của học viên.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Tăng quãng bơi có kiểm soát', content: 'Bơi liên tục theo quãng phù hợp; Coach quan sát nhịp thở, độ đều của tay chân và điều chỉnh kỹ thuật giữa các lượt.', durationMinutes: 60, intensity: 'Vừa' },
  ],
  [
    { title: 'Ứng dụng kỹ thuật và quay đầu', content: 'Ôn chu kỳ bơi ếch; tập chạm thành, quay đầu và tiếp tục bơi trong điều kiện an toàn dưới sự quan sát của Coach.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Tổng kết kỹ thuật bơi ếch', content: 'Bơi quãng phù hợp để Coach đánh giá nhịp thở, đạp chân, quạt tay và sức bền; ghi nhận nội dung cần tiếp tục cải thiện.', durationMinutes: 60, intensity: 'Vừa' },
  ],
]

const boxing: Session[][] = [
  [
    { title: 'Tư thế thủ và di chuyển cơ bản', content: 'Khởi động khớp; học tư thế đứng, vị trí tay bảo vệ và bước tiến lùi. Thực hành chậm với Coach.', durationMinutes: 60, intensity: 'Nhẹ' },
    { title: 'Đòn thẳng và trở về tư thế thủ', content: 'Ôn di chuyển; tập jab và cross trên đích đấm, nhấn mạnh xoay người và thu tay về vị trí bảo vệ.', durationMinutes: 60, intensity: 'Nhẹ' },
  ],
  [
    { title: 'Phối hợp jab, cross', content: 'Luyện tổ hợp hai đòn thẳng với bước chân; thực hành theo hiệp ngắn, nghỉ đủ giữa các hiệp.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Phòng thủ và né đòn cơ bản', content: 'Tập che chắn, bước tránh và giữ khoảng cách; ghép phòng thủ với tổ hợp jab, cross ở tốc độ kiểm soát.', durationMinutes: 60, intensity: 'Vừa' },
  ],
  [
    { title: 'Đòn móc ngang đúng kỹ thuật', content: 'Tập chuyển trọng tâm và xoay hông khi thực hiện đòn móc trên đích; tránh duỗi khuỷu quá mức.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Tổ hợp ba đòn và di chuyển', content: 'Ghép jab, cross, móc ngang với bước chân; Coach sửa nhịp và tư thế thủ sau mỗi tổ hợp.', durationMinutes: 60, intensity: 'Vừa' },
  ],
  [
    { title: 'Đòn móc lên và kiểm soát cự ly', content: 'Học chuyển trọng tâm cho đòn móc lên, thực hành với đích đấm; duy trì khoảng cách phù hợp.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Phối hợp tấn công và phòng thủ', content: 'Thực hành tổ hợp đòn rồi che chắn hoặc bước tránh; tập theo hiệp ngắn có Coach giám sát.', durationMinutes: 60, intensity: 'Vừa' },
  ],
  [
    { title: 'Rèn nhịp và sức bền kỹ thuật', content: 'Thực hiện các hiệp đấm đích có thời gian, tập giữ kỹ thuật khi mệt và điều chỉnh nhịp thở.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Ứng dụng tổ hợp theo tình huống', content: 'Coach đưa tình huống di chuyển, ra đòn và phòng thủ; học viên thực hành ở cường độ kiểm soát.', durationMinutes: 60, intensity: 'Vừa' },
  ],
  [
    { title: 'Ôn toàn bộ kỹ thuật', content: 'Ôn tư thế, di chuyển, đòn thẳng, móc và phòng thủ; Coach sửa các lỗi cá nhân trước buổi tổng kết.', durationMinutes: 60, intensity: 'Vừa' },
    { title: 'Tổng kết và đánh giá tiến độ', content: 'Thực hành tổ hợp kỹ thuật với đích đấm; Coach đánh giá độ chính xác, nhịp di chuyển và khả năng duy trì tư thế.', durationMinutes: 60, intensity: 'Vừa' },
  ],
]

async function addItems(planId: number, weeks: Session[][]) {
  const existing = await prisma.workoutPlanItem.findMany({ where: { workoutPlanId: planId }, select: { weekNumber: true, sessionNumber: true, itemOrder: true } })
  const keys = new Set(existing.map((item) => `${item.weekNumber}:${item.sessionNumber}:${item.itemOrder}`))
  const items = weeks.flatMap((sessions, weekIndex) => sessions.map((session, sessionIndex) => ({
    workoutPlanId: planId,
    weekNumber: weekIndex + 1,
    sessionNumber: sessionIndex + 1,
    itemOrder: 1,
    ...session,
  }))).filter((item) => !keys.has(`${item.weekNumber}:${item.sessionNumber}:${item.itemOrder}`))
  if (items.length) await prisma.workoutPlanItem.createMany({ data: items, skipDuplicates: true })
  return items.length
}

try {
  const swimmingPlan = await prisma.workoutPlan.findUnique({ where: { id: 5 } })
  if (!swimmingPlan || swimmingPlan.name !== 'Bơi ếch nền tảng 4 tuần' || swimmingPlan.sportId !== 1) throw new Error('Giáo án Bơi ếch không khớp dữ liệu đã kiểm tra; dừng để tránh ghi sai.')
  const boxingSport = await prisma.sport.findUnique({ where: { name: 'Boxing' } })
  const boxingCoach = await prisma.coach.findUnique({ where: { userId: 14 }, include: { coachSports: true } })
  if (!boxingSport || !boxingCoach?.coachSports.some((item) => item.sportId === boxingSport.id)) throw new Error('Không tìm thấy Coach có chuyên môn Boxing; dừng để tránh ghi sai.')

  const swimmingAdded = await addItems(swimmingPlan.id, swimming)
  let boxingPlan = await prisma.workoutPlan.findFirst({ where: { sportId: boxingSport.id, name: 'Giáo án Boxing nền tảng 6 tuần' } })
  if (!boxingPlan) boxingPlan = await prisma.workoutPlan.create({ data: {
    sportId: boxingSport.id,
    createdById: boxingCoach.userId,
    name: 'Giáo án Boxing nền tảng 6 tuần',
    description: 'Lộ trình kỹ thuật cơ bản theo tuần, có Coach giám sát tại trung tâm.',
    level: 'BEGINNER', durationWeeks: 6, status: 'DRAFT',
  } })
  const boxingAdded = await addItems(boxingPlan.id, boxing)
  await prisma.workoutPlan.updateMany({ where: { id: { in: [swimmingPlan.id, boxingPlan.id] }, status: 'DRAFT', items: { some: {} } }, data: { status: 'ACTIVE' } })
  console.log(JSON.stringify({ swimmingPlanId: swimmingPlan.id, swimmingAdded, boxingPlanId: boxingPlan.id, boxingAdded, status: 'ACTIVE' }, null, 2))
} finally {
  await prisma.$disconnect()
}
