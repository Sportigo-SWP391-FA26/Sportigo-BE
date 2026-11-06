import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import { createClassScenario, resetDatabase } from './fixtures.js'

describe.skipIf(!hasTestDatabase)('Flow 4: đánh giá bắt buộc theo buổi học', () => {
  let s: Awaited<ReturnType<typeof createClassScenario>>
  let metricId: number

  beforeAll(async () => {
    await resetDatabase()
    s = await createClassScenario()
    await prisma.classSession.update({ where: { id: s.sessions.expired.id }, data: { status: 'COMPLETED' } })
    await prisma.sessionAttendance.create({ data: { registrationId: s.registrations[0]!.id, classSessionId: s.sessions.expired.id, status: 'PRESENT', markedById: s.coach.id } })
    const metric = await prisma.assessmentMetricDefinition.create({ data: { sportId: s.sport.id, code: 'technique', name: 'Kỹ thuật', unit: 'điểm', minValue: 0, maxValue: 100, isRequired: true } })
    metricId = metric.id
  })
  afterAll(async () => prisma.$disconnect())

  const post = (body: Record<string, unknown>, auth = s.coach.auth) => request(app).post('/api/progress-assessments').set('Authorization', auth).send({ coachComment: 'Tiến bộ tốt', metricValues: [{ definitionId: metricId, value: 82 }], ...body })

  it('từ chối đánh giá không gắn buổi hoặc gắn đồng thời hai loại buổi', async () => {
    const missing = await post({ memberId: s.members[0]!.id })
    const dual = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id, privateCourseAttendanceId: 1 })
    expect(missing.status).toBe(400)
    expect(dual.status).toBe(400)
  })

  it('từ chối buổi chưa kết thúc và Member không có điểm danh hợp lệ', async () => {
    const future = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.future.id })
    const absent = await post({ memberId: s.members[1]!.id, classSessionId: s.sessions.expired.id })
    expect(future.status).toBe(400)
    expect(absent.status).toBe(400)
  })

  it('từ chối metric tự do, thiếu metric bắt buộc và ngoài giới hạn', async () => {
    const missing = await request(app).post('/api/progress-assessments').set('Authorization', s.coach.auth).send({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id, coachComment: 'Thiếu', metricValues: [] })
    const outside = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id, metricValues: [{ definitionId: metricId, value: 101 }] })
    expect(missing.status).toBe(400)
    expect(outside.status).toBe(400)
  })

  it('tạo đánh giá từ đúng buổi, tự suy ra context/ngày và lưu metric chuẩn', async () => {
    const response = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id, assessmentDate: '2000-01-01' })
    expect(response.status).toBe(400)
    const valid = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id })
    expect(valid.status).toBe(201)
    expect(valid.body.context.type).toBe('GROUP_CLASS')
    expect(valid.body.session.id).toBe(s.sessions.expired.id)
    expect(valid.body.metricValues[0]).toMatchObject({ definitionId: metricId, name: 'Kỹ thuật' })
  })

  it('retry cùng Member/buổi không tạo đánh giá trùng', async () => {
    const response = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id })
    expect([400, 409]).toContain(response.status)
    expect(await prisma.progressAssessment.count({ where: { memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id } })).toBe(1)
  })

  it('Member không được tạo đánh giá và chỉ Coach/Manager xem đúng phạm vi', async () => {
    const forbidden = await post({ memberId: s.members[0]!.id, classSessionId: s.sessions.expired.id }, s.members[0]!.auth)
    expect(forbidden.status).toBe(403)
    const coachList = await request(app).get('/api/progress-assessments').set('Authorization', s.coach.auth)
    const managerList = await request(app).get('/api/progress-assessments').set('Authorization', s.manager.auth)
    expect(coachList.status).toBe(200)
    expect(managerList.body.total).toBeGreaterThanOrEqual(1)
  })
})
