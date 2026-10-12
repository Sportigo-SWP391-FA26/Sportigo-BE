import { z } from 'zod'
import { FORBIDDEN_MESSAGE } from '../../middleware/auth.js'
import { markAttendanceSchema } from './attendance.schema.js'
import { assignPlanSchema } from './plan-assignment.schema.js'
import { BR_MESSAGES } from './training.common.js'
import {
  createItemSchema,
  reorderItemsSchema,
  updateItemSchema,
} from './workout-plan-item.schema.js'
import {
  changePlanStatusSchema,
  createPlanSchema,
  updatePlanSchema,
} from './workout-plan.schema.js'

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

const planExample = {
  id: 3,
  name: 'Bơi ếch nền tảng 4 tuần',
  level: 'BEGINNER',
  description: 'Giáo án cho người mới bắt đầu',
  durationWeeks: 4,
  status: 'ACTIVE',
  createdAt: '2026-10-01T02:00:00.000Z',
  updatedAt: '2026-10-05T02:00:00.000Z',
  sport: { id: 1, name: 'Bơi lội' },
  createdBy: { id: 4, coachCode: 'COA-0004', displayName: 'Lê Văn Cường' },
  itemCount: 6,
  assignmentCount: 2,
}

const planItemExample = {
  id: 21,
  weekNumber: 1,
  sessionNumber: 1,
  itemOrder: 1,
  title: 'Khởi động',
  content: 'Xoay khớp, bơi nhẹ 200m',
  durationMinutes: 10,
  sets: null,
  repetitions: null,
  intensity: 'LOW',
  note: null,
}

const planNotFound = error('Không tìm thấy giáo án', {
  code: 'NOT_FOUND',
  message: 'Không tìm thấy giáo án',
})

const assignmentExample = {
  id: 7,
  enrollmentId: 15,
  status: 'ACTIVE',
  assignedAt: '2026-10-08T03:00:00.000Z',
  workoutPlan: {
    id: 3,
    name: 'Bơi ếch nền tảng 4 tuần',
    level: 'BEGINNER',
    status: 'ACTIVE',
    durationWeeks: 4,
    sport: { id: 1, name: 'Bơi lội' },
  },
  assignedBy: { id: 4, coachCode: 'COA-0004', displayName: 'Lê Văn Cường' },
}

