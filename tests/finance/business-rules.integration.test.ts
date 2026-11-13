import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { invalidateAuthState } from '../../src/lib/auth-state.js'
import { hasTestDatabase } from '../support/test-database.js'
import { createManager, createMember, createReceptionist, resetDatabase } from '../training/fixtures.js'

type User = Awaited<ReturnType<typeof createMember>>

// BR-35 và BR-49: kiểm tra trên database test thật
describe.skipIf(!hasTestDatabase)('Business rules: thu tiền mặt và audit thanh toán', () => {
  let manager: User
  let receptionist: User
  let member: User
  let planId: number

  beforeAll(async () => {
    await resetDatabase()
    manager = await createManager()
    receptionist = await createReceptionist()
    member = await createMember()
    await prisma.wallet.create({ data: { memberId: member.id, balance: 5_000_000 } })
    const plan = await request(app).post('/api/memberships/plans/manage').set('Authorization', manager.auth)
      .send({ name: 'Gói 1 tháng', durationMonths: 1, price: 300_000, status: 'ACTIVE' })
    planId = plan.body.id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const newOrder = async () => (await request(app).post(`/api/members/${member.id}/memberships`).set('Authorization', receptionist.auth).send({ planId })).body.orderId as number

  it('BR-35: Manager không được thu tiền mặt; lễ tân bị khóa cũng không được', async () => {
    const orderId = await newOrder()
    const byManager = await request(app).post(`/api/orders/${orderId}/payments/cash`).set('Authorization', manager.auth).send({ amount: 300_000 })
    expect(byManager.status).toBe(403)

    await prisma.user.update({ where: { id: receptionist.id }, data: { status: 'LOCKED' } })
    invalidateAuthState(receptionist.id)
    const byLocked = await request(app).post(`/api/orders/${orderId}/payments/cash`).set('Authorization', receptionist.auth).send({ amount: 300_000 })
    // Tài khoản bị khóa bị chặn ngay ở middleware xác thực
    expect(byLocked.status).toBe(401)
    expect(byLocked.body.code).toBe('ACCOUNT_INACTIVE')
    await prisma.user.update({ where: { id: receptionist.id }, data: { status: 'ACTIVE' } })
    invalidateAuthState(receptionist.id)

    const byReceptionist = await request(app).post(`/api/orders/${orderId}/payments/cash`).set('Authorization', receptionist.auth).send({ amount: 300_000 })
    expect(byReceptionist.status).toBeLessThan(300)
    expect(byReceptionist.body.collectedById).toBe(receptionist.id)
  })

  it('BR-49: thanh toán bằng ví và tạo khuyến mãi đều ghi Audit Log', async () => {
    await prisma.memberSubscription.updateMany({ where: { memberId: member.id }, data: { status: 'CANCELLED' } })
    const orderId = (await request(app).post('/api/memberships/purchase').set('Authorization', member.auth).send({ planId })).body.orderId as number
    const paid = await request(app).post(`/api/orders/${orderId}/wallet-payments`).set('Authorization', member.auth).send({ amount: 300_000 })
    expect(paid.status).toBeLessThan(300)
    expect(await prisma.auditLog.count({ where: { action: 'WALLET_PAYMENT', entityId: String(paid.body.payment.id) } })).toBe(1)

    const promotion = await request(app).post('/api/promotions').set('Authorization', manager.auth).send({
      code: `AUDIT${Date.now()}`, name: 'Audit', discountType: 'PERCENTAGE', discountValue: 5, status: 'ACTIVE',
      startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(promotion.status).toBe(201)
    expect(await prisma.auditLog.count({ where: { action: 'CREATE_PROMOTION', entityId: String(promotion.body.id) } })).toBe(1)
  })
})
