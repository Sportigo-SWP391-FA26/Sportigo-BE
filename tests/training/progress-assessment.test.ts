import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  DAY,
  createClassScenario,
  createEnrollment,
  createPrivateCourse,
  resetDatabase,
} from './fixtures.js'

const BR46 =
  'Coach không phụ trách học viên hoặc ngữ cảnh đánh giá không hợp lệ.'

const centerDate = (offsetMs = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(Date.now() + offsetMs),
  )

describe.skipIf(!hasTestDatabase)('FR-52 Đánh giá tiến độ', () => {
  let s: Awaited<ReturnType<typeof createClassScenario>>
  let enrollmentId: number
  let otherCoachEnrollmentId: number

  beforeAll(async () => {
    await resetDatabase()
    s = await createClassScenario()
    const course = await createPrivateCourse({ sportId: s.sport.id })
    enrollmentId = (
      await createEnrollment({
        memberId: s.members[0]!.id,
        coachId: s.coach.id,
        privateCourseId: course.id,
      })
    ).id
    otherCoachEnrollmentId = (
      await createEnrollment({
        memberId: s.members[1]!.id,
        coachId: s.otherCoach.id,
        privateCourseId: course.id,
      })
    ).id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const baseBody = () => ({
    assessmentDate: centerDate(),
    coachComment: 'Tiến bộ tốt',
    metrics: { speed: 7, technique: 8 },
  })

  const create = (body: Record<string, unknown>, auth = s.coach.auth) =>
    request(app)
      .post('/api/progress-assessments')
      .set('Authorization', auth)
      .send({ ...baseBody(), ...body })

  it('FR-52 / BR-46: Coach đánh giá học viên trong lớp mình phụ trách', async () => {
    const response = await create({
      memberId: s.members[0]!.id,
      classRegistrationId: s.registrations[0]!.id,
      score: 8.5,
    })

    expect(response.status).toBe(201)
    expect(response.body.context.type).toBe('GROUP_CLASS')
    expect(response.body.context.class.id).toBe(s.groupClass.id)
    expect(response.body.coach.id).toBe(s.coach.id)
    expect(response.body.assessmentDate).toBe(centerDate())
    expect(response.body.metrics).toEqual({ speed: 7, technique: 8 })
  })

  it('FR-52 / BR-46: Coach đánh giá học viên khóa 1-1 mình phụ trách', async () => {
    const response = await create({
      memberId: s.members[0]!.id,
      privateEnrollmentId: enrollmentId,
    })

    expect(response.status).toBe(201)
    expect(response.body.context.type).toBe('PRIVATE_COURSE')
    expect(response.body.context.privateEnrollmentId).toBe(enrollmentId)
  })

  it('FR-52 / BR-46: học viên lớp của Coach khác bị từ chối 403', async () => {
    const response = await create({
      memberId: s.outsider.id,
      classRegistrationId: s.outsiderRegistration.id,
    })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ASSESSMENT_CONTEXT_INVALID')
    expect(response.body.message).toBe(BR46)
  })

  it('FR-52 / BR-46: khóa 1-1 của Coach khác bị từ chối 403', async () => {
    const response = await create({
      memberId: s.members[1]!.id,
      privateEnrollmentId: otherCoachEnrollmentId,
    })

    expect(response.status).toBe(403)
    expect(response.body.message).toBe(BR46)
  })

  it('FR-52 / BR-46: ngữ cảnh không thuộc memberId gửi lên bị từ chối 403', async () => {
    const response = await create({
      memberId: s.members[2]!.id,
      classRegistrationId: s.registrations[0]!.id,
    })

    expect(response.status).toBe(403)
  })

  it('FR-52 / BR-46: registration chưa CONFIRMED bị từ chối 403', async () => {
    const response = await create({
      memberId: s.pendingMember.id,
      classRegistrationId: s.pendingRegistration.id,
    })

    expect(response.status).toBe(403)
  })

  it('FR-52 / BR-46: có cả hai ngữ cảnh trả 422', async () => {
    const response = await create({
      memberId: s.members[0]!.id,
      classRegistrationId: s.registrations[0]!.id,
      privateEnrollmentId: enrollmentId,
    })

    expect(response.status).toBe(400)
    expect(response.body.details.fieldErrors.classRegistrationId).toBeDefined()
  })

  it('FR-52 / BR-46: thiếu cả hai ngữ cảnh trả 422', async () => {
    const response = await create({ memberId: s.members[0]!.id })

    expect(response.status).toBe(400)
  })

  it('FR-52: ngày đánh giá ở tương lai trả 422', async () => {
    const response = await create({
      memberId: s.members[0]!.id,
      privateEnrollmentId: enrollmentId,
      assessmentDate: centerDate(2 * DAY),
    })

    expect(response.status).toBe(400)
    expect(response.body.details.fieldErrors.assessmentDate).toBeDefined()
  })

  it('FR-52: metrics phải là object số và không rỗng', async () => {
    const notNumber = await create({
      memberId: s.members[0]!.id,
      privateEnrollmentId: enrollmentId,
      metrics: { speed: 'nhanh' },
    })
    const empty = await create({
      memberId: s.members[0]!.id,
      privateEnrollmentId: enrollmentId,
      metrics: {},
    })

    expect(notNumber.status).toBe(400)
    expect(empty.status).toBe(400)
  })

  it('FR-52 / BR-06: Member không được tạo đánh giá', async () => {
    const response = await create(
      {
        memberId: s.members[0]!.id,
        privateEnrollmentId: enrollmentId,
      },
      s.members[0]!.auth,
    )

    expect(response.status).toBe(403)
  })

  it('FR-52: Coach chỉ thấy đánh giá của mình, Manager thấy tất cả và lọc theo Member', async () => {
    await prisma.progressAssessment.create({
      data: {
        memberId: s.members[1]!.id,
        coachId: s.otherCoach.id,
        privateEnrollmentId: otherCoachEnrollmentId,
        assessmentDate: new Date(),
        coachComment: 'Đánh giá của Coach khác',
        metrics: { speed: 5 },
      },
    })

    const asCoach = await request(app)
      .get('/api/progress-assessments')
      .set('Authorization', s.coach.auth)
    const asManager = await request(app)
      .get('/api/progress-assessments')
      .query({ memberId: s.members[1]!.id })
      .set('Authorization', s.manager.auth)

    expect(asCoach.status).toBe(200)
    expect(
      asCoach.body.items.every(
        (item: { coach: { id: number } }) => item.coach.id === s.coach.id,
      ),
    ).toBe(true)
    expect(asManager.body.total).toBe(1)
    expect(asManager.body.items[0].coach.id).toBe(s.otherCoach.id)
  })
})
