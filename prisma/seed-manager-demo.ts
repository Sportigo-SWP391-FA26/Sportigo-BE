import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const PREFIX = 'FLOWTEST'

const daysFromNow = (days: number) => {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return value
}

async function main() {
  console.log('[manager-seed] Completing Center Manager fixtures...')

  const [manager, receptionist, members, registrations, firstSession] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: { name: 'CENTER_MANAGER' } }, orderBy: { id: 'asc' } }),
    prisma.user.findFirstOrThrow({ where: { role: { name: 'RECEPTIONIST' } }, orderBy: { id: 'asc' } }),
    prisma.member.findMany({ where: { user: { email: { startsWith: 'flowtest.member' } } }, orderBy: { userId: 'asc' }, take: 4 }),
    prisma.classRegistration.findMany({ where: { member: { user: { email: { startsWith: 'flowtest.member' } } } }, include: { groupClass: true }, orderBy: { id: 'asc' }, take: 4 }),
    prisma.classSession.findFirst({ where: { groupClass: { name: { startsWith: PREFIX } } }, orderBy: { startsAt: 'asc' } }),
  ])

  if (!members.length || !registrations.length) throw new Error('Hãy chạy db:seed:flow trước để tạo hội viên và lớp học.')

  const [cashMethod] = await Promise.all([
    prisma.paymentMethod.upsert({ where: { code: 'CASH' }, update: { name: 'Tiền mặt tại quầy', isOnline: false, isActive: true }, create: { code: 'CASH', name: 'Tiền mặt tại quầy', isOnline: false, isActive: true } }),
    prisma.paymentMethod.upsert({ where: { code: 'VNPAY' }, update: { name: 'VNPay', isOnline: true, isActive: true }, create: { code: 'VNPAY', name: 'VNPay', isOnline: true, isActive: true } }),
    prisma.promotion.upsert({
      where: { code: 'SPORTIGO10' },
      update: { name: 'Ưu đãi hội viên mới', discountType: 'PERCENTAGE', discountValue: 10, maxDiscount: 300000, minOrderAmount: 800000, applicableType: 'ALL', startAt: daysFromNow(-30), endAt: daysFromNow(60), totalUsageLimit: 200, perMemberLimit: 1, status: 'ACTIVE' },
      create: { code: 'SPORTIGO10', name: 'Ưu đãi hội viên mới', discountType: 'PERCENTAGE', discountValue: 10, maxDiscount: 300000, minOrderAmount: 800000, applicableType: 'ALL', startAt: daysFromNow(-30), endAt: daysFromNow(60), totalUsageLimit: 200, perMemberLimit: 1, status: 'ACTIVE' },
    }),
    prisma.promotion.upsert({
      where: { code: 'PRIVATE500' },
      update: { name: 'Ưu đãi khóa huấn luyện 1–1', discountType: 'FIXED_AMOUNT', discountValue: 500000, minOrderAmount: 5000000, applicableType: 'PRIVATE_COURSE', startAt: daysFromNow(-7), endAt: daysFromNow(90), totalUsageLimit: 100, perMemberLimit: 1, status: 'ACTIVE' },
      create: { code: 'PRIVATE500', name: 'Ưu đãi khóa huấn luyện 1–1', discountType: 'FIXED_AMOUNT', discountValue: 500000, minOrderAmount: 5000000, applicableType: 'PRIVATE_COURSE', startAt: daysFromNow(-7), endAt: daysFromNow(90), totalUsageLimit: 100, perMemberLimit: 1, status: 'ACTIVE' },
    }),
  ])

  const registration = registrations[0]
  const amount = Number(registration.price)
  const order = await prisma.serviceOrder.upsert({
    where: { orderNumber: `${PREFIX}-MANAGER-ORDER-01` },
    update: { memberId: registration.memberId, originalAmount: amount, discountAmount: 0, finalAmount: amount, status: 'PAID', paidAt: daysFromNow(-2) },
    create: { memberId: registration.memberId, orderNumber: `${PREFIX}-MANAGER-ORDER-01`, originalAmount: amount, discountAmount: 0, finalAmount: amount, status: 'PAID', paidAt: daysFromNow(-2) },
  })
  await prisma.orderItem.upsert({
    where: { classRegistrationId: registration.id },
    update: { orderId: order.id, itemNameSnapshot: registration.groupClass.name, unitPrice: amount, discountAmount: 0, finalAmount: amount },
    create: { orderId: order.id, classRegistrationId: registration.id, itemType: 'GROUP_CLASS', itemNameSnapshot: registration.groupClass.name, unitPrice: amount, discountAmount: 0, finalAmount: amount },
  })
  const payment = await prisma.payment.upsert({
    where: { reference: `${PREFIX}-MANAGER-PAY-01` },
    update: { orderId: order.id, paymentMethodId: cashMethod.id, collectedById: receptionist.id, amount, channel: 'COUNTER', status: 'SUCCESS', paidAt: daysFromNow(-2) },
    create: { orderId: order.id, paymentMethodId: cashMethod.id, collectedById: receptionist.id, reference: `${PREFIX}-MANAGER-PAY-01`, amount, channel: 'COUNTER', status: 'SUCCESS', paidAt: daysFromNow(-2) },
  })
  await prisma.invoice.upsert({
    where: { orderId: order.id },
    update: { invoiceNumber: `${PREFIX}-MANAGER-INV-01`, subtotal: amount, discountAmount: 0, totalAmount: amount },
    create: { orderId: order.id, invoiceNumber: `${PREFIX}-MANAGER-INV-01`, subtotal: amount, discountAmount: 0, totalAmount: amount },
  })
  await prisma.wallet.upsert({ where: { memberId: registration.memberId }, update: {}, create: { memberId: registration.memberId, balance: 250000 } })

  const refundData = { paymentId: payment.id, memberId: registration.memberId, requestedAmount: Math.min(400000, amount), reason: 'Không thể tiếp tục tham gia do thay đổi lịch cá nhân.', status: 'REQUESTED' as const }
  const existingRefund = await prisma.refundRequest.findFirst({ where: { paymentId: payment.id, memberId: registration.memberId } })
  if (existingRefund) await prisma.refundRequest.update({ where: { id: existingRefund.id }, data: refundData })
  else await prisma.refundRequest.create({ data: refundData })

  if (firstSession) {
    const attendanceRegistration = registrations.find((item) => item.classId === firstSession.classId)
    if (attendanceRegistration) {
      await prisma.sessionAttendance.upsert({
        where: { registrationId_classSessionId: { registrationId: attendanceRegistration.id, classSessionId: firstSession.id } },
        update: { status: 'PRESENT', markedById: attendanceRegistration.groupClass.coachId, checkedAt: new Date(), note: 'Dữ liệu kiểm thử Center Manager' },
        create: { registrationId: attendanceRegistration.id, classSessionId: firstSession.id, status: 'PRESENT', markedById: attendanceRegistration.groupClass.coachId, checkedAt: new Date(), note: 'Dữ liệu kiểm thử Center Manager' },
      })
    }
  }

  const supportFixtures = [
    { requesterId: members[0].userId, subject: `${PREFIX} Hỗ trợ đổi lịch tập`, description: 'Tôi cần được tư vấn đổi lịch do trùng lịch công việc.', category: 'SCHEDULE', priority: 'HIGH' as const, status: 'OPEN' as const },
    { requesterId: members[Math.min(1, members.length - 1)].userId, subject: `${PREFIX} Kiểm tra hóa đơn`, description: 'Vui lòng hỗ trợ kiểm tra thông tin hóa đơn thanh toán gần nhất.', category: 'PAYMENT', priority: 'MEDIUM' as const, status: 'ASSIGNED' as const },
  ]
  for (const [index, fixture] of supportFixtures.entries()) {
    const existing = await prisma.supportRequest.findFirst({ where: { requesterId: fixture.requesterId, subject: fixture.subject } })
    const request = existing ? await prisma.supportRequest.update({ where: { id: existing.id }, data: fixture }) : await prisma.supportRequest.create({ data: fixture })
    const message = await prisma.supportMessage.findFirst({ where: { requestId: request.id } })
    if (!message) await prisma.supportMessage.create({ data: { requestId: request.id, senderId: fixture.requesterId, content: fixture.description } })
    if (index === 1) {
      const assignment = await prisma.requestAssignment.findFirst({ where: { requestId: request.id, status: 'ACTIVE' } })
      const data = { requestId: request.id, assignedToId: receptionist.id, assignedById: manager.id, status: 'ACTIVE' as const, note: 'Tiếp nhận và phản hồi hội viên.' }
      if (assignment) await prisma.requestAssignment.update({ where: { id: assignment.id }, data })
      else await prisma.requestAssignment.create({ data })
    }
  }

  const audits = [
    { action: 'CREATE_PROMOTION', entityType: 'Promotion', entityId: 'SPORTIGO10', newData: { code: 'SPORTIGO10', status: 'ACTIVE' } },
    { action: 'COLLECT_CASH_PAYMENT', entityType: 'Payment', entityId: payment.reference, newData: { channel: 'COUNTER', status: 'SUCCESS' } },
    { action: 'UPDATE_GROUP_CLASS', entityType: 'GroupClass', entityId: String(registration.classId), newData: { status: 'OPEN' } },
  ]
  for (const audit of audits) {
    const existing = await prisma.auditLog.findFirst({ where: { action: audit.action, entityType: audit.entityType, entityId: audit.entityId } })
    if (!existing) await prisma.auditLog.create({ data: { actorId: manager.id, ...audit } })
  }

  console.log('[manager-seed] Done: finance, refunds, support, audit and attendance are ready.')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('[manager-seed] Failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
