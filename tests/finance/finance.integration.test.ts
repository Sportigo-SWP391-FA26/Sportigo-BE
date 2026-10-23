import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { createServiceOrder } from '../../src/modules/finance/finance.service.js'
import { signVnpay } from '../../src/modules/finance/vnpay.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  createCoach,
  createGroupClass,
  createManager,
  createMember,
  createPrivateCourse,
  createReceptionist,
  createRegistration,
  createSport,
  createEnrollment,
  resetDatabase,
} from '../training/fixtures.js'

async function createGroupOrder(options: { memberId?: number; price?: number } = {}) {
  const member = options.memberId ? null : await createMember()
  const memberId = options.memberId ?? member!.id
  const sport = await createSport()
  const coach = await createCoach()
  const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id })
  const price = options.price ?? 1_000_000
  const registration = await createRegistration({ memberId, classId: groupClass.id, status: 'PENDING_PAYMENT' })
  await prisma.classRegistration.update({ where: { id: registration.id }, data: { price } })
  const order = await createServiceOrder({
    memberId,
    itemType: 'GROUP_CLASS',
    itemName: groupClass.name,
    unitPrice: price,
    classRegistrationId: registration.id,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  })
  return { member, memberId, sport, coach, groupClass, registration, order }
}

describe.skipIf(!hasTestDatabase)('FR-37–46, FR-57–60 Finance integration', () => {
  beforeEach(resetDatabase)
  afterAll(() => prisma.$disconnect())

  it('tạo Order, thu tiền mặt đúng role, kích hoạt dịch vụ và chỉ phát hành một Invoice', async () => {
    const scenario = await createGroupOrder()
    const receptionist = await createReceptionist()
    const outsider = await createMember()

    const ownOrder = await request(app)
      .get(`/api/orders/${scenario.order.id}`)
      .set('Authorization', scenario.member!.auth)
    const forbidden = await request(app)
      .get(`/api/orders/${scenario.order.id}`)
      .set('Authorization', outsider.auth)
    const wrongRole = await request(app)
      .post(`/api/orders/${scenario.order.id}/payments/cash`)
      .set('Authorization', scenario.member!.auth)
      .send({ amount: 1_000_000 })
    const wrongAmount = await request(app)
      .post(`/api/orders/${scenario.order.id}/payments/cash`)
      .set('Authorization', receptionist.auth)
      .send({ amount: 999_999 })
    const paid = await request(app)
      .post(`/api/orders/${scenario.order.id}/payments/cash`)
      .set('Authorization', receptionist.auth)
      .send({ amount: 1_000_000 })
    const duplicate = await request(app)
      .post(`/api/orders/${scenario.order.id}/payments/cash`)
      .set('Authorization', receptionist.auth)
      .send({ amount: 1_000_000 })

    expect(ownOrder.status).toBe(200)
    expect(forbidden.status).toBe(403)
    expect(wrongRole.status).toBe(403)
    expect(wrongAmount.status).toBe(400)
    expect(paid.status).toBe(201)
    expect(duplicate.status).toBe(409)
    expect(await prisma.serviceOrder.findUniqueOrThrow({ where: { id: scenario.order.id } })).toMatchObject({ status: 'PAID' })
    expect(await prisma.classRegistration.findUniqueOrThrow({ where: { id: scenario.registration.id } })).toMatchObject({ status: 'CONFIRMED' })
    expect(await prisma.invoice.count({ where: { orderId: scenario.order.id } })).toBe(1)
  })

  it('giữ giới hạn Promotion theo Member và không thay đổi Order đã trả một phần', async () => {
    const first = await createGroupOrder()
    const second = await createGroupOrder({ memberId: first.memberId })
    const manager = await createManager()

    const created = await request(app)
      .post('/api/promotions')
      .set('Authorization', manager.auth)
      .send({
        code: 'SPORTIGO20', name: 'Sportigo 20%', discountType: 'PERCENTAGE', discountValue: 20,
        maxDiscount: 150_000, minOrderAmount: 500_000, applicableType: 'GROUP_CLASS',
        startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString(),
        totalUsageLimit: 10, perMemberLimit: 1, status: 'ACTIVE',
      })
    const applied = await request(app)
      .post(`/api/orders/${first.order.id}/promotion`)
      .set('Authorization', first.member!.auth)
      .send({ code: 'sportigo20' })
    const overLimit = await request(app)
      .post(`/api/orders/${second.order.id}/promotion`)
      .set('Authorization', first.member!.auth)
      .send({ code: 'SPORTIGO20' })

    expect(created.status).toBe(201)
    expect(applied.status).toBe(200)
    expect(Number(applied.body.discountAmount)).toBe(150_000)
    expect(Number(applied.body.finalAmount)).toBe(850_000)
    expect(overLimit.status).toBe(409)
    expect(overLimit.body.code).toBe('PROMOTION_USAGE_LIMIT')
  })

  it('xử lý VNPay IPN có chữ ký đúng và idempotent khi callback lặp', async () => {
    const scenario = await createGroupOrder({ price: 750_000 })
    const started = await request(app)
      .post(`/api/orders/${scenario.order.id}/payments/vnpay`)
      .set('Authorization', scenario.member!.auth)
      .send()

    expect(started.status).toBe(201)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.body.paymentId } })
    const params = {
      vnp_TxnRef: payment.reference,
      vnp_Amount: '75000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: 'TEST-123456',
    }
    const signed = { ...params, vnp_SecureHash: signVnpay(params) }
    const firstIpn = await request(app).get('/api/payments/vnpay/ipn').query(signed)
    const duplicateIpn = await request(app).get('/api/payments/vnpay/ipn').query(signed)

    expect(firstIpn.body).toEqual({ RspCode: '00', Message: 'Confirm Success' })
    expect(duplicateIpn.body).toEqual({ RspCode: '02', Message: 'Order already confirmed' })
    expect(await prisma.payment.count({ where: { orderId: scenario.order.id, status: 'SUCCESS' } })).toBe(1)
    expect(await prisma.invoice.count({ where: { orderId: scenario.order.id } })).toBe(1)
  })

  it('activates a private enrollment only after full payment and processes repeated VNPay callbacks once', async () => {
    const member = await createMember()
    const coach = await createCoach()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const enrollment = await createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: course.id,
      status: 'PENDING_PAYMENT',
    })
    const order = await createServiceOrder({
      memberId: member.id,
      itemType: 'PRIVATE_COURSE',
      itemName: course.name,
      unitPrice: 6_000_000,
      privateEnrollmentId: enrollment.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    const started = await request(app)
      .post(`/api/orders/${order.id}/payments/vnpay`)
      .set('Authorization', member.auth)
      .send()
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.body.paymentId } })
    const callbackParams = {
      vnp_TxnRef: payment.reference,
      vnp_Amount: '600000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: 'PRIVATE-TEST-123',
    }
    const signedCallback = { ...callbackParams, vnp_SecureHash: signVnpay(callbackParams) }
    const first = await request(app).get('/api/payments/vnpay/ipn').query(signedCallback)
    const repeated = await request(app).get('/api/payments/vnpay/ipn').query(signedCallback)

    expect(started.status).toBe(201)
    expect(first.body.RspCode).toBe('00')
    expect(repeated.body.RspCode).toBe('02')
    expect(await prisma.privateCourseEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } }))
      .toMatchObject({ status: 'ACTIVE', remainingSessions: enrollment.remainingSessions })
    expect(await prisma.payment.count({ where: { orderId: order.id, status: 'SUCCESS' } })).toBe(1)
    expect(await prisma.invoice.count({ where: { orderId: order.id } })).toBe(1)
  })

  it('uses the idempotent finance transaction for the legacy full-wallet payment route', async () => {
    const member = await createMember()
    const coach = await createCoach()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const enrollment = await createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: course.id,
      status: 'PENDING_PAYMENT',
    })
    await prisma.wallet.create({ data: { memberId: member.id, balance: 6_000_000 } })
    const order = await createServiceOrder({
      memberId: member.id,
      itemType: 'PRIVATE_COURSE',
      itemName: course.name,
      unitPrice: 6_000_000,
      privateEnrollmentId: enrollment.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })

    const paid = await request(app)
      .post(`/api/orders/${order.id}/pay`)
      .set('Authorization', member.auth)
      .send()
    const duplicate = await request(app)
      .post(`/api/orders/${order.id}/pay`)
      .set('Authorization', member.auth)
      .send()

    expect(paid.status).toBe(200)
    expect(duplicate.status).toBe(409)
    expect(await prisma.privateCourseEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } }))
      .toMatchObject({ status: 'ACTIVE' })
    expect(await prisma.payment.count({ where: { orderId: order.id, status: 'SUCCESS' } })).toBe(1)
    expect(await prisma.walletTransaction.count({
      where: { walletId: (await prisma.wallet.findUniqueOrThrow({ where: { memberId: member.id } })).id, type: 'ORDER_DEBIT' },
    })).toBe(1)
  })

  it('hoàn một phần vào ví đúng một lần rồi dùng ví thanh toán kết hợp', async () => {
    const scenario = await createGroupOrder()
    const receptionist = await createReceptionist()
    const manager = await createManager()
    await request(app)
      .post(`/api/orders/${scenario.order.id}/payments/cash`)
      .set('Authorization', receptionist.auth)
      .send({ amount: 1_000_000 })
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: scenario.order.id } })
    await prisma.classRegistration.update({ where: { id: scenario.registration.id }, data: { status: 'CANCELLED' } })

    const requested = await request(app)
      .post(`/api/payments/${payment.id}/refund-requests`)
      .set('Authorization', scenario.member!.auth)
      .send({ requestedAmount: 400_000, reason: 'Hủy lớp đúng chính sách hoàn tiền' })
    const approved = await request(app)
      .patch(`/api/refund-requests/${requested.body.id}/review`)
      .set('Authorization', manager.auth)
      .send({ decision: 'APPROVE', approvedAmount: 300_000, note: 'Duyệt hoàn một phần' })
    const completed = await request(app)
      .post(`/api/refund-requests/${requested.body.id}/complete`)
      .set('Authorization', manager.auth)
      .send()
    const retried = await request(app)
      .post(`/api/refund-requests/${requested.body.id}/complete`)
      .set('Authorization', manager.auth)
      .send()

    expect(requested.status).toBe(201)
    expect(approved.body.status).toBe('APPROVED')
    expect(completed.body.status).toBe('COMPLETED')
    expect(retried.body.status).toBe('COMPLETED')
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId: scenario.memberId } })
    expect(Number(wallet.balance)).toBe(300_000)
    expect(await prisma.walletTransaction.count({ where: { idempotencyKey: `REFUND_CREDIT:${requested.body.id}` } })).toBe(1)
    expect(await prisma.paymentAdjustment.count({ where: { paymentId: payment.id } })).toBe(1)

    const next = await createGroupOrder({ memberId: scenario.memberId, price: 500_000 })
    const walletPaid = await request(app)
      .post(`/api/orders/${next.order.id}/wallet-payments`)
      .set('Authorization', scenario.member!.auth)
      .send({ amount: 200_000 })
    expect(walletPaid.status).toBe(201)
    expect(walletPaid.body).toMatchObject({ walletBalance: 100_000, remainingAmount: 300_000 })
  })

  it('báo cáo trừ hoàn tiền, xuất file và Audit Log chỉ đọc được bởi Manager', async () => {
    const scenario = await createGroupOrder()
    const receptionist = await createReceptionist()
    const manager = await createManager()
    await request(app).post(`/api/orders/${scenario.order.id}/payments/cash`).set('Authorization', receptionist.auth).send({ amount: 1_000_000 })
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: scenario.order.id } })
    await prisma.classRegistration.update({ where: { id: scenario.registration.id }, data: { status: 'CANCELLED' } })
    const refund = await request(app).post(`/api/payments/${payment.id}/refund-requests`).set('Authorization', scenario.member!.auth).send({ requestedAmount: 250_000, reason: 'Hủy dịch vụ đúng chính sách' })
    await request(app).patch(`/api/refund-requests/${refund.body.id}/review`).set('Authorization', manager.auth).send({ decision: 'APPROVE', approvedAmount: 250_000, note: 'Đủ điều kiện' })
    await request(app).post(`/api/refund-requests/${refund.body.id}/complete`).set('Authorization', manager.auth).send()

    const report = await request(app).get('/api/reports/revenue').set('Authorization', manager.auth)
    const excel = await request(app).get('/api/reports/revenue/export?format=xlsx').set('Authorization', manager.auth)
    const pdf = await request(app).get('/api/reports/revenue/export?format=pdf').set('Authorization', manager.auth)
    const audit = await request(app).get('/api/audit-logs').set('Authorization', manager.auth)
    const forbiddenAudit = await request(app).get('/api/audit-logs').set('Authorization', scenario.member!.auth)

    expect(report.body).toMatchObject({ gross: 1_000_000, refunds: 250_000, net: 750_000, transactions: 1 })
    expect(excel.status).toBe(200)
    expect(excel.headers['content-type']).toContain('spreadsheetml')
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(audit.body.items.some((item: { action: string }) => item.action === 'COMPLETE_REFUND_TO_WALLET')).toBe(true)
    expect(forbiddenAudit.status).toBe(403)
  })
})
