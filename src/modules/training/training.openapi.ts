import { z } from 'zod'
import { FORBIDDEN_MESSAGE } from '../../middleware/auth.js'
import { markAttendanceSchema } from './attendance.schema.js'
import { BR_MESSAGES } from './training.common.js'

// Request body sinh từ schema Zod để tài liệu luôn khớp với validate thật.
function jsonBody(schema: z.ZodType, example: unknown) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: z.toJSONSchema(schema, { target: 'openapi-3.0' }),
        example,
      },
    },
  }
}

function ok(description: string, example: unknown) {
  return { description, content: { 'application/json': { example } } }
}

const errorSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    details: {},
  },
}

function error(
  description: string,
  example?: { code: string; message: string; details?: unknown },
) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema, example } },
  }
}

function pathId(description: string, name = 'id') {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'integer', minimum: 1 },
    description,
  }
}

function queryParam(name: string, schema: object, description: string) {
  return { name, in: 'query', required: false, schema, description }
}

const integerId = { type: 'integer', minimum: 1 }

const pageParams = [
  queryParam('page', { type: 'integer', minimum: 1, default: 1 }, 'Trang'),
  queryParam(
    'pageSize',
    { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    'Số bản ghi mỗi trang (tối đa 100)',
  ),
]

const security = [{ bearerAuth: [] }]

const authErrors = {
  '401': error('Chưa đăng nhập hoặc token không hợp lệ', {
    code: 'UNAUTHENTICATED',
    message: 'Bạn cần đăng nhập để tiếp tục',
  }),
  '403': error('Sai role hoặc không phụ trách dữ liệu (BR-06)', {
    code: 'FORBIDDEN',
    message: FORBIDDEN_MESSAGE,
  }),
}

const validationError = error('Dữ liệu không hợp lệ, lỗi theo từng trường', {
  code: 'VALIDATION_ERROR',
  message: 'Dữ liệu không hợp lệ',
  details: { formErrors: [], fieldErrors: { records: ['...'] } },
})

const memberExample = {
  id: 12,
  memberCode: 'MEM-000012',
  displayName: 'Trần Thị Bình',
}

export const trainingPaths = {
  '/class-sessions/{id}/attendance': {
    get: {
      tags: ['Training – Điểm danh'],
      summary: 'FR-47: Học viên CONFIRMED của buổi kèm trạng thái điểm danh',
      description:
        'Coach phụ trách lớp hoặc Center Manager. attendance = null nếu chưa điểm danh.',
      security,
      parameters: [pathId('ID buổi học (ClassSession)')],
      responses: {
        '200': ok('Danh sách điểm danh của buổi', {
          session: {
            id: 5,
            startsAt: '2026-10-12T01:00:00.000Z',
            endsAt: '2026-10-12T02:30:00.000Z',
            status: 'SCHEDULED',
            class: { id: 2, name: 'Bơi cơ bản K12' },
          },
          isLocked: false,
          students: [
            {
              registrationId: 31,
              member: memberExample,
              attendance: {
                id: 90,
                registrationId: 31,
                classSessionId: 5,
                status: 'PRESENT',
                note: null,
                checkedAt: '2026-10-12T01:05:00.000Z',
                markedById: 4,
                updatedAt: '2026-10-12T01:05:00.000Z',
              },
            },
            { registrationId: 32, member: memberExample, attendance: null },
          ],
        }),
        ...authErrors,
        '404': error('Không tìm thấy buổi học'),
        '422': validationError,
      },
    },
    put: {
      tags: ['Training – Điểm danh'],
      summary: 'FR-47: Coach điểm danh hàng loạt cho một buổi học',
      description:
        'Chỉ Coach phụ trách lớp. Upsert theo cặp registration–session (BR-43), ' +
        'chỉ nhận registration CONFIRMED của đúng lớp (BR-42). Toàn bộ chạy trong một transaction.',
      security,
      parameters: [pathId('ID buổi học (ClassSession)')],
      requestBody: jsonBody(markAttendanceSchema, {
        records: [
          { classRegistrationId: 31, status: 'PRESENT' },
          { classRegistrationId: 32, status: 'LATE', note: 'Đến muộn 10 phút' },
        ],
      }),
      responses: {
        '200': ok('Đã lưu điểm danh', {
          sessionId: 5,
          records: [
            {
              id: 90,
              registrationId: 31,
              classSessionId: 5,
              status: 'PRESENT',
              note: null,
              checkedAt: '2026-10-12T01:05:00.000Z',
              markedById: 4,
              updatedAt: '2026-10-12T01:05:00.000Z',
            },
          ],
        }),
        ...authErrors,
        '404': error('Không tìm thấy buổi học'),
        '409': error('Buổi đã hủy, chưa bắt đầu hoặc quá hạn sửa (BR-43)', {
          code: 'ATTENDANCE_LOCKED',
          message: BR_MESSAGES.BR43,
        }),
        '422': error(
          'Sai dữ liệu, hoặc registration không CONFIRMED/không thuộc lớp (BR-42)',
          {
            code: 'REGISTRATION_NOT_ELIGIBLE',
            message: BR_MESSAGES.BR42,
            details: { invalidRegistrationIds: [77] },
          },
        ),
      },
    },
  },
  '/attendance': {
    get: {
      tags: ['Training – Điểm danh'],
      summary: 'FR-48: Lịch sử điểm danh (phân trang)',
      description:
        'MEMBER chỉ thấy của mình (memberId gửi lên bị bỏ qua); COACH chỉ thấy lớp mình phụ trách; ' +
        'CENTER_MANAGER lọc tự do. Sắp xếp theo thời gian buổi học giảm dần; from/to so với startsAt của buổi.',
      security,
      parameters: [
        queryParam('classId', integerId, 'Lọc theo lớp'),
        queryParam('memberId', integerId, 'Lọc theo Member (Manager, Coach)'),
        queryParam('sessionId', integerId, 'Lọc theo buổi học'),
        queryParam(
          'status',
          { type: 'string', enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] },
          'Trạng thái điểm danh',
        ),
        queryParam(
          'from',
          { type: 'string', format: 'date-time' },
          'Buổi học bắt đầu từ thời điểm (ISO 8601)',
        ),
        queryParam(
          'to',
          { type: 'string', format: 'date-time' },
          'Buổi học bắt đầu đến thời điểm (ISO 8601)',
        ),
        ...pageParams,
      ],
      responses: {
        '200': ok('Danh sách điểm danh', {
          items: [
            {
              id: 90,
              status: 'PRESENT',
              note: null,
              checkedAt: '2026-10-12T01:05:00.000Z',
              updatedAt: '2026-10-12T01:05:00.000Z',
              registrationId: 31,
              session: {
                id: 5,
                startsAt: '2026-10-12T01:00:00.000Z',
                endsAt: '2026-10-12T02:30:00.000Z',
                status: 'SCHEDULED',
              },
              class: {
                id: 2,
                name: 'Bơi cơ bản K12',
                sport: { id: 1, name: 'Bơi lội' },
              },
              member: memberExample,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
        ...authErrors,
        '422': validationError,
      },
    },
  },
}
