const security = [{ bearerAuth: [] }]

const roleEnum = ['CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER']
const statusEnum = ['ACTIVE', 'LOCKED', 'INACTIVE']

export const userSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string', nullable: true },
    displayName: { type: 'string' },
    role: { type: 'string', enum: roleEnum },
    status: { type: 'string', enum: statusEnum },
    code: { type: 'string', nullable: true, description: 'Mã hội viên hoặc mã Coach' },
    emailVerified: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const common = {
  '401': { description: 'Chưa đăng nhập' },
  '403': { description: 'Không đủ quyền' },
}

// Các path quản trị người dùng (FR-09, FR-06, FR-07, FR-08); thêm dần theo từng task
export const userAdminPaths = {
  '/users': {
    get: {
      tags: ['User Management'],
      summary: 'Tìm và lọc người dùng (FR-09)',
      description: 'Center Manager xem mọi role. Receptionist chỉ xem được Member; lọc role khác trả 403.',
      security,
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Tên, email, số điện thoại hoặc mã' },
        { name: 'role', in: 'query', schema: { type: 'string', enum: roleEnum } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: {
        '200': {
          description: 'Danh sách phân trang',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  items: { type: 'array', items: userSummarySchema },
                  page: { type: 'integer' },
                  pageSize: { type: 'integer' },
                  total: { type: 'integer' },
                },
              },
            },
          },
        },
        '400': { description: 'VALIDATION_ERROR' },
        ...common,
      },
    },
  },
}
