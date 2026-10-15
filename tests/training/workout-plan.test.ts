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

describe.skipIf(!hasTestDatabase)('FR-49 Giáo án dùng chung theo môn', () => {
  let sport: Awaited<ReturnType<typeof createSport>>
  let otherSport: Awaited<ReturnType<typeof createSport>>
  let inactiveSport: Awaited<ReturnType<typeof createSport>>
  let coach: Awaited<ReturnType<typeof createCoach>>
  let otherCoach: Awaited<ReturnType<typeof createCoach>>
  let manager: Awaited<ReturnType<typeof createManager>>
  let member: Awaited<ReturnType<typeof createMember>>

  beforeAll(async () => {
    await resetDatabase()
    sport = await createSport()
    otherSport = await createSport()
    inactiveSport = await createSport(false)
    coach = await createCoach()
    otherCoach = await createCoach()
    manager = await createManager()
    member = await createMember()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const validPlan = () => ({
    sportId: sport.id,
    name: 'Bơi ếch nền tảng',
    level: 'BEGINNER',
    durationWeeks: 4,
  })

  it('FR-49: Coach tạo giáo án theo môn, trạng thái khởi tạo DRAFT', async () => {
    const response = await request(app)
      .post('/api/workout-plans')
      .set('Authorization', coach.auth)
      .send(validPlan())

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('DRAFT')
    expect(response.body.sport.id).toBe(sport.id)
    expect(response.body.createdBy.id).toBe(coach.id)
  })

  it('FR-49: thiếu môn trả 422', async () => {
    const withoutSport: Record<string, unknown> = validPlan()
    delete withoutSport.sportId
    const response = await request(app)
      .post('/api/workout-plans')
      .set('Authorization', coach.auth)
      .send(withoutSport)

    expect(response.status).toBe(422)
    expect(response.body.details.fieldErrors.sportId).toBeDefined()
  })

  it('FR-49: môn ngừng hoạt động hoặc không tồn tại trả 422', async () => {
    const inactive = await request(app)
      .post('/api/workout-plans')
      .set('Authorization', coach.auth)
      .send({ ...validPlan(), sportId: inactiveSport.id })
    const missing = await request(app)
      .post('/api/workout-plans')
      .set('Authorization', coach.auth)
      .send({ ...validPlan(), sportId: 999_999 })

    expect(inactive.status).toBe(422)
    expect(inactive.body.code).toBe('SPORT_NOT_AVAILABLE')
    expect(missing.status).toBe(422)
  })

  it('FR-49 / BR-06: chỉ Coach được tạo giáo án', async () => {
    const response = await request(app)
      .post('/api/workout-plans')
      .set('Authorization', manager.auth)
      .send(validPlan())

    expect(response.status).toBe(403)
  })

  it('FR-49: kích hoạt giáo án đã có mục', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
      status: 'DRAFT',
    })
    const response = await request(app)
      .patch(`/api/workout-plans/${plan.id}/status`)
      .set('Authorization', coach.auth)
      .send({ status: 'ACTIVE' })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ACTIVE')
  })

  it('FR-49: không kích hoạt giáo án chưa có mục', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
      status: 'DRAFT',
      itemCount: 0,
    })
    const response = await request(app)
      .patch(`/api/workout-plans/${plan.id}/status`)
      .set('Authorization', coach.auth)
      .send({ status: 'ACTIVE' })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('PLAN_HAS_NO_ITEMS')
  })

  it('FR-49: Coach khác được cập nhật giáo án dùng chung', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
    })
    const response = await request(app)
      .patch(`/api/workout-plans/${plan.id}`)
      .set('Authorization', otherCoach.auth)
      .send({ name: 'Tên mới', level: 'ADVANCED' })

    expect(response.status).toBe(200)
    expect(response.body.name).toBe('Tên mới')
    expect(response.body.level).toBe('ADVANCED')
  })

  it('FR-49 / BR-44: không đổi môn của giáo án đã được gán', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
    })
    const course = await createPrivateCourse({ sportId: sport.id })
    const enrollment = await createEnrollment({
      memberId: member.id,
      coachId: coach.id,
      privateCourseId: course.id,
    })
    await prisma.planPrivateEnrollment.create({
      data: {
        enrollmentId: enrollment.id,
        workoutPlanId: plan.id,
        assignedById: coach.id,
      },
    })

    const response = await request(app)
      .patch(`/api/workout-plans/${plan.id}`)
      .set('Authorization', coach.auth)
      .send({ sportId: otherSport.id })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PLAN_SPORT_LOCKED')
  })

  it('FR-49: đổi môn được khi giáo án chưa từng được gán', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
    })
    const response = await request(app)
      .patch(`/api/workout-plans/${plan.id}`)
      .set('Authorization', coach.auth)
      .send({ sportId: otherSport.id })

    expect(response.status).toBe(200)
    expect(response.body.sport.id).toBe(otherSport.id)
  })

  it('FR-49: không giảm thời lượng nhỏ hơn tuần của mục hiện có', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
      itemCount: 0,
    })
    await prisma.workoutPlanItem.create({
      data: {
        workoutPlanId: plan.id,
        weekNumber: 3,
        sessionNumber: 1,
        itemOrder: 1,
        title: 'Bài tuần 3',
        content: 'Nội dung',
      },
    })
    const response = await request(app)
      .patch(`/api/workout-plans/${plan.id}`)
      .set('Authorization', coach.auth)
      .send({ durationWeeks: 2 })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('DURATION_TOO_SHORT')
  })

  it('FR-49: xóa là chuyển INACTIVE, không xóa cứng', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
    })
    const response = await request(app)
      .delete(`/api/workout-plans/${plan.id}`)
      .set('Authorization', coach.auth)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('INACTIVE')
    const stored = await prisma.workoutPlan.findUnique({
      where: { id: plan.id },
    })
    expect(stored?.status).toBe('INACTIVE')
  })

  it('FR-49: chi tiết kèm các mục sắp theo tuần → buổi → thứ tự', async () => {
    const plan = await createWorkoutPlan({
      sportId: sport.id,
      createdById: coach.id,
      itemCount: 0,
    })
    const positions = [
      [2, 1, 1],
      [1, 2, 1],
      [1, 1, 2],
      [1, 1, 1],
    ]
    for (const [weekNumber, sessionNumber, itemOrder] of positions) {
      await prisma.workoutPlanItem.create({
        data: {
          workoutPlanId: plan.id,
          weekNumber: weekNumber!,
          sessionNumber: sessionNumber!,
          itemOrder: itemOrder!,
          title: `W${weekNumber}S${sessionNumber}O${itemOrder}`,
          content: 'Nội dung',
        },
      })
    }

    const response = await request(app)
      .get(`/api/workout-plans/${plan.id}`)
      .set('Authorization', manager.auth)

    expect(response.status).toBe(200)
    expect(
      response.body.items.map((item: { title: string }) => item.title),
    ).toEqual(['W1S1O1', 'W1S1O2', 'W1S2O1', 'W2S1O1'])
  })

  it('FR-49: lọc theo môn, cấp độ, trạng thái và tìm theo tên', async () => {
    await createWorkoutPlan({ sportId: otherSport.id, createdById: coach.id })
    await request(app)
      .post('/api/workout-plans')
      .set('Authorization', coach.auth)
      .send({ ...validPlan(), name: 'Giáo án Bơi Sải Đặc Biệt' })

    const bySport = await request(app)
      .get('/api/workout-plans')
      .query({ sportId: otherSport.id })
      .set('Authorization', manager.auth)
    const bySearch = await request(app)
      .get('/api/workout-plans')
      .query({ search: 'sải đặc biệt', status: 'DRAFT', level: 'BEGINNER' })
      .set('Authorization', coach.auth)

    expect(bySport.status).toBe(200)
    expect(
      bySport.body.items.every(
        (plan: { sport: { id: number } }) => plan.sport.id === otherSport.id,
      ),
    ).toBe(true)
    expect(bySearch.body.total).toBe(1)
    expect(bySearch.body.items[0].name).toBe('Giáo án Bơi Sải Đặc Biệt')
  })

  it('FR-49 / BR-06: Member không xem được danh sách giáo án', async () => {
    const response = await request(app)
      .get('/api/workout-plans')
      .set('Authorization', member.auth)

    expect(response.status).toBe(403)
  })

  it('FR-49: giáo án không tồn tại trả 404', async () => {
    const response = await request(app)
      .get('/api/workout-plans/999999')
      .set('Authorization', coach.auth)

    expect(response.status).toBe(404)
  })
})
