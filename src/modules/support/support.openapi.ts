import { PRIORITIES, REQUEST_STATUSES, SUPPORT_CATEGORIES } from './support.schema.js'

const security = [{ bearerAuth: [] }]
const tags = ['Support']

const person = {
  type: 'object',
  properties: { id: { type: 'integer' }, displayName: { type: 'string' }, role: { type: 'string' } },
}

const summarySchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    subject: { type: 'string' },
    category: { type: 'string', enum: [...SUPPORT_CATEGORIES] },
    priority: { type: 'string', enum: [...PRIORITIES] },
    status: { type: 'string', enum: [...REQUEST_STATUSES] },
    createdAt: { type: 'string', format: 'date-time' },
    resolvedAt: { type: 'string', format: 'date-time', nullable: true },
    requester: person,
    assignee: { ...person, nullable: true },
    messageCount: { type: 'integer' },
  },
}

export const supportDetailSchema = {
  type: 'object',
  properties: {
    ...summarySchema.properties,
    description: { type: 'string' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          content: { type: 'string' },
          isInternal: { type: 'boolean', description: 'Ghi chú nội bộ, Member không thấy' },
          sentAt: { type: 'string', format: 'date-time' },
          sender: person,
        },
      },
    },
  },
}

const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
const detailResponse = (description: string) => ({ description, content: { 'application/json': { schema: supportDetailSchema } } })
const common = { '401': { description: 'Chưa đăng nhập' }, '403': { description: 'Không đủ quyền' } }

export const supportPaths = {
  '/support-requests': {
    post: {
      tags,
      summary: 'Member gửi yêu cầu hỗ trợ (FR-55)',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['subject', 'category', 'description'],
              properties: {
                subject: { type: 'string', minLength: 5, maxLength: 200 },
                category: { type: 'string', enum: [...SUPPORT_CATEGORIES] },
                description: { type: 'string', minLength: 10, maxLength: 5000 },
                priority: { type: 'string', enum: [...PRIORITIES], default: 'MEDIUM' },
              },
            },
          },
        },
      },
      responses: { '201': detailResponse('Yêu cầu vừa tạo'), '400': { description: 'VALIDATION_ERROR' }, ...common },
    },
    get: {
      tags,
      summary: 'Danh sách yêu cầu hỗ trợ (FR-55 Member, FR-56 hàng đợi nhân viên)',
      description:
        'Member: chỉ yêu cầu của mình, chỉ nhận status/page/pageSize. Receptionist: yêu cầu chưa phân công + đang giao cho mình. Center Manager: tất cả. Nhân viên lọc thêm priority, mine, q.',
      security,
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: [...REQUEST_STATUSES] } },
        { name: 'priority', in: 'query', schema: { type: 'string', enum: [...PRIORITIES] }, description: 'Chỉ nhân viên' },
        { name: 'mine', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Chỉ nhân viên: yêu cầu đang giao cho mình' },
        { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Chỉ nhân viên: chủ đề hoặc tên hội viên' },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      ],
      responses: {
        '200': {
          description: 'Danh sách phân trang',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { items: { type: 'array', items: summarySchema }, page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' } },
              },
            },
          },
        },
        ...common,
      },
    },
  },
  '/support-requests/{id}': {
    get: {
      tags,
      summary: 'Chi tiết yêu cầu và tin nhắn (FR-55, FR-56)',
      description:
        'Member chỉ xem được yêu cầu của mình (khác → 404) và không thấy tin nhắn nội bộ. Nhân viên thấy cả tin nội bộ và thêm trường history (lịch sử phân công); Receptionist không xem được yêu cầu đang giao cho người khác (404).',
      security,
      parameters: idParam,
      responses: { '200': detailResponse('Chi tiết'), ...common, '404': { description: 'REQUEST_NOT_FOUND' } },
    },
    patch: {
      tags,
      summary: 'Nhân viên nhận/giao việc và chuyển trạng thái (FR-56)',
      description:
        'Receptionist chỉ tự nhận (assigneeId = mình); Manager giao cho Receptionist đang hoạt động. Chuyển trạng thái hợp lệ: ASSIGNED→IN_PROGRESS, IN_PROGRESS→RESOLVED, RESOLVED→CLOSED hoặc RESOLVED→IN_PROGRESS. Chỉ người phụ trách hoặc Manager được đổi trạng thái. Ghi Audit Log SUPPORT_ASSIGNED / SUPPORT_STATUS_CHANGED và báo Member (SUPPORT).',
      security,
      parameters: idParam,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              minProperties: 1,
              properties: {
                assigneeId: { type: 'integer' },
                status: { type: 'string', enum: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'] },
                note: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        '200': detailResponse('Chi tiết sau khi cập nhật (kèm history)'),
        '400': { description: 'VALIDATION_ERROR hoặc INVALID_ASSIGNEE' },
        ...common,
        '404': { description: 'REQUEST_NOT_FOUND' },
        '409': { description: 'INVALID_STATUS_TRANSITION, ALREADY_ASSIGNED, REQUEST_NOT_ASSIGNED hoặc STATUS_CONFLICT' },
      },
    },
  },
  '/support-requests/{id}/messages': {
    post: {
      tags,
      summary: 'Gửi tin nhắn (FR-55 Member, FR-56 nhân viên)',
      description:
        'isInternal chỉ dành cho nhân viên (Member gửi → 400). Nhân viên trả lời công khai phải đang phụ trách (hoặc là Manager); phản hồi đầu tiên khi ASSIGNED tự chuyển IN_PROGRESS và báo Member.',
      security,
      parameters: idParam,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['content'],
              properties: { content: { type: 'string', minLength: 1, maxLength: 2000 }, isInternal: { type: 'boolean', default: false } },
            },
          },
        },
      },
      responses: {
        '201': detailResponse('Chi tiết sau khi gửi'),
        '400': { description: 'VALIDATION_ERROR' },
        ...common,
        '404': { description: 'REQUEST_NOT_FOUND' },
        '409': { description: 'REQUEST_CLOSED hoặc REQUEST_NOT_ASSIGNED' },
      },
    },
  },
  '/support-requests/{id}/cancel': {
    post: {
      tags,
      summary: 'Member hủy yêu cầu chưa giải quyết (FR-55)',
      security,
      parameters: idParam,
      responses: {
        '200': detailResponse('Chi tiết sau khi hủy'),
        ...common,
        '404': { description: 'REQUEST_NOT_FOUND' },
        '409': { description: 'INVALID_STATUS_TRANSITION hoặc STATUS_CONFLICT' },
      },
    },
  },
}