const duplicateItemOrder = error('Trùng tuần/buổi/thứ tự (BR-45)', {
  code: 'DUPLICATE_ITEM_ORDER',
  message: BR_MESSAGES.BR45,
})

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
  '/workout-plans': {
    get: {
      tags: ['Training – Giáo án'],
      summary: 'FR-49: Danh sách giáo án (phân trang)',
      description:
        'COACH và CENTER_MANAGER. search tìm theo tên, không phân biệt hoa thường.',
      security,
      parameters: [
        queryParam('sportId', integerId, 'Lọc theo môn'),
        queryParam(
          'level',
          { type: 'string', enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] },
          'Cấp độ',
        ),
        queryParam(
          'status',
          { type: 'string', enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] },
          'Trạng thái',
        ),
        queryParam(
          'search',
          { type: 'string', maxLength: 100 },
          'Tìm theo tên',
        ),
        ...pageParams,
      ],
      responses: {
        '200': ok('Danh sách giáo án', {
          items: [planExample],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
        ...authErrors,
        '422': validationError,
      },
    },
    post: {
      tags: ['Training – Giáo án'],
      summary: 'FR-49: Coach tạo giáo án dùng chung theo môn',
      description:
        'Giáo án gắn đúng một môn đang hoạt động (BR-44), trạng thái khởi tạo là DRAFT.',
      security,
      requestBody: jsonBody(createPlanSchema, {
        sportId: 1,
        name: 'Bơi ếch nền tảng 4 tuần',
        level: 'BEGINNER',
        description: 'Giáo án cho người mới bắt đầu',
        durationWeeks: 4,
      }),
      responses: {
        '201': ok('Đã tạo giáo án', { ...planExample, status: 'DRAFT' }),
        ...authErrors,
        '422': error(
          'Thiếu/sai dữ liệu, hoặc môn không tồn tại/ngừng hoạt động',
          {
            code: 'SPORT_NOT_AVAILABLE',
            message: 'Môn thể thao không tồn tại hoặc đã ngừng hoạt động',
          },
        ),
      },
    },
  },
  '/workout-plans/{id}': {
    get: {
      tags: ['Training – Giáo án'],
      summary: 'FR-49: Chi tiết giáo án kèm các mục (tuần → buổi → thứ tự)',
      security,
      parameters: [pathId('ID giáo án')],
      responses: {
        '200': ok('Chi tiết giáo án', {
          ...planExample,
          items: [planItemExample],
        }),
        ...authErrors,
        '404': planNotFound,
        '422': validationError,
      },
    },
    patch: {
      tags: ['Training – Giáo án'],
      summary: 'FR-49: Cập nhật giáo án (mọi Coach)',
      description:
        'Không đổi được sportId nếu giáo án đã từng được gán (BR-44). Đổi trạng thái dùng PATCH /status.',
      security,
      parameters: [pathId('ID giáo án')],
      requestBody: jsonBody(updatePlanSchema, {
        name: 'Bơi ếch nâng cao',
        durationWeeks: 6,
      }),
      responses: {
        '200': ok('Đã cập nhật', planExample),
        ...authErrors,
        '404': planNotFound,
        '409': error('Giáo án đã được gán nên không đổi môn', {
          code: 'PLAN_SPORT_LOCKED',
          message: 'Không thể đổi môn của giáo án đã được gán cho học viên',
        }),
        '422': validationError,
      },
    },
    delete: {
      tags: ['Training – Giáo án'],
      summary: 'FR-49: Xóa mềm giáo án (chuyển INACTIVE, không xóa cứng)',
      security,
      parameters: [pathId('ID giáo án')],
      responses: {
        '200': ok('Đã chuyển INACTIVE', { ...planExample, status: 'INACTIVE' }),
        ...authErrors,
        '404': planNotFound,
      },
    },
  },
  '/workout-plans/{id}/status': {
    patch: {
      tags: ['Training – Giáo án'],
      summary: 'FR-49: Đổi trạng thái DRAFT/ACTIVE/INACTIVE',
      description: 'Chỉ kích hoạt (ACTIVE) khi giáo án có ít nhất một mục.',
      security,
      parameters: [pathId('ID giáo án')],
      requestBody: jsonBody(changePlanStatusSchema, { status: 'ACTIVE' }),
      responses: {
        '200': ok('Đã đổi trạng thái', planExample),
        ...authErrors,
        '404': planNotFound,
        '422': error('Sai dữ liệu hoặc giáo án chưa có mục', {
          code: 'PLAN_HAS_NO_ITEMS',
          message: 'Giáo án phải có ít nhất một mục trước khi kích hoạt',
        }),
      },
    },
  },
  '/workout-plans/{id}/items': {
    get: {
      tags: ['Training – Giáo án'],
      summary: 'FR-50: Các mục của giáo án (tuần → buổi → thứ tự)',
      security,
      parameters: [pathId('ID giáo án')],
      responses: {
        '200': ok('Danh sách mục', [planItemExample]),
        ...authErrors,
        '404': planNotFound,
        '422': validationError,
      },
    },
    post: {
      tags: ['Training – Giáo án'],
      summary: 'FR-50: Thêm mục vào giáo án (COACH)',
      description:
        'Bỏ trống itemOrder thì mục được xếp cuối tuần/buổi. Trùng (tuần, buổi, thứ tự) trả 409 (BR-45). ' +
        'weekNumber không được vượt durationWeeks của giáo án.',
      security,
      parameters: [pathId('ID giáo án')],
      requestBody: jsonBody(createItemSchema, {
        weekNumber: 1,
        sessionNumber: 1,
        title: 'Khởi động',
        content: 'Xoay khớp, bơi nhẹ 200m',
        durationMinutes: 10,
        intensity: 'LOW',
      }),
      responses: {
        '201': ok('Đã thêm mục', planItemExample),
        ...authErrors,
        '404': planNotFound,
        '409': duplicateItemOrder,
        '422': validationError,
      },
    },
  },
  '/workout-plans/{id}/items/reorder': {
    patch: {
      tags: ['Training – Giáo án'],
      summary: 'FR-50: Sắp xếp lại thứ tự các mục trong cùng tuần/buổi',
      description:
        'Gửi đủ tất cả mục của một tuần/buổi; itemOrder phải là 1..n liên tục. Chạy trong một transaction.',
      security,
      parameters: [pathId('ID giáo án')],
      requestBody: jsonBody(reorderItemsSchema, {
        items: [
          { itemId: 23, itemOrder: 1 },
          { itemId: 21, itemOrder: 2 },
          { itemId: 22, itemOrder: 3 },
        ],
      }),
      responses: {
        '200': ok('Toàn bộ mục của giáo án sau khi sắp xếp', [planItemExample]),
        ...authErrors,
        '404': planNotFound,
        '422': error('Thiếu mục, khác tuần/buổi, hoặc thứ tự không liên tục', {
          code: 'REORDER_INCOMPLETE',
          message: 'Phải gửi đủ 3 mục của tuần 1, buổi 1',
        }),
      },
    },
  },
  '/workout-plans/{id}/items/{itemId}': {
    patch: {
      tags: ['Training – Giáo án'],
      summary: 'FR-50: Sửa mục giáo án (COACH)',
      security,
      parameters: [pathId('ID giáo án'), pathId('ID mục giáo án', 'itemId')],
      requestBody: jsonBody(updateItemSchema, {
        content: 'Bơi nhẹ 300m',
        sets: 2,
      }),
      responses: {
        '200': ok('Đã cập nhật', planItemExample),
        ...authErrors,
        '404': error('Không tìm thấy giáo án hoặc mục không thuộc giáo án'),
        '409': duplicateItemOrder,
        '422': validationError,
      },
    },
    delete: {
      tags: ['Training – Giáo án'],
      summary: 'FR-50: Xóa mục giáo án và đánh lại thứ tự liên tục',
      description: 'Không xóa được mục cuối cùng của giáo án đang ACTIVE.',
      security,
      parameters: [pathId('ID giáo án'), pathId('ID mục giáo án', 'itemId')],
      responses: {
        '204': { description: 'Đã xóa' },
        ...authErrors,
        '404': error('Không tìm thấy giáo án hoặc mục không thuộc giáo án'),
        '409': error('Mục cuối cùng của giáo án đang hoạt động', {
          code: 'PLAN_NEEDS_ITEMS',
          message: 'Không thể xóa mục cuối cùng của giáo án đang hoạt động',
        }),
      },
    },
  },
  '/private-enrollments/{id}/plans': {
    get: {
      tags: ['Training – Giáo án'],
      summary: 'FR-51: Các giáo án đã gán cho khóa 1-1',
      description:
        'Coach phụ trách enrollment, Member chủ enrollment hoặc Center Manager.',
      security,
      parameters: [pathId('ID enrollment (PrivateCourseEnrollment)')],
      responses: {
        '200': ok('Danh sách gán giáo án, mới nhất trước', [assignmentExample]),
        ...authErrors,
        '404': error('Không tìm thấy khóa học 1-1'),
        '422': validationError,
      },
    },
    post: {
      tags: ['Training – Giáo án'],
      summary: 'FR-51: Coach gán giáo án đúng môn cho khóa 1-1',
      description:
        'Coach phải phụ trách enrollment và enrollment phải ACTIVE. Giáo án phải ACTIVE và cùng môn (BR-44). ' +
        'Một khóa có thể có nhiều giáo án; gán trùng giáo án đang ACTIVE trả 409, gán lại giáo án đã kết thúc thì kích hoạt lại.',
      security,
      parameters: [pathId('ID enrollment (PrivateCourseEnrollment)')],
      requestBody: jsonBody(assignPlanSchema, { workoutPlanId: 3 }),
      responses: {
        '201': ok('Đã gán giáo án', assignmentExample),
        ...authErrors,
        '404': error('Không tìm thấy khóa học 1-1 hoặc giáo án'),
        '409': error('Enrollment chưa ACTIVE hoặc giáo án đang được gán', {
          code: 'PLAN_ALREADY_ASSIGNED',
          message: 'Giáo án này đang được gán cho khóa học',
        }),
        '422': error('Giáo án sai môn hoặc chưa ACTIVE (BR-44)', {
          code: 'PLAN_NOT_ASSIGNABLE',
          message: BR_MESSAGES.BR44,
        }),
      },
    },
  },
}
