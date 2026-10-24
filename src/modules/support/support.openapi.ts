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
      summary: 'Danh sách yêu cầu hỗ trợ của tôi (FR-55)',
      security,
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: [...REQUEST_STATUSES] } },
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
      summary: 'Chi tiết yêu cầu và tin nhắn (FR-55)',
      description: 'Member chỉ xem được yêu cầu của mình (khác → 404) và không thấy tin nhắn nội bộ.',
      security,
      parameters: idParam,
      responses: { '200': detailResponse('Chi tiết'), ...common, '404': { description: 'REQUEST_NOT_FOUND' } },
    },
  },
  '/support-requests/{id}/messages': {
    post: {
      tags,
      summary: 'Gửi thêm tin nhắn (FR-55)',
      security,
      parameters: idParam,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: false, required: ['content'], properties: { content: { type: 'string', minLength: 1, maxLength: 2000 } } },
          },
        },
      },
      responses: {
        '201': detailResponse('Chi tiết sau khi gửi'),
        '400': { description: 'VALIDATION_ERROR' },
        ...common,
        '404': { description: 'REQUEST_NOT_FOUND' },
        '409': { description: 'REQUEST_CLOSED' },
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
