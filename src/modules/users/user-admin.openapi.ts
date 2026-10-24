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

const staffSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string', nullable: true },
    displayName: { type: 'string' },
    role: { type: 'string', enum: ['COACH', 'RECEPTIONIST'] },
    status: { type: 'string', enum: statusEnum },
    emailVerified: { type: 'boolean' },
    staffCode: { type: 'string', nullable: true },
    hiredAt: { type: 'string', format: 'date', nullable: true },
    bio: { type: 'string', nullable: true, description: 'Chỉ Coach' },
    coachStatus: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'], nullable: true, description: 'Chỉ Coach' },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

const staffCodeProp = { type: 'string', pattern: '^[A-Za-z0-9-]{3,30}$', description: 'Lưu dạng chữ hoa, duy nhất trên cả Coach và Receptionist' }

// Các path quản trị người dùng (FR-09, FR-06, FR-07, FR-08); thêm dần theo từng task
export const userAdminPaths = {
  '/members': {
    post: {
      tags: ['User Management'],
      summary: 'Receptionist tạo tài khoản Member tại quầy (FR-08)',
      description:
        'Receptionist hoặc Center Manager. Hệ thống sinh mã hội viên MEM-XXXXXXXX và mật khẩu ngẫu nhiên, tài khoản INACTIVE và gửi OTP xác minh tới email. Hội viên xác minh ở /verify-email rồi đặt mật khẩu bằng chức năng quên mật khẩu. Ghi Audit Log MEMBER_CREATED.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['displayName', 'email', 'phone'],
              properties: {
                displayName: { type: 'string', minLength: 2, maxLength: 80 },
                email: { type: 'string', format: 'email' },
                phone: { type: 'string', pattern: '^(0|\\+84)[0-9]{9,10}$' },
                dateOfBirth: { type: 'string', format: 'date' },
                gender: { type: 'string', enum: ['MALE', 'FEMALE', 'OTHER'] },
                emergencyContact: { type: 'string', maxLength: 100 },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Hội viên vừa tạo',
          content: { 'application/json': { schema: { ...userSummarySchema, properties: { ...userSummarySchema.properties, emailSent: { type: 'boolean' } } } } },
        },
        '400': { description: 'VALIDATION_ERROR' },
        ...common,
        '409': { description: 'ACCOUNT_EXISTS (details.field = email | phone)' },
      },
    },
  },
  '/members/{id}': {
    get: {
      tags: ['User Management'],
      summary: 'Hồ sơ tổng hợp của Member (FR-10)',
      description:
        'Center Manager, Receptionist xem đầy đủ: thông tin, đăng ký lớp + tóm tắt điểm danh, khóa 1-1, 10 đơn thanh toán gần nhất, 5 đánh giá gần nhất. Coach chỉ xem học viên có đăng ký CONFIRMED trong lớp của mình hoặc khóa 1-1 ACTIVE/COMPLETED với mình (khác → 404); chỉ thấy lớp/khóa/đánh giá của mình; email, phone, payments = null; scope = COACH.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        '200': { description: 'Hồ sơ tổng hợp' },
        ...common,
        '404': { description: 'MEMBER_NOT_FOUND' },
      },
    },
  },
  '/staff': {
    get: {
      tags: ['User Management'],
      summary: 'Danh sách nhân sự Coach/Receptionist (FR-07)',
      security,
      parameters: [
        { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Tên, email, số điện thoại hoặc mã nhân sự' },
        { name: 'role', in: 'query', schema: { type: 'string', enum: ['COACH', 'RECEPTIONIST'] } },
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
                properties: { items: { type: 'array', items: staffSchema }, page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' } },
              },
            },
          },
        },
        '400': { description: 'VALIDATION_ERROR' },
        ...common,
      },
    },
    post: {
      tags: ['User Management'],
      summary: 'Tạo tài khoản Coach/Receptionist (FR-07)',
      description:
        'Chỉ Center Manager. Tài khoản tạo ở trạng thái INACTIVE và gửi OTP xác minh tới email; nhân sự nhập OTP rồi đăng nhập bằng mật khẩu ban đầu. Ghi Audit Log STAFF_CREATED.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['role', 'staffCode', 'displayName', 'email', 'phone', 'password'],
              properties: {
                role: { type: 'string', enum: ['COACH', 'RECEPTIONIST'] },
                staffCode: staffCodeProp,
                displayName: { type: 'string', minLength: 2, maxLength: 80 },
                email: { type: 'string', format: 'email' },
                phone: { type: 'string', pattern: '^(0|\\+84)[0-9]{9,10}$' },
                password: { type: 'string', minLength: 8, maxLength: 72 },
                hiredAt: { type: 'string', format: 'date' },
                bio: { type: 'string', maxLength: 1000, description: 'Chỉ Coach' },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Nhân sự vừa tạo',
          content: { 'application/json': { schema: { ...staffSchema, properties: { ...staffSchema.properties, emailSent: { type: 'boolean' } } } } },
        },
        '400': { description: 'VALIDATION_ERROR hoặc FIELD_NOT_ALLOWED' },
        ...common,
        '409': { description: 'ACCOUNT_EXISTS (details.field = email | phone) hoặc STAFF_CODE_EXISTS' },
      },
    },
  },
  '/staff/{id}': {
    patch: {
      tags: ['User Management'],
      summary: 'Cập nhật nhân sự (FR-07)',
      description:
        'Chỉ Center Manager. Không đổi được role, email hay mật khẩu (trường lạ → 400). Khóa/mở khóa tài khoản dùng PATCH /users/{id}/status. Ghi Audit Log STAFF_UPDATED.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              minProperties: 1,
              properties: {
                staffCode: staffCodeProp,
                displayName: { type: 'string', minLength: 2, maxLength: 80 },
                phone: { type: 'string', pattern: '^(0|\\+84)[0-9]{9,10}$' },
                hiredAt: { type: 'string', format: 'date', nullable: true },
                bio: { type: 'string', maxLength: 1000, nullable: true, description: 'Chỉ Coach' },
                coachStatus: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'], description: 'Chỉ Coach' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Nhân sự sau khi sửa', content: { 'application/json': { schema: staffSchema } } },
        '400': { description: 'VALIDATION_ERROR, FIELD_NOT_ALLOWED hoặc STAFF_CODE_REQUIRED' },
        ...common,
        '404': { description: 'STAFF_NOT_FOUND' },
        '409': { description: 'ACCOUNT_EXISTS hoặc STAFF_CODE_EXISTS' },
      },
    },
  },
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
  '/users/{id}/status': {
    patch: {
      tags: ['User Management'],
      summary: 'Khóa hoặc mở khóa tài khoản (FR-06)',
      description:
        'Chỉ Center Manager. Khóa: thu hồi mọi refresh token, chặn đăng nhập mới. Mở khóa: về ACTIVE (hoặc INACTIVE nếu email chưa xác minh). Ghi Audit Log USER_LOCKED/USER_UNLOCKED và gửi thông báo ACCOUNT_STATUS.',
      security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['status', 'reason'],
              properties: {
                status: { type: 'string', enum: ['ACTIVE', 'LOCKED'] },
                reason: { type: 'string', minLength: 3, maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Người dùng sau khi đổi', content: { 'application/json': { schema: userSummarySchema } } },
        '400': { description: 'VALIDATION_ERROR hoặc CANNOT_CHANGE_OWN_STATUS' },
        ...common,
        '404': { description: 'USER_NOT_FOUND' },
        '409': { description: 'STATUS_UNCHANGED hoặc STATUS_CONFLICT' },
      },
    },
  },
}
