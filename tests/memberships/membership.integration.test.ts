import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { expirePendingOrders } from '../../src/modules/finance/order-expiry.service.js'
import { hasTestDatabase } from '../support/test-database.js'
import { createManager, createMember, createReceptionist, resetDatabase } from '../training/fixtures.js'

type User = Awaited<ReturnType<typeof createMember>>

describe.skipIf(!hasTestDatabase)('Membership và check-in', () => {
  let manager: User
  let receptionist: User
  let member: User
  let planId: number
  let memberCode: string

  const fund = (id: number, balance: number) => prisma.wallet.upsert({ where: { memberId: id }, create: { memberId: id, balance }, update: { balance } })
  const buy = (auth: string) => request(app).post('/api/memberships/purchase').set('Authorization', auth).send({ planId })
  const payWallet = (orderId: number, amount: number, auth = member.auth) =>
    request(app).post(`/api/orders/${orderId}/wallet-payments`).set('Authorization', auth).send({ amount })
  const scan = (code = memberCode) => request(app).post('/api/check-ins').set('Authorization', receptionist.auth).send({ memberCode: code, method: 'QR' })

  async function buyAndPay() {
    const purchase = await buy(member.auth)
    expect(purchase.status).toBe(201)
    const paid = await payWallet(purchase.body.orderId, 900_000)
    expect(paid.status).toBeLessThan(300)
    return purchase.body.orderId as number
  }

  beforeAll(async () => {
    await resetDatabase()
    manager = await createManager()
    receptionist = await createReceptionist()
  })

  beforeEach(async () => {
    member = await createMember()
    memberCode = `SGT${member.id}`
    await prisma.member.update({ where: { userId: member.id }, data: { memberCode } })
    await fund(member.id, 5_000_000)
    const created = await request(app).post('/api/memberships/plans/manage').set('Authorization', manager.auth)
      .send({ name: 'Gói 3 tháng', durationMonths: 3, price: 900_000, status: 'ACTIVE' })
    expect(created.status).toBe(201)
    planId = created.body.id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('chỉ Manager tạo được gói và gói ACTIVE xuất hiện công khai', async () => {
    const denied = await request(app).post('/api/memberships/plans/manage').set('Authorization', member.auth)
      .send({ name: 'Không được', durationMonths: 1, price: 100 })
    expect(denied.status).toBe(403)
    const publicPlans = await request(app).get('/api/memberships/plans')
    expect(publicPlans.body.some((plan: { id: number }) => plan.id === planId)).toBe(true)
  })

  it('thanh toán đủ thì kích hoạt và check-in được; quét lặp không tạo bản ghi mới', async () => {
    await buyAndPay()
    const mine = await request(app).get('/api/members/me/membership').set('Authorization', member.auth)
    expect(mine.body.current.status).toBe('ACTIVE')

    const first = await scan(memberCode.toLowerCase())
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ alreadyCheckedIn: false, planName: 'Gói 3 tháng', method: 'QR' })
    expect(first.body.daysRemaining).toBeGreaterThan(80)

    const second = await scan()
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ alreadyCheckedIn: true, id: first.body.id })
    expect(await prisma.gymCheckIn.count({ where: { memberId: member.id } })).toBe(1)
  })

  it('mua thêm khi còn hạn thì gói mới nối tiếp, không chồng ngày', async () => {
    await buyAndPay()
    await buyAndPay()
    const rows = await prisma.memberSubscription.findMany({ where: { memberId: member.id, status: 'ACTIVE' }, orderBy: { startDate: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[1]!.startDate!.getTime()).toBe(rows[0]!.endDate!.getTime() + 86_400_000)
  })

  it('từ chối check-in: sai mã, chưa có gói, tài khoản bị khóa', async () => {
    expect((await scan('SGKHONGCO')).body.code).toBe('MEMBER_NOT_FOUND')

    const noPlan = await scan()
    expect(noPlan.status).toBe(409)
    expect(noPlan.body.code).toBe('NO_ACTIVE_MEMBERSHIP')
    expect(noPlan.body.details.member.id).toBe(member.id)

    await prisma.user.update({ where: { id: member.id }, data: { status: 'LOCKED' } })
    expect((await scan()).body.code).toBe('ACCOUNT_INACTIVE')
  })

  it('gói đã hết hạn không check-in được', async () => {
    await buyAndPay()
    await prisma.memberSubscription.updateMany({
      where: { memberId: member.id },
      data: { startDate: new Date('2025-01-01'), endDate: new Date('2025-01-31') },
    })
    expect((await scan()).body.code).toBe('NO_ACTIVE_MEMBERSHIP')
  })

  it('không cho hai đơn chờ cùng lúc, đơn quá hạn thì hủy và mua lại được', async () => {
    const first = await buy(member.auth)
    const second = await buy(member.auth)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('MEMBERSHIP_PENDING_PAYMENT')

    const now = new Date(Date.now() + 16 * 60 * 1000)
    await expirePendingOrders(now)
    expect((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: first.body.orderId } })).status).toBe('EXPIRED')
    expect((await prisma.memberSubscription.findUniqueOrThrow({ where: { id: first.body.subscriptionId } })).status).toBe('CANCELLED')
    expect((await buy(member.auth)).status).toBe(201)
  })

  it('mã khuyến mãi áp đúng theo loại hình', async () => {
    const stamp = Date.now()
    const create = (code: string, applicableType: string) => request(app).post('/api/promotions').set('Authorization', manager.auth).send({
      code, name: code, discountType: 'PERCENTAGE', discountValue: 10, applicableType, status: 'ACTIVE',
      startAt: new Date(stamp - 60_000).toISOString(), endAt: new Date(stamp + 86_400_000).toISOString(),
    })
    const membershipCode = `MB${stamp}`
    const courseCode = `GC${stamp}`
    expect((await create(membershipCode, 'MEMBERSHIP')).status).toBe(201)
    expect((await create(courseCode, 'GROUP_CLASS')).status).toBe(201)

    const purchase = await buy(member.auth)
    const apply = (code: string) => request(app).post(`/api/orders/${purchase.body.orderId}/promotion`).set('Authorization', member.auth).send({ code })
    const wrong = await apply(courseCode)
    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe('PROMOTION_SCOPE_MISMATCH')

    const right = await apply(membershipCode)
    expect(right.status).toBe(200)
    expect(Number(right.body.finalAmount)).toBe(810_000)
  })

  it('Lễ tân tạo đơn hộ và thu tiền mặt thì gói được kích hoạt', async () => {
    const purchase = await request(app).post(`/api/members/${member.id}/memberships`).set('Authorization', receptionist.auth).send({ planId })
    expect(purchase.status).toBe(201)
    const cash = await request(app).post(`/api/orders/${purchase.body.orderId}/payments/cash`).set('Authorization', receptionist.auth).send({ amount: 900_000 })
    expect(cash.status).toBeLessThan(300)
    expect((await scan()).status).toBe(201)
  })
})
