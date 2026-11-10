/**
 * Thêm dữ liệu lịch sử 6 tháng gần nhất. Chạy lại an toàn: lớp đã có sẽ được bỏ qua.
 *   Chạy thử (không ghi):  npx tsx prisma/seed-history.ts
 *   Ghi thật:              npx tsx prisma/seed-history.ts --apply
 * Chạy sau khi dọn dữ liệu kiểm thử để lịch sử gắn với hội viên và Coach thật.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const MONTHS_BACK = 6
const MAX_SPORTS = 4
const SESSIONS_PER_CLASS = 4
const MEMBERS_PER_CLASS = 6
const TUITION = 1_200_000
const CENTER_OFFSET_HOURS = 7

// Giá trị xác định theo vị trí để chạy lại cho cùng kết quả
const isPresent = (member: number, session: number) => (member * 3 + session * 5) % 7 !== 0
const scoreFor = (member: number, month: number) => 55 + ((member * 11 + month * 7) % 41)
const channelFor = (index: number) => (index % 3 === 0 ? 'COUNTER' as const : 'ONLINE' as const)

const centerTime = (year: number, month: number, day: number, hour: number) => new Date(Date.UTC(year, month, day, hour - CENTER_OFFSET_HOURS))
const dateOnly = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day))

async function main() {
  const notTest = { user: { email: { not: { startsWith: 'flowtest.' } } } }
  const [sports, members, rooms, cash, vnpay, receptionist] = await Promise.all([
    prisma.sport.findMany({ where: { isActive: true, coachSports: { some: { coach: { status: 'ACTIVE', ...notTest } } } }, orderBy: { id: 'asc' }, take: MAX_SPORTS, include: { coachSports: { where: { coach: { status: 'ACTIVE', ...notTest } }, orderBy: { coachId: 'asc' }, take: 1 } } }),
    prisma.member.findMany({ where: { ...notTest, user: { email: { not: { startsWith: 'flowtest.' } }, status: 'ACTIVE', deletedAt: null } }, orderBy: { userId: 'asc' }, take: MEMBERS_PER_CLASS }),
    prisma.room.findMany({ where: { status: 'AVAILABLE', code: { not: { startsWith: 'FLOW-' } } }, orderBy: { id: 'asc' } }),
    APPLY
      ? prisma.paymentMethod.upsert({ where: { code: 'CASH' }, update: {}, create: { code: 'CASH', name: 'Tiền mặt tại quầy', isOnline: false } })
      : Promise.resolve({ id: 0 }),
    prisma.paymentMethod.findUnique({ where: { code: 'VNPAY' } }),
    prisma.user.findFirst({ where: { role: { name: 'RECEPTIONIST' }, status: 'ACTIVE', deletedAt: null, email: { not: { startsWith: 'flowtest.' } } }, orderBy: { id: 'asc' } }),
  ])
  console.log(`Môn: ${sports.length}, hội viên: ${members.length}, phòng: ${rooms.length}, phương thức: ${[cash, vnpay].filter(Boolean).length}/2`)
  if (!sports.length || !members.length || !rooms.length || !cash || !vnpay) throw new Error('Thiếu môn có Coach, hội viên, phòng hoặc phương thức thanh toán CASH/VNPAY.')

  const now = new Date()
  let created = 0
  let skipped = 0
  for (let back = MONTHS_BACK; back >= 1; back -= 1) {
    const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const year = anchor.getUTCFullYear()
    const month = anchor.getUTCMonth()
    const label = `${String(month + 1).padStart(2, '0')}/${year}`
    for (const [sportIndex, sport] of sports.entries()) {
      const name = `${sport.name} cơ bản · Khóa ${label}`
      if (await prisma.groupClass.findFirst({ where: { name, sportId: sport.id }, select: { id: true } })) { skipped += 1; continue }
      created += 1
      if (!APPLY) continue

      const coachId = sport.coachSports[0]!.coachId
      const room = rooms[sportIndex % rooms.length]!
      const hour = 6 + sportIndex * 2
      await prisma.$transaction(async (tx) => {
        const groupClass = await tx.groupClass.create({ data: {
          sportId: sport.id, coachId, name, description: 'Lớp đã hoàn thành.', capacity: 12, totalSessions: SESSIONS_PER_CLASS, sessionsPerWeek: 1, tuitionFee: TUITION,
          registrationOpenAt: centerTime(year, month - 1, 10, 8), registrationCloseAt: centerTime(year, month, 1, 23),
          startDate: dateOnly(year, month, 3), endDate: dateOnly(year, month, 24), status: 'COMPLETED',
        } })
        const sessions = []
        for (let index = 0; index < SESSIONS_PER_CLASS; index += 1) {
          const day = 3 + index * 7
          sessions.push(await tx.classSession.create({ data: { classId: groupClass.id, roomId: room.id, startsAt: centerTime(year, month, day, hour), endsAt: new Date(centerTime(year, month, day, hour).getTime() + 90 * 60_000), status: 'COMPLETED' } }))
        }
        for (const [memberIndex, member] of members.entries()) {
          const paidAt = centerTime(year, month - 1, 15 + memberIndex, 10)
          const suffix = `${year}${String(month + 1).padStart(2, '0')}-${sport.id}-${member.userId}`
          const channel = channelFor(memberIndex)
          const registration = await tx.classRegistration.create({ data: { memberId: member.userId, classId: groupClass.id, status: 'CONFIRMED', registeredAt: paidAt, price: TUITION } })
          const order = await tx.serviceOrder.create({ data: { memberId: member.userId, orderNumber: `SO-H${suffix}`, originalAmount: TUITION, finalAmount: TUITION, status: 'PAID', paidAt, createdAt: paidAt } })
          await tx.orderItem.create({ data: { orderId: order.id, classRegistrationId: registration.id, itemType: 'GROUP_CLASS', itemNameSnapshot: name, unitPrice: TUITION, finalAmount: TUITION, createdAt: paidAt } })
          await tx.payment.create({ data: { orderId: order.id, paymentMethodId: channel === 'COUNTER' ? cash.id : vnpay.id, collectedById: channel === 'COUNTER' ? receptionist?.id : undefined, reference: `PAY-H${suffix}`, amount: TUITION, channel, status: 'SUCCESS', paidAt, createdAt: paidAt } })
          await tx.invoice.create({ data: { orderId: order.id, invoiceNumber: `INV-H${suffix}`, subtotal: TUITION, discountAmount: 0, totalAmount: TUITION, issuedAt: paidAt } })
          for (const [sessionIndex, session] of sessions.entries()) {
            await tx.sessionAttendance.create({ data: { registrationId: registration.id, classSessionId: session.id, status: isPresent(memberIndex + 1, sessionIndex + 1) ? 'PRESENT' : 'ABSENT', markedById: coachId, checkedAt: session.startsAt } })
          }
          const last = sessions.at(-1)!
          if (isPresent(memberIndex + 1, SESSIONS_PER_CLASS)) {
            await tx.progressAssessment.create({ data: { memberId: member.userId, coachId, classRegistrationId: registration.id, classSessionId: last.id, assessmentDate: dateOnly(year, month, 24), score: scoreFor(memberIndex + 1, month), coachComment: 'Hoàn thành khóa học, tiến bộ đều qua các buổi tập.', createdAt: last.endsAt } })
          }
        }
      }, { timeout: 120_000, maxWait: 20_000 })
      console.log(`Đã tạo: ${name}`)
    }
  }
  console.log(`\n${APPLY ? 'Đã tạo' : 'Sẽ tạo'} ${created} lớp, bỏ qua ${skipped} lớp đã có.${APPLY ? '' : ' Chưa ghi gì; thêm --apply để thực hiện.'}`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
