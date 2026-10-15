import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  createCoach,
  createEnrollment,
  createManager,
  createMember,
  createPrivateCourse,
  createSport,
  createWorkoutPlan,
  resetDatabase,
} from './fixtures.js'

const BR44 = 'Giáo án không cùng môn hoặc chưa được kích hoạt.'

describe.skipIf(!hasTestDatabase)('FR-51 Gán giáo án cho khóa 1-1', () => {
  let sportId: number
  let otherSportId: number
  let courseId: number
  let coach: Awaited<ReturnType<typeof createCoach>>
  let otherCoach: Awaited<ReturnType<typeof createCoach>>
  let manager: Awaited<ReturnType<typeof createManager>>
  let member: Awaited<ReturnType<typeof createMember>>
  let otherMember: Awaited<ReturnType<typeof createMember>>

  beforeAll(async () => {
    await resetDatabase()
    sportId = (await createSport()).id
    otherSportId = (await createSport()).id
    courseId = (await createPrivateCourse({ sportId })).id
    coach = await createCoach()
    otherCoach = await createCoach()
    manager = await createManager()
    member = await createMember()
    otherMember = await createMember()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const newEnrollment = (status: 'ACTIVE' | 'PENDING_PAYMENT' = 'ACTIVE') =>
    createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: courseId,
      status,
    })

  const newPlan = (
    options: { sport?: number; status?: 'ACTIVE' | 'DRAFT' } = {},
  ) =>
    createWorkoutPlan({
      sportId: options.sport ?? sportId,
      createdById: otherCoach.id,
      status: options.status ?? 'ACTIVE',
    })

  const assign = (
    enrollmentId: number,
    workoutPlanId: number,
    auth = coach.auth,
  ) =>
    request(app)
      .post(`/api/private-enrollments/${enrollmentId}/plans`)
      .set('Authorization', auth)
      .send({ workoutPlanId })

  it('FR-51 / BR-44: Coach phụ trách gán giáo án ACTIVE đúng môn', async () => {
    const enrollment = await newEnrollment()
    const plan = await newPlan()
    const response = await assign(enrollment.id, plan.id)

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('ACTIVE')
    expect(response.body.workoutPlan.id).toBe(plan.id)
    expect(response.body.assignedBy.id).toBe(coach.id)
    expect(response.body.assignedAt).toBeDefined()
  })

  it('FR-51 / BR-44: gán giáo án sai môn trả 422', async () => {
    const enrollment = await newEnrollment()
    const plan = await newPlan({ sport: otherSportId })
    const response = await assign(enrollment.id, plan.id)

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('PLAN_NOT_ASSIGNABLE')
    expect(response.body.message).toBe(BR44)
  })

  it('FR-51 / BR-44: gán giáo án chưa ACTIVE trả 422', async () => {
    const enrollment = await newEnrollment()
    const plan = await newPlan({ status: 'DRAFT' })
    const response = await assign(enrollment.id, plan.id)

    expect(response.status).toBe(422)
    expect(response.body.message).toBe(BR44)
  })

  it('FR-51: Coach không phụ trách enrollment bị 403', async () => {
    const enrollment = await newEnrollment()
    const plan = await newPlan()
    const response = await assign(enrollment.id, plan.id, otherCoach.auth)

    expect(response.status).toBe(403)
  })

  it('FR-51: gán trùng giáo án đang hoạt động trả 409', async () => {
    const enrollment = await newEnrollment()
    const plan = await newPlan()
    await assign(enrollment.id, plan.id)
    const duplicate = await assign(enrollment.id, plan.id)

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('PLAN_ALREADY_ASSIGNED')
  })

  it('FR-51: một khóa 1-1 có thể có nhiều giáo án cùng lúc', async () => {
    const enrollment = await newEnrollment()
    const first = await assign(enrollment.id, (await newPlan()).id)
    const second = await assign(enrollment.id, (await newPlan()).id)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const list = await request(app)
      .get(`/api/private-enrollments/${enrollment.id}/plans`)
      .set('Authorization', coach.auth)
    expect(list.body).toHaveLength(2)
  })

  it('FR-51: gán lại giáo án đã kết thúc thì kích hoạt lại bản ghi cũ', async () => {
    const enrollment = await newEnrollment()
    const plan = await newPlan()
    const first = await assign(enrollment.id, plan.id)
    await prisma.planPrivateEnrollment.update({
      where: { id: first.body.id },
      data: { status: 'COMPLETED' },
    })
    const again = await assign(enrollment.id, plan.id)

    expect(again.status).toBe(201)
    expect(again.body.id).toBe(first.body.id)
    expect(again.body.status).toBe('ACTIVE')
  })

  it('FR-51: enrollment chưa ACTIVE trả 409', async () => {
    const enrollment = await newEnrollment('PENDING_PAYMENT')
    const response = await assign(enrollment.id, (await newPlan()).id)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ENROLLMENT_NOT_ACTIVE')
  })

  it('FR-51: enrollment hoặc giáo án không tồn tại trả 404', async () => {
    const enrollment = await newEnrollment()
    const noEnrollment = await assign(999_999, (await newPlan()).id)
    const noPlan = await assign(enrollment.id, 999_999)

    expect(noEnrollment.status).toBe(404)
    expect(noPlan.status).toBe(404)
  })

  it('FR-51: Member chủ enrollment và Manager được xem; Member khác bị 403', async () => {
    const enrollment = await newEnrollment()
    await assign(enrollment.id, (await newPlan()).id)
    const url = `/api/private-enrollments/${enrollment.id}/plans`

    const asOwner = await request(app)
      .get(url)
      .set('Authorization', member.auth)
    const asManager = await request(app)
      .get(url)
      .set('Authorization', manager.auth)
    const asOtherMember = await request(app)
      .get(url)
      .set('Authorization', otherMember.auth)

    expect(asOwner.status).toBe(200)
    expect(asOwner.body).toHaveLength(1)
    expect(asManager.status).toBe(200)
    expect(asOtherMember.status).toBe(403)
  })
})
