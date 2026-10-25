const security = [{ bearerAuth: [] }]

const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    title: { type: 'string' },
    content: { type: 'string' },
    type: {
      type: 'string',
      example: 'PAYMENT_SUCCESS',
      description: 'ACCOUNT_VERIFIED, ACCOUNT_STATUS, SCHEDULE_CHANGE, WAITLIST_OFFER, PAYMENT_SUCCESS, REFUND, SUPPORT',
    },
    isRead: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const unauthorized = { description: 'Chưa đăng nhập' }

export const notificationsPaths = {
  '/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'Danh sách thông báo của tôi',
      security,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        { name: 'unread', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'true: chỉ lấy chưa đọc' },
      ],
      responses: {
        '200': {
          description: 'Danh sách mới nhất trước, kèm số chưa đọc',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: notificationSchema },
                  page: { type: 'integer' },
                  pageSize: { type: 'integer' },
                  total: { type: 'integer' },
                  unreadCount: { type: 'integer' },
                },
              },
            },
          },
        },
        '401': unauthorized,
        '400': { description: 'VALIDATION_ERROR: tham số không hợp lệ' },
      },
    },
  },
  '/notifications/{id}/read': {
    patch: {
      tags: ['Notifications'],
      summary: 'Đánh dấu một thông báo đã đọc',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        '200': { description: 'Đã đánh dấu' },
        '401': unauthorized,
        '404': { description: 'Không có hoặc không thuộc người dùng hiện tại' },
      },
    },
  },
  '/notifications/read-all': {
    patch: {
      tags: ['Notifications'],
      summary: 'Đánh dấu tất cả đã đọc',
      security,
      responses: { '200': { description: 'Số thông báo đã cập nhật' }, '401': unauthorized },
    },
  },
} as const
