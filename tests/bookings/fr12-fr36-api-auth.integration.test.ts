import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { createServiceOrder } from '../../src/modules/finance/finance.service.js'
import waitlistService from '../../src/modules/waitlist/waitlist.service.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  createCoach,
  createEnrollment,
  createGroupClass,
  createManager,
  createMember,
  createPrivateCourse,
  createRegistration,
  createRoom,
  createSport,
  createSession,
  resetDatabase,
} from '../training/fixtures.js'

describe.skipIf(!hasTestDatabase)('FR-12–FR-36 API authentication and ownership', () => {
  beforeEach(resetDatabase)
  afterAll(() => prisma.$disconnect())

  it('mounts every protected FR-12–FR-36 endpoint behind authentication', async () => {
    const protectedEndpoints = [
      ['get', '/api/sports'],
      ['post', '/api/sports'],
      ['put', '/api/sports/1'],
      ['delete', '/api/sports/1'],
      ['get', '/api/rooms'],
      ['post', '/api/rooms'],
      ['put', '/api/rooms/1'],
      ['delete', '/api/rooms/1'],
      ['get', '/api/coaches/1/availability'],
      ['post', '/api/coaches/1/availability'],
      ['get', '/api/group-classes'],
      ['post', '/api/group-classes'],
      ['patch', '/api/group-classes/1/status'],
      ['patch', '/api/group-classes/1/coach'],
      ['get', '/api/group-classes/1/sessions'],
      ['post', '/api/group-classes/1/sessions'],
      ['post', '/api/group-classes/1/sessions/recurring'],
      ['post', '/api/group-classes/1/cancel'],
      ['post', '/api/group-classes/1/register-on-behalf'],
      ['post', '/api/class-sessions'],
      ['post', '/api/class-sessions/1/change'],
      ['post', '/api/bookings/classes/1/register'],
      ['post', '/api/bookings/registrations/1/cancel'],
      ['post', '/api/group-classes/1/waitlist'],
      ['post', '/api/group-classes/1/waitlist/respond'],
      ['get', '/api/private-courses'],
      ['post', '/api/private-courses'],
      ['patch', '/api/private-courses/1'],
      ['post', '/api/private-courses/1/coaches'],
      ['delete', '/api/private-courses/1/coaches/1'],
      ['post', '/api/private-courses/1/enroll'],
      ['get', '/api/private-courses/enrollments'],
      ['post', '/api/private-courses/enrollments'],
      ['get', '/api/private-courses/enrollments/1'],
      ['post', '/api/private-courses/enrollments/1/schedules'],
      ['post', '/api/private-courses/enrollments/1/schedules/1/attendance'],
      ['post', '/api/orders/1/pay'],
      ['get', '/api/orders/1'],
      ['post', '/api/orders/1/promotion'],
      ['post', '/api/orders/1/payments/vnpay'],
      ['post', '/api/orders/1/payments/cash'],
      ['post', '/api/orders/1/wallet-payments'],
      ['get', '/api/members/me/wallet'],
      ['get', '/api/payments'],
      ['post', '/api/payments/1/refund-requests'],
      ['get', '/api/refund-requests'],
      ['patch', '/api/refund-requests/1/review'],
      ['post', '/api/refund-requests/1/complete'],
      ['get', '/api/promotions'],
      ['post', '/api/promotions'],
      ['patch', '/api/promotions/1'],
      ['get', '/api/reports/revenue'],
      ['get', '/api/reports/revenue/export'],
      ['get', '/api/reports/classes'],
      ['get', '/api/reports/classes/export'],
      ['get', '/api/audit-logs'],
      ['get', '/api/invoices/1/pdf'],
      ['get', '/api/reports/attendance'],
      ['get', '/api/sessions/1/attendance'],
      ['post', '/api/sessions/1/check-in'],
      ['get', '/api/class-sessions/1/attendance'],
      ['put', '/api/class-sessions/1/attendance'],
      ['get', '/api/attendance'],
      ['get', '/api/workout-plans'],
      ['post', '/api/workout-plans'],
      ['get', '/api/workout-plans/1'],
      ['patch', '/api/workout-plans/1'],
      ['patch', '/api/workout-plans/1/status'],
      ['delete', '/api/workout-plans/1'],
      ['get', '/api/workout-plans/1/items'],
      ['post', '/api/workout-plans/1/items'],
      ['patch', '/api/workout-plans/1/items/reorder'],
      ['patch', '/api/workout-plans/1/items/1'],
      ['delete', '/api/workout-plans/1/items/1'],
      ['get', '/api/private-enrollments/1/plans'],
      ['post', '/api/private-enrollments/1/plans'],
      ['get', '/api/progress-assessments'],
      ['post', '/api/progress-assessments'],
      ['get', '/api/members/me/training'],
    ] as const

    for (const [method, path] of protectedEndpoints) {
      const response = method === 'get'
        ? await request(app).get(path)
        : method === 'post'
          ? await request(app).post(path).send({})
          : method === 'put'
            ? await request(app).put(path).send({})
            : method === 'patch'
              ? await request(app).patch(path).send({})
              : await request(app).delete(path)
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(401)
    }

    const invalidToken = await request(app)
      .get('/api/sports')
      .set('Authorization', 'Bearer invalid-token')
    expect(invalidToken.status).toBe(401)
  })

  it('keeps public class discovery open and protects management routes by role', async () => {
    const manager = await createManager()
    const member = await createMember()

    const publicList = await request(app).get('/api/bookings/classes')
    const unauthenticatedSports = await request(app).get('/api/sports')
    const memberSports = await request(app)
      .get('/api/sports')
      .set('Authorization', member.auth)
    const forbiddenCreate = await request(app)
      .post('/api/sports')
      .set('Authorization', member.auth)
      .send({ name: 'Member-created sport' })
    const createdSport = await request(app)
      .post('/api/sports')
      .set('Authorization', manager.auth)
      .send({ name: 'Manager-created sport' })
    const duplicateSport = await request(app)
      .post('/api/sports')
      .set('Authorization', manager.auth)
      .send({ name: 'Manager-created sport' })
    const invalidRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', manager.auth)
      .send({ code: 'ROOM-INVALID', name: 'Invalid capacity', capacity: 0 })
    const missingRoom = await request(app)
      .put('/api/rooms/999999')
      .set('Authorization', manager.auth)
      .send({ name: 'Missing room update' })

    expect(publicList.status).toBe(200)
    expect(unauthenticatedSports.status).toBe(401)
    expect(memberSports.status).toBe(200)
    expect(forbiddenCreate.status).toBe(403)
    expect(createdSport.status).toBe(201)
    expect(duplicateSport.status).toBe(409)
    expect(invalidRoom.status).toBe(400)
    expect(missingRoom.status).toBe(404)
  })

  async function createRecurrenceScenario() {
    const sport = await createSport()
    const coach = await createCoach()
    const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id })
    const room = await createRoom()
    const manager = await createManager()
    const today = new Date()
    const firstDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    firstDate.setUTCDate(firstDate.getUTCDate() + ((7 - firstDate.getUTCDay()) % 7 || 7))
    const lastDate = new Date(firstDate)
    lastDate.setUTCDate(lastDate.getUTCDate() + 21)
    const dateString = (date: Date) => date.toISOString().slice(0, 10)
    const availabilityFrom = new Date(firstDate)
    availabilityFrom.setUTCDate(availabilityFrom.getUTCDate() - 7)
    const availabilityTo = new Date(lastDate)
    availabilityTo.setUTCDate(availabilityTo.getUTCDate() + 7)
    await prisma.coachAvailability.create({
      data: {
        coachId: coach.id,
        dayOfWeek: firstDate.getUTCDay(),
        startTime: new Date('1970-01-01T09:00:00.000Z'),
        endTime: new Date('1970-01-01T12:00:00.000Z'),
        effectiveFrom: availabilityFrom,
        effectiveTo: availabilityTo,
      },
    })
    return { coach, groupClass, room, manager, firstDate, lastDate, dateString }
  }

  async function createOpenBookingClass(capacity = 1) {
    const sport = await createSport()
    const coach = await createCoach()
    const today = new Date()
    const firstSessionDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 5))
    const classStartDate = new Date(firstSessionDate)
    classStartDate.setUTCDate(classStartDate.getUTCDate() + 1)
    const classEndDate = new Date(classStartDate)
    classEndDate.setUTCDate(classEndDate.getUTCDate() + 14)
    const groupClass = await prisma.groupClass.create({
      data: {
        sportId: sport.id,
        coachId: coach.id,
        status: 'OPEN',
        name: `Concurrent booking ${Date.now()}`,
        capacity,
        tuitionFee: 1000,
        registrationOpenAt: new Date(Date.now() - 60_000),
        registrationCloseAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        startDate: classStartDate,
        endDate: classEndDate,
      },
    })
    const room = await createRoom()
    const session = await prisma.classSession.create({
      data: {
        classId: groupClass.id,
        roomId: room.id,
        startsAt: new Date(firstSessionDate.getTime() + 10 * 60 * 60 * 1000),
        endsAt: new Date(firstSessionDate.getTime() + 11 * 60 * 60 * 1000),
      },
    })
    return { groupClass, session }
  }

  it('serializes concurrent bookings for the last seat and rejects duplicate member registrations', async () => {
    const { groupClass } = await createOpenBookingClass(1)
    const firstMember = await createMember()
    const secondMember = await createMember()
    const competingBookings = await Promise.all([
      request(app).post(`/api/bookings/classes/${groupClass.id}/register`).set('Authorization', firstMember.auth).send(),
      request(app).post(`/api/bookings/classes/${groupClass.id}/register`).set('Authorization', secondMember.auth).send(),
    ])
    expect(competingBookings.map((response) => response.status).sort()).toEqual([201, 409])
    expect(await prisma.classRegistration.count({
      where: { classId: groupClass.id, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
    })).toBe(1)

    const duplicateClass = await createOpenBookingClass(2)
    const duplicateRequests = await Promise.all([
      request(app).post(`/api/bookings/classes/${duplicateClass.groupClass.id}/register`).set('Authorization', firstMember.auth).send(),
      request(app).post(`/api/bookings/classes/${duplicateClass.groupClass.id}/register`).set('Authorization', firstMember.auth).send(),
    ])
    expect(duplicateRequests.map((response) => response.status).sort()).toEqual([201, 409])
    expect(await prisma.classRegistration.count({ where: { classId: duplicateClass.groupClass.id } })).toBe(1)
  })

  it('keeps a freed seat consistent with a simultaneous new booking', async () => {
    const { groupClass } = await createOpenBookingClass(1)
    const cancellingMember = await createMember()
    const bookingMember = await createMember()
    const registration = await createRegistration({ memberId: cancellingMember.id, classId: groupClass.id })

    const [cancellation, newBooking] = await Promise.all([
      request(app)
        .post(`/api/bookings/registrations/${registration.id}/cancel`)
        .set('Authorization', cancellingMember.auth)
        .send(),
      request(app)
        .post(`/api/bookings/classes/${groupClass.id}/register`)
        .set('Authorization', bookingMember.auth)
        .send(),
    ])

    expect(cancellation.status).toBe(200)
    expect([201, 409]).toContain(newBooking.status)
    expect(await prisma.classRegistration.count({
      where: { classId: groupClass.id, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
    })).toBeLessThanOrEqual(1)
  })

  it('promotes one FIFO waitlist offer, expires it idempotently, and serializes expiry against acceptance', async () => {
    const { groupClass } = await createOpenBookingClass(1)
    const cancelledMember = await createMember()
    const firstWaitingMember = await createMember()
    const secondWaitingMember = await createMember()
    const registration = await createRegistration({ memberId: cancelledMember.id, classId: groupClass.id })
    for (const member of [firstWaitingMember, secondWaitingMember]) {
      const joined = await request(app)
        .post(`/api/group-classes/${groupClass.id}/waitlist`)
        .set('Authorization', member.auth)
        .send()
      expect(joined.status).toBe(201)
    }

    const cancelled = await request(app)
      .post(`/api/bookings/registrations/${registration.id}/cancel`)
      .set('Authorization', cancelledMember.auth)
      .send()
    expect(cancelled.status).toBe(200)

    const concurrentPromotions = await Promise.all([
      waitlistService.processWaitlistOffer(groupClass.id),
      waitlistService.processWaitlistOffer(groupClass.id),
    ])
    expect(concurrentPromotions[0]?.id).toBe(concurrentPromotions[1]?.id)
    expect(concurrentPromotions[0]?.memberId).toBe(firstWaitingMember.id)
    expect(await prisma.classWaitlist.count({ where: { classId: groupClass.id, status: 'OFFERED' } })).toBe(1)
    const bypassWaitlist = await request(app)
      .post(`/api/bookings/classes/${groupClass.id}/register`)
      .set('Authorization', secondWaitingMember.auth)
      .send()
    expect(bypassWaitlist.status).toBe(409)

    await prisma.classWaitlist.update({
      where: { memberId_classId: { memberId: firstWaitingMember.id, classId: groupClass.id } },
      data: { offerExpiresAt: new Date(Date.now() - 1) },
    })
    const [expiryResult, acceptance] = await Promise.all([
      waitlistService.expireOffers(),
      request(app)
        .post(`/api/group-classes/${groupClass.id}/waitlist/respond`)
        .set('Authorization', firstWaitingMember.auth)
        .send({ accept: true }),
    ])

    expect(expiryResult.processedClasses).toBe(1)
    expect(acceptance.status).toBe(409)
    expect(await prisma.classWaitlist.findUnique({
      where: { memberId_classId: { memberId: firstWaitingMember.id, classId: groupClass.id } },
    })).toMatchObject({ status: 'EXPIRED' })
    expect(await prisma.classWaitlist.findUnique({
      where: { memberId_classId: { memberId: secondWaitingMember.id, classId: groupClass.id } },
    })).toMatchObject({ status: 'OFFERED' })
    expect(await prisma.classRegistration.count({
      where: { classId: groupClass.id, memberId: firstWaitingMember.id },
    })).toBe(0)
    expect((await waitlistService.expireOffers()).expiredCount).toBe(0)
  })

  it('generates and persists all actual weekly class-session records through the inclusive end date', async () => {
    const scenario = await createRecurrenceScenario()
    const response = await request(app)
      .post(`/api/group-classes/${scenario.groupClass.id}/sessions/recurring`)
      .set('Authorization', scenario.manager.auth)
      .send({
        roomId: scenario.room.id,
        recurrence: {
          dayOfWeek: scenario.firstDate.getUTCDay(),
          startTime: '10:00',
          endTime: '11:00',
          effectiveFrom: scenario.dateString(scenario.firstDate),
          effectiveTo: scenario.dateString(scenario.lastDate),
        },
      })

    expect(response.status).toBe(201)
    expect(response.body.data).toHaveLength(4)
    expect(await prisma.classSession.count({ where: { classId: scenario.groupClass.id } })).toBe(4)
    expect(response.body.data.map((session: { startsAt: string }) =>
      new Date(session.startsAt).toISOString().slice(0, 10),
    )).toEqual([
      scenario.dateString(scenario.firstDate),
      ...[1, 2, 3].map((week) => {
        const date = new Date(scenario.firstDate)
        date.setUTCDate(date.getUTCDate() + 7 * week)
        return scenario.dateString(date)
      }),
    ])
  })

  it('rejects a conflict in a later recurrence week without saving earlier occurrences', async () => {
    const scenario = await createRecurrenceScenario()
    const conflictDate = new Date(scenario.firstDate)
    conflictDate.setUTCDate(conflictDate.getUTCDate() + 14)
    await prisma.classSession.create({
      data: {
        classId: scenario.groupClass.id,
        roomId: scenario.room.id,
        startsAt: new Date(`${scenario.dateString(conflictDate)}T10:30:00.000Z`),
        endsAt: new Date(`${scenario.dateString(conflictDate)}T11:30:00.000Z`),
      },
    })

    const response = await request(app)
      .post(`/api/group-classes/${scenario.groupClass.id}/sessions/recurring`)
      .set('Authorization', scenario.manager.auth)
      .send({
        roomId: scenario.room.id,
        recurrence: {
          dayOfWeek: scenario.firstDate.getUTCDay(),
          startTime: '10:00',
          endTime: '11:00',
          effectiveFrom: scenario.dateString(scenario.firstDate),
          effectiveTo: scenario.dateString(scenario.lastDate),
        },
      })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ROOM_SCHEDULE_CONFLICT')
    expect(await prisma.classSession.count({ where: { classId: scenario.groupClass.id } })).toBe(1)
  })

  it('takes private-course member identity from the token and snapshots schedules before payment', async () => {
    const member = await createMember()
    const forgedMember = await createMember()
    const coach = await createCoach()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const room = await createRoom()
    await prisma.coachSport.create({
      data: { coachId: coach.id, sportId: sport.id },
    })
    await prisma.coachPrivateCourse.create({
      data: { coachId: coach.id, privateCourseId: course.id, isActive: true },
    })
    const startDate = new Date()
    startDate.setUTCDate(startDate.getUTCDate() + 7)
    const effectiveTo = new Date(startDate)
    effectiveTo.setUTCDate(effectiveTo.getUTCDate() + course.validityDays)
    const dateString = (date: Date) => date.toISOString().slice(0, 10)
    await prisma.coachAvailability.create({
      data: {
        coachId: coach.id,
        dayOfWeek: startDate.getUTCDay(),
        startTime: new Date('1970-01-01T08:00:00.000Z'),
        endTime: new Date('1970-01-01T12:00:00.000Z'),
        effectiveFrom: startDate,
        effectiveTo,
      },
    })

    const response = await request(app)
      .post('/api/private-courses/enrollments')
      .set('Authorization', member.auth)
      .send({
        memberId: forgedMember.id,
        privateCourseId: course.id,
        coachId: coach.id,
        startDate: dateString(startDate),
        schedules: [{ dayOfWeek: startDate.getUTCDay(), startTime: '09:00', roomId: room.id }],
      })

    expect(response.status).toBe(201)
    expect(response.body.data.enrollment).toMatchObject({
      memberId: member.id,
      status: 'PENDING_PAYMENT',
      remainingSessions: course.totalSessions,
    })
    expect(await prisma.privateCourseSchedule.count({
      where: { enrollmentId: response.body.data.enrollment.id },
    })).toBe(1)
    const addScheduleBeforePayment = await request(app)
      .post(`/api/private-courses/enrollments/${response.body.data.enrollment.id}/schedules`)
      .set('Authorization', member.auth)
      .send({
        dayOfWeek: startDate.getUTCDay(),
        startTime: '09:00',
        endTime: '10:00',
        effectiveFrom: dateString(startDate),
        effectiveTo: dateString(effectiveTo),
        roomId: room.id,
      })
    expect(addScheduleBeforePayment.status).toBe(409)
    expect(addScheduleBeforePayment.body.code).toBe('ENROLLMENT_NOT_ACTIVE')
  })

  it('limits private enrollment details to the member, assigned coach, or staff', async () => {
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    const member = await createMember()
    const otherMember = await createMember()
    const coach = await createCoach()
    const otherCoach = await createCoach()
    const manager = await createManager()
    const enrollment = await createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: course.id,
    })

    const ownMemberRead = await request(app)
      .get(`/api/private-courses/enrollments/${enrollment.id}`)
      .set('Authorization', member.auth)
    const otherMemberRead = await request(app)
      .get(`/api/private-courses/enrollments/${enrollment.id}`)
      .set('Authorization', otherMember.auth)
    const assignedCoachRead = await request(app)
      .get(`/api/private-courses/enrollments/${enrollment.id}`)
      .set('Authorization', coach.auth)
    const unassignedCoachRead = await request(app)
      .get(`/api/private-courses/enrollments/${enrollment.id}`)
      .set('Authorization', otherCoach.auth)
    const managerRead = await request(app)
      .get(`/api/private-courses/enrollments/${enrollment.id}`)
      .set('Authorization', manager.auth)
    const missingEnrollment = await request(app)
      .get('/api/private-courses/enrollments/999999')
      .set('Authorization', member.auth)

    expect(ownMemberRead.status).toBe(200)
    expect(otherMemberRead.status).toBe(403)
    expect(assignedCoachRead.status).toBe(200)
    expect(unassignedCoachRead.status).toBe(403)
    expect(managerRead.status).toBe(200)
    expect(missingEnrollment.status).toBe(404)
  })

  it('returns 401/403 on write routes and prevents Members cancelling another Member registration', async () => {
    const sport = await createSport()
    const coach = await createCoach()
    const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id })
    const member = await createMember()
    const otherMember = await createMember()
    const registration = await createRegistration({
      memberId: member.id,
      classId: groupClass.id,
    })

    const noToken = await request(app)
      .post(`/api/bookings/classes/${groupClass.id}/register`)
      .send()
    const wrongRole = await request(app)
      .post(`/api/bookings/classes/${groupClass.id}/register`)
      .set('Authorization', coach.auth)
      .send()
    const foreignCancellation = await request(app)
      .post(`/api/bookings/registrations/${registration.id}/cancel`)
      .set('Authorization', otherMember.auth)
      .send()
    const missingWaitlistClass = await request(app)
      .post('/api/group-classes/999999/waitlist')
      .set('Authorization', member.auth)
      .send()

    expect(noToken.status).toBe(401)
    expect(wrongRole.status).toBe(403)
    expect(foreignCancellation.status).toBe(403)
    expect(missingWaitlistClass.status).toBe(404)
  })

  it('protects legacy payment, report, and attendance endpoints', async () => {
    const member = await createMember()
    const coach = await createCoach()
    const otherCoach = await createCoach()
    const manager = await createManager()
    const orderOwner = await createMember()
    const sport = await createSport()
    const groupClass = await createGroupClass({ sportId: sport.id, coachId: coach.id })
    const room = await prisma.room.create({
      data: { code: 'AUTH-ROOM', name: 'Auth test room', capacity: 30 },
    })
    const session = await createSession({
      classId: groupClass.id,
      roomId: room.id,
      startsAt: Date.now() + 60 * 60 * 1000,
      endsAt: Date.now() + 2 * 60 * 60 * 1000,
    })
    const registration = await createRegistration({
      memberId: orderOwner.id,
      classId: groupClass.id,
    })
    const order = await createServiceOrder({
      memberId: orderOwner.id,
      itemType: 'GROUP_CLASS',
      itemName: groupClass.name,
      unitPrice: 1000,
      classRegistrationId: registration.id,
    })

    const unauthenticatedPayment = await request(app)
      .post(`/api/orders/${order.id}/pay`)
      .send({ actorUserId: orderOwner.id })
    const forbiddenPaymentRole = await request(app)
      .post(`/api/orders/${order.id}/pay`)
      .set('Authorization', coach.auth)
      .send()
    const foreignOrderPayment = await request(app)
      .post(`/api/orders/${order.id}/pay`)
      .set('Authorization', member.auth)
      .send({ actorUserId: orderOwner.id })
    const unauthenticatedReport = await request(app).get('/api/reports/attendance')
    const memberReport = await request(app)
      .get('/api/reports/attendance')
      .set('Authorization', member.auth)
    const coachAttendance = await request(app)
      .get(`/api/sessions/${session.id}/attendance`)
      .set('Authorization', coach.auth)
    const otherCoachAttendance = await request(app)
      .get(`/api/sessions/${session.id}/attendance`)
      .set('Authorization', otherCoach.auth)
    const coachCheckIn = await request(app)
      .post(`/api/sessions/${session.id}/check-in`)
      .set('Authorization', coach.auth)
      .send({
        memberId: orderOwner.id,
        status: 'PRESENT',
        markedById: otherCoach.id,
      })
    const memberCheckIn = await request(app)
      .post(`/api/sessions/${session.id}/check-in`)
      .set('Authorization', member.auth)
      .send({ memberId: orderOwner.id, status: 'PRESENT' })
    const managerReport = await request(app)
      .get('/api/reports/attendance')
      .set('Authorization', manager.auth)

    expect(unauthenticatedPayment.status).toBe(401)
    expect(forbiddenPaymentRole.status).toBe(403)
    expect(foreignOrderPayment.status).toBe(403)
    expect(unauthenticatedReport.status).toBe(401)
    expect(memberReport.status).toBe(403)
    expect(coachAttendance.status).toBe(200)
    expect(otherCoachAttendance.status).toBe(403)
    expect(coachCheckIn.status).toBe(200)
    expect(memberCheckIn.status).toBe(403)
    expect(managerReport.status).toBe(200)
    expect(await prisma.sessionAttendance.findFirstOrThrow({
      where: { classSessionId: session.id, registrationId: registration.id },
    })).toMatchObject({ markedById: coach.id })
  })
})
