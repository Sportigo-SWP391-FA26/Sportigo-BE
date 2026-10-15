import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/lib/prisma.js'
import { hasTestDatabase } from '../support/test-database.js'
import { createClassScenario, resetDatabase } from './fixtures.js'

const BR42 = 'Học viên chưa đăng ký hợp lệ cho buổi học này.'
const BR43 = 'Bản ghi điểm danh không hợp lệ hoặc buổi học đã khóa dữ liệu.'

describe.skipIf(!hasTestDatabase)('FR-47 Điểm danh buổi học', () => {
  let s: Awaited<ReturnType<typeof createClassScenario>>

  beforeAll(async () => {
    await resetDatabase()
    s = await createClassScenario()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const attendanceUrl = (sessionId: number) =>
    `/api/class-sessions/${sessionId}/attendance`

  it('FR-47: Coach phụ trách điểm danh đủ 4 trạng thái PRESENT/ABSENT/LATE/EXCUSED', async () => {
    const statuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const
    const response = await request(app)
      .put(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.coach.auth)
      .send({
        records: s.registrations.map((registration, index) => ({
          classRegistrationId: registration.id,
          status: statuses[index],
          note: index === 3 ? 'Có giấy phép' : undefined,
        })),
      })

    expect(response.status).toBe(200)
    expect(response.body.records).toHaveLength(4)
    expect(
      response.body.records.map((r: { status: string }) => r.status),
    ).toEqual([...statuses])
    expect(response.body.records[0].markedById).toBe(s.coach.id)
  })

  it('FR-47 / BR-43: ghi lặp lần 2 cập nhật bản ghi cũ, không tạo bản ghi mới', async () => {
    const sessionId = s.sessions.ongoing.id
    const registrationId = s.registrations[0]!.id
    const mark = (status: string) =>
      request(app)
        .put(attendanceUrl(sessionId))
        .set('Authorization', s.coach.auth)
        .send({ records: [{ classRegistrationId: registrationId, status }] })

    const first = await mark('ABSENT')
    const second = await mark('LATE')

    expect(second.status).toBe(200)
    expect(second.body.records[0].id).toBe(first.body.records[0].id)
    expect(second.body.records[0].status).toBe('LATE')
    const count = await prisma.sessionAttendance.count({
      where: { registrationId, classSessionId: sessionId },
    })
    expect(count).toBe(1)
  })

  it('FR-47 / BR-42: từ chối học viên chưa CONFIRMED và rollback cả request', async () => {
    const sessionId = s.sessions.ongoing.id
    const validRegistrationId = s.registrations[1]!.id
    const before = await prisma.sessionAttendance.findUnique({
      where: {
        registrationId_classSessionId: {
          registrationId: validRegistrationId,
          classSessionId: sessionId,
        },
      },
    })

    const response = await request(app)
      .put(attendanceUrl(sessionId))
      .set('Authorization', s.coach.auth)
      .send({
        records: [
          { classRegistrationId: validRegistrationId, status: 'EXCUSED' },
          { classRegistrationId: s.pendingRegistration.id, status: 'PRESENT' },
        ],
      })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('REGISTRATION_NOT_ELIGIBLE')
    expect(response.body.message).toBe(BR42)
    expect(response.body.details.invalidRegistrationIds).toEqual([
      s.pendingRegistration.id,
    ])
    const after = await prisma.sessionAttendance.findUnique({
      where: {
        registrationId_classSessionId: {
          registrationId: validRegistrationId,
          classSessionId: sessionId,
        },
      },
    })
    expect(after?.status).toBe(before?.status)
  })

  it('FR-47 / BR-42: từ chối registration thuộc lớp khác', async () => {
    const response = await request(app)
      .put(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.coach.auth)
      .send({
        records: [
          { classRegistrationId: s.outsiderRegistration.id, status: 'PRESENT' },
        ],
      })

    expect(response.status).toBe(422)
    expect(response.body.message).toBe(BR42)
  })

  it('FR-47: Coach không phụ trách lớp bị từ chối 403', async () => {
    const response = await request(app)
      .put(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.otherCoach.auth)
      .send({
        records: [
          { classRegistrationId: s.registrations[0]!.id, status: 'PRESENT' },
        ],
      })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN')
  })

  it('FR-47 / BR-06: role khác Coach không được điểm danh', async () => {
    const response = await request(app)
      .put(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.manager.auth)
      .send({
        records: [
          { classRegistrationId: s.registrations[0]!.id, status: 'PRESENT' },
        ],
      })

    expect(response.status).toBe(403)
  })

  it('FR-47: chưa đăng nhập trả 401', async () => {
    const response = await request(app)
      .put(attendanceUrl(s.sessions.ongoing.id))
      .send({ records: [] })

    expect(response.status).toBe(401)
  })

  it.each([
    ['chưa tới giờ bắt đầu', 'future'],
    ['đã quá hạn sửa điểm danh', 'expired'],
    ['đã bị hủy', 'cancelled'],
  ] as const)(
    'FR-47 / BR-43: buổi học %s trả 409 khóa dữ liệu',
    async (_label, key) => {
      const response = await request(app)
        .put(attendanceUrl(s.sessions[key].id))
        .set('Authorization', s.coach.auth)
        .send({
          records: [
            { classRegistrationId: s.registrations[0]!.id, status: 'PRESENT' },
          ],
        })

      expect(response.status).toBe(409)
      expect(response.body.code).toBe('ATTENDANCE_LOCKED')
      expect(response.body.message).toBe(BR43)
    },
  )

  it('FR-47: buổi học không tồn tại trả 404', async () => {
    const response = await request(app)
      .put(attendanceUrl(999_999))
      .set('Authorization', s.coach.auth)
      .send({
        records: [
          { classRegistrationId: s.registrations[0]!.id, status: 'PRESENT' },
        ],
      })

    expect(response.status).toBe(404)
  })

  it('FR-47: từ chối classRegistrationId lặp trong cùng request (422)', async () => {
    const id = s.registrations[0]!.id
    const response = await request(app)
      .put(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.coach.auth)
      .send({
        records: [
          { classRegistrationId: id, status: 'PRESENT' },
          { classRegistrationId: id, status: 'ABSENT' },
        ],
      })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })

  it('FR-47: GET trả học viên CONFIRMED kèm trạng thái, null nếu chưa điểm danh', async () => {
    const response = await request(app)
      .get(attendanceUrl(s.sessions.future.id))
      .set('Authorization', s.coach.auth)

    expect(response.status).toBe(200)
    expect(response.body.isLocked).toBe(true)
    const ids = response.body.students.map(
      (student: { registrationId: number }) => student.registrationId,
    )
    expect(ids).toEqual(s.registrations.map((r) => r.id))
    expect(ids).not.toContain(s.pendingRegistration.id)
    expect(
      response.body.students.every(
        (student: { attendance: unknown }) => student.attendance === null,
      ),
    ).toBe(true)
  })

  it('FR-47: GET cho Manager xem, Coach khác bị 403', async () => {
    const asManager = await request(app)
      .get(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.manager.auth)
    const asOtherCoach = await request(app)
      .get(attendanceUrl(s.sessions.ongoing.id))
      .set('Authorization', s.otherCoach.auth)

    expect(asManager.status).toBe(200)
    expect(asManager.body.students[0].attendance).not.toBeNull()
    expect(asOtherCoach.status).toBe(403)
  })
})
