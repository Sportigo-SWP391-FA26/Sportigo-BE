import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import {
  DAY,
  createCoach,
  createEnrollment,
  createMember,
  createPrivateCourse,
  createSport,
  createWorkoutPlan,
  resetDatabase,
} from './fixtures.js'

type TrainingResponse = {
  planAssignments: {
    id: number
    status: string
    workoutPlan: { id: number; items: { itemOrder: number }[] }
    enrollment: { id: number }
  }[]
  assessments: {
    id: number
    assessmentDate: string
    member: { id: number }
    context: { type: string }
  }[]
}

describe.skipIf(!hasTestDatabase)('FR-53 Giáo án & tiến độ của tôi', () => {
  let coach: Awaited<ReturnType<typeof createCoach>>
  let memberA: Awaited<ReturnType<typeof createMember>>
  let memberB: Awaited<ReturnType<typeof createMember>>
  const ids = {
    activeAssignment: 0,
    cancelledAssignment: 0,
    assignmentOfB: 0,
    olderAssessment: 0,
    newerAssessment: 0,
    assessmentOfB: 0,
  }

  beforeAll(async () => {
    await resetDatabase()
    const sport = await createSport()
    const course = await createPrivateCourse({ sportId: sport.id })
    coach = await createCoach()
    memberA = await createMember()
    memberB = await createMember()

    const enrollmentA = await createEnrollment({
      memberId: memberA.id,
      coachId: coach.id,
      privateCourseId: course.id,
    })
    const enrollmentB = await createEnrollment({
      memberId: memberB.id,
      coachId: coach.id,
      privateCourseId: course.id,
    })
    const planOptions = {
      sportId: sport.id,
      createdById: coach.id,
      itemCount: 3,
    }
    const [planA, planCancelled, planB] = [
      await createWorkoutPlan(planOptions),
      await createWorkoutPlan(planOptions),
      await createWorkoutPlan(planOptions),
    ]

    const assign = (
      enrollmentId: number,
      workoutPlanId: number,
      status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
    ) =>
      prisma.planPrivateEnrollment.create({
        data: { enrollmentId, workoutPlanId, assignedById: coach.id, status },
      })
    ids.activeAssignment = (await assign(enrollmentA.id, planA.id)).id
    ids.cancelledAssignment = (
      await assign(enrollmentA.id, planCancelled.id, 'CANCELLED')
    ).id
    ids.assignmentOfB = (await assign(enrollmentB.id, planB.id)).id

    const assess = (memberId: number, enrollmentId: number, daysAgo: number) =>
      prisma.progressAssessment.create({
        data: {
          memberId,
          coachId: coach.id,
          privateEnrollmentId: enrollmentId,
          assessmentDate: new Date(Date.now() - daysAgo * DAY),
          coachComment: 'Nhận xét',
          metrics: { speed: 6 },
        },
      })
    ids.olderAssessment = (await assess(memberA.id, enrollmentA.id, 10)).id
    ids.newerAssessment = (await assess(memberA.id, enrollmentA.id, 2)).id
    ids.assessmentOfB = (await assess(memberB.id, enrollmentB.id, 1)).id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const getTraining = (auth: string, query: Record<string, number> = {}) =>
    request(app)
      .get('/api/members/me/training')
      .query(query)
      .set('Authorization', auth)

  it('FR-53: Member xem giáo án được gán và đánh giá của mình, mới nhất trước', async () => {
    const response = await getTraining(memberA.auth)
    const body: TrainingResponse = response.body

    expect(response.status).toBe(200)
    expect(body.planAssignments.map((a) => a.id)).toEqual([
      ids.activeAssignment,
    ])
    expect(
      body.planAssignments[0]!.workoutPlan.items.map((item) => item.itemOrder),
    ).toEqual([1, 2, 3])
    expect(body.assessments.map((a) => a.id)).toEqual([
      ids.newerAssessment,
      ids.olderAssessment,
    ])
    expect(body.assessments[0]!.context.type).toBe('PRIVATE_COURSE')
  })

  it('FR-53: giáo án đã hủy gán không hiển thị', async () => {
    const body: TrainingResponse = (await getTraining(memberA.auth)).body

    expect(body.planAssignments.map((a) => a.id)).not.toContain(
      ids.cancelledAssignment,
    )
  })

  it('FR-53: Member không thấy dữ liệu của Member khác', async () => {
    const bodyA: TrainingResponse = (await getTraining(memberA.auth)).body
    const bodyB: TrainingResponse = (await getTraining(memberB.auth)).body

    expect(bodyA.planAssignments.map((a) => a.id)).not.toContain(
      ids.assignmentOfB,
    )
    expect(bodyA.assessments.map((a) => a.id)).not.toContain(ids.assessmentOfB)
    expect(bodyB.assessments.every((a) => a.member.id === memberB.id)).toBe(
      true,
    )
    expect(bodyB.planAssignments.map((a) => a.id)).toEqual([ids.assignmentOfB])
  })

  it('FR-53: gửi memberId của người khác vẫn chỉ nhận dữ liệu của mình', async () => {
    const response = await getTraining(memberA.auth, { memberId: memberB.id })
    const body: TrainingResponse = response.body

    expect(response.status).toBe(200)
    expect(body.assessments.every((a) => a.member.id === memberA.id)).toBe(true)
  })

  it('FR-53 / BR-06: role khác Member bị 403', async () => {
    const response = await getTraining(coach.auth)

    expect(response.status).toBe(403)
  })

  it('FR-53: chỉ đọc, không có endpoint sửa cho Member', async () => {
    const response = await request(app)
      .patch('/api/members/me/training')
      .set('Authorization', memberA.auth)
      .send({ assessments: [] })

    expect(response.status).toBe(404)
  })
})
