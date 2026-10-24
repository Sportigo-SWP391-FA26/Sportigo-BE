const security = [{ bearerAuth: [] }]

const nullableString = (extra: Record<string, unknown> = {}) => ({ type: 'string', nullable: true, ...extra })

const profileSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    phone: nullableString(),
    displayName: { type: 'string' },
    role: { type: 'string', enum: ['CENTER_MANAGER', 'COACH', 'MEMBER', 'RECEPTIONIST'] },
    status: { type: 'string', enum: ['ACTIVE', 'LOCKED', 'INACTIVE'] },
    emailVerifiedAt: nullableString({ format: 'date-time' }),
    createdAt: { type: 'string', format: 'date-time' },
    member: {
      type: 'object',
      nullable: true,
      properties: {
        memberCode: { type: 'string' },
        dateOfBirth: nullableString({ format: 'date' }),
        gender: nullableString(),
        emergencyContact: nullableString(),
        joinedAt: { type: 'string', format: 'date-time' },
      },
    },
    coach: {
      type: 'object',
      nullable: true,
      properties: {
        coachCode: { type: 'string' },
        bio: nullableString(),
        hiredAt: nullableString({ format: 'date' }),
      },
    },
  },
}

const ok = { description: 'Hồ sơ hiện tại', content: { 'application/json': { schema: profileSchema } } }
const unauthorized = { description: 'Chưa đăng nhập hoặc token không hợp lệ' }
const inactive = { description: 'Tài khoản không ở trạng thái ACTIVE' }

export const usersPaths = {
  '/users/me': {
    get: {
      tags: ['Profile'],
      summary: 'Xem hồ sơ của tôi',
      security,
      responses: { '200': ok, '401': unauthorized, '403': inactive },
    },
    patch: {
      tags: ['Profile'],
      summary: 'Cập nhật các trường hồ sơ được phép',
      description:
        'Không nhận email, role, status, mã hội viên/nhân sự. dateOfBirth, gender, emergencyContact chỉ dành cho Member; bio chỉ dành cho Coach.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              minProperties: 1,
              properties: {
                displayName: { type: 'string', minLength: 2, maxLength: 80 },
                phone: { type: 'string', example: '0912345678' },
                dateOfBirth: nullableString({ format: 'date', example: '2004-10-14' }),
                gender: nullableString({ enum: ['MALE', 'FEMALE', 'OTHER', null] }),
                emergencyContact: nullableString({ maxLength: 100 }),
                bio: nullableString({ maxLength: 1000 }),
              },
            },
          },
        },
      },
      responses: {
        '200': ok,
        '400': { description: 'Gửi trường không thuộc role (FIELD_NOT_ALLOWED)' },
        '401': unauthorized,
        '403': inactive,
        '409': { description: 'Số điện thoại đã được sử dụng (ACCOUNT_EXISTS)' },
        '422': { description: 'Dữ liệu không hợp lệ hoặc có trường không được phép' },
      },
    },
  },
  '/users/me/password': {
    put: {
      tags: ['Profile'],
      summary: 'Đổi mật khẩu',
      description:
        'Yêu cầu mật khẩu hiện tại. Thành công thì thu hồi mọi refresh token, ghi Audit Log PASSWORD_CHANGED và cấp phiên mới cho thiết bị hiện tại: access token trong body, refresh token trong cookie sportigo_refresh (path /api/auth). Sai mật khẩu hiện tại trả 400 (không phải 401) để client không tự refresh token.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['currentPassword', 'newPassword', 'confirmPassword'],
              properties: {
                currentPassword: { type: 'string', format: 'password' },
                newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 72 },
                confirmPassword: { type: 'string', format: 'password' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Đổi mật khẩu thành công',
          headers: {
            'Set-Cookie': { description: 'sportigo_refresh=<refresh token mới>; HttpOnly; Path=/api/auth', schema: { type: 'string' } },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { message: { type: 'string' }, accessToken: { type: 'string' } },
              },
            },
          },
        },
        '400': { description: 'INVALID_CURRENT_PASSWORD hoặc SAME_AS_CURRENT_PASSWORD' },
        '401': unauthorized,
        '403': inactive,
        '422': { description: 'Mật khẩu mới không đạt chính sách hoặc xác nhận không khớp' },
      },
    },
  },
} as const
