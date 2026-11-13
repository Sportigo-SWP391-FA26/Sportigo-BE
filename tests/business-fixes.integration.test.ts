import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import sessionService from '../src/modules/class-sessions/session.service.js'
import waitlistService from '../src/modules/waitlist/waitlist.service.js'
import { hasTestDatabase } from './support/test-database.js'
import {
  DAY,
  createCoach,
  createEnrollment,
  createGroupClass,
  createManager,
  createMember,
  createPrivateCourse,
  createRoom,
  createSession,
  createSport,
  resetDatabase,
} from './training/fixtures.js'

describe.skipIf(!hasTestDatabase)('Sửa lỗ hổng nghiệp vụ', () => {
  beforeEach(resetDatabase)
  afterAll(() => prisma.$disconnect())

  it('lỗi 1: lịch 1-1 18:00 và buổi lớp nhóm 18:00 giờ Việt Nam bị phát hiện trùng Coach', async () => {
    const coach = await createCoach()
    const member = await createMember()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const enrollment = await createEnrollment({ memberId: member.id, coachId: coach.id, privateCourseId: course.id, status: 'ACTIVE' })
    const room = await createRoom()
    const monday = new Date('2027-03-01T00:00:00.000Z') // thứ Hai
    await prisma.privateCourseSchedule.create({
      data: {
        enrollmentId: enrollment.id, roomId: room.id, dayOfWeek: 1,
        startTime: new Date('1970-01-01T18:00:00.000Z'), endTime: new Date('1970-01-01T19:00:00.000Z'),
        effectiveFrom: monday, effectiveTo: new Date(monday.getTime() + 30 * DAY), status: 'ACTIVE',
      },
    })
    const sameTime = await sessionService.checkCoachConflict(coach.id, new Date('2027-03-01T18:30:00+07:00'), new Date('2027-03-01T19:30:00+07:00'))
    const otherTime = await sessionService.checkCoachConflict(coach.id, new Date('2027-03-01T11:00:00+07:00'), new Date('2027-03-01T12:00:00+07:00'))
    expect(sameTime).toBe(true)
    expect(otherTime).toBe(false)
  })

  it('lỗi 3: lớp đã có buổi diễn ra thì không hủy cả lớp được', async () => {
    const manager = await createManager()
    const coach = await createCoach()
    const sport = await createSport()
    const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id, status: 'OPEN' })
    const room = await createRoom()
    await createSession({ classId: groupClass.id, roomId: room.id, startsAt: Date.now() - DAY, endsAt: Date.now() - DAY + 3_600_000 })

    const response = await request(app).post(`/api/group-classes/${groupClass.id}/cancel`).set('Authorization', manager.auth)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('CLASS_ALREADY_STARTED')
    expect((await prisma.groupClass.findUniqueOrThrow({ where: { id: groupClass.id } })).status).toBe('OPEN')
  })

  it('lỗi 5: API điểm danh cũ từ chối buổi chưa bắt đầu', async () => {
    const coach = await createCoach()
    const member = await createMember()
    const sport = await createSport()
    const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id })
    const room = await createRoom()
    const session = await createSession({ classId: groupClass.id, roomId: room.id, startsAt: Date.now() + DAY, endsAt: Date.now() + DAY + 3_600_000 })
    await prisma.classRegistration.create({ data: { memberId: member.id, classId: groupClass.id, status: 'CONFIRMED', price: 0 } })

    const response = await request(app).post(`/api/sessions/${session.id}/check-in`).set('Authorization', coach.auth).send({ memberId: member.id, status: 'PRESENT' })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ATTENDANCE_LOCKED')
  })

  it('lỗi 4: tài khoản bị khóa không gọi API được dù token còn hạn', async () => {
    const member = await createMember()
    expect((await request(app).get('/api/members/me/wallet').set('Authorization', member.auth)).status).toBe(200)
    await prisma.user.update({ where: { id: member.id }, data: { status: 'LOCKED' } })
    const { invalidateAuthState } = await import('../src/lib/auth-state.js')
    invalidateAuthState(member.id)
    const blocked = await request(app).get('/api/members/me/wallet').set('Authorization', member.auth)
    expect(blocked.status).toBe(401)
    expect(blocked.body.code).toBe('ACCOUNT_INACTIVE')
  })

  it('lỗi 2: mã giảm 100% hoàn tất đơn 0 đồng và kích hoạt dịch vụ', async () => {
    const manager = await createManager()
    const member = await createMember()
    const plan = await request(app).post('/api/memberships/plans/manage').set('Authorization', manager.auth).send({ name: 'Gói 1 tháng', durationMonths: 1, price: 300_000, status: 'ACTIVE' })
    const code = `FREE${Date.now()}`
    expect((await request(app).post('/api/promotions').set('Authorization', manager.auth).send({
      code, name: 'Miễn phí', discountType: 'PERCENTAGE', discountValue: 100, applicableType: 'MEMBERSHIP', status: 'ACTIVE',
      startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(),
    })).status).toBe(201)
    const tooMuch = await request(app).post('/api/promotions').set('Authorization', manager.auth).send({
      code: `${code}X`, name: 'Sai', discountType: 'PERCENTAGE', discountValue: 150, status: 'ACTIVE',
      startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(),
    })
    expect(tooMuch.status).toBe(400)

    const purchase = await request(app).post('/api/memberships/purchase').set('Authorization', member.auth).send({ planId: plan.body.id })
    const applied = await request(app).post(`/api/orders/${purchase.body.orderId}/promotion`).set('Authorization', member.auth).send({ code })
    expect(applied.status).toBe(200)
    expect(applied.body).toMatchObject({ status: 'PAID' })
    expect((await prisma.memberSubscription.findUniqueOrThrow({ where: { id: purchase.body.subscriptionId } })).status).toBe('ACTIVE')
    expect(await prisma.invoice.count({ where: { orderId: purchase.body.orderId } })).toBe(1)
  })

  it('lỗi 7: đơn waitlist hết hạn được hoàn phần đã trả bằng ví', async () => {
    const coach = await createCoach()
    const member = await createMember()
    const sport = await createSport()
    const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id, status: 'OPEN' })
    const registration = await prisma.classRegistration.create({ data: { memberId: member.id, classId: groupClass.id, status: 'PENDING_PAYMENT', price: 1_000_000 } })
    const waitlist = await prisma.classWaitlist.create({ data: { memberId: member.id, classId: groupClass.id, status: 'ACCEPTED' } })
    const order = await prisma.serviceOrder.create({
      data: {
        memberId: member.id, orderNumber: `ORD-WL-TEST-${Date.now()}`, originalAmount: 1_000_000, finalAmount: 1_000_000,
        status: 'PENDING_PAYMENT', expiresAt: new Date(Date.now() + 60_000),
        items: { create: { classRegistrationId: registration.id, itemType: 'GROUP_CLASS', itemNameSnapshot: 'Lớp', unitPrice: 1_000_000, finalAmount: 1_000_000 } },
      },
    })
    await prisma.classWaitlistInvitation.create({ data: { waitlistId: waitlist.id, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 60_000), orderId: order.id } })
    await prisma.wallet.create({ data: { memberId: member.id, balance: 500_000 } })
    expect((await request(app).post(`/api/orders/${order.id}/wallet-payments`).set('Authorization', member.auth).send({ amount: 300_000 })).status).toBeLessThan(300)
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { memberId: member.id } })).balance)).toBe(200_000)

    await waitlistService.expireOffers(new Date(Date.now() + 120_000))
    expect((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('EXPIRED')
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { memberId: member.id } })).balance)).toBe(500_000)
  })
})
