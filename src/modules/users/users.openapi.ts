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
        trainingGoal: nullableString({ maxLength: 500 }),
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
        'Không nhận email, role, status, mã hội viên/nhân sự. dateOfBirth, gender, emergencyContact, trainingGoal chỉ dành cho Member; bio chỉ dành cho Coach.',
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
                trainingGoal: nullableString({ maxLength: 500 }),
                bio: nullableString({ maxLength: 1000 }),
              },
            },
          },
        },
      },
      responses: {
        '200': ok,
        '400': {
          description:
            'VALIDATION_ERROR (dữ liệu sai hoặc có trường lạ như email/role/status) hoặc FIELD_NOT_ALLOWED (gửi trường không thuộc role)',
        },
        '401': unauthorized,
        '403': inactive,
        '409': { description: 'Số điện thoại đã được sử dụng (ACCOUNT_EXISTS)' },
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
        '400': {
          description:
            'INVALID_CURRENT_PASSWORD, SAME_AS_CURRENT_PASSWORD, hoặc VALIDATION_ERROR (mật khẩu mới không đạt chính sách / xác nhận không khớp)',
        },
        '401': unauthorized,
        '403': inactive,
      },
    },
  },
  // note: FR-05 đổi email gồm 2 bước, email chỉ đổi thật ở bước confirm
  '/users/me/email-change': {
    post: {
      tags: ['Profile'],
      summary: 'Yêu cầu đổi email (bước 1: gửi OTP tới email mới)',
      description:
        'Yêu cầu mật khẩu hiện tại. Email chưa đổi ở bước này. OTP 6 số có hiệu lực 10 phút; gửi lại sẽ hủy mã cũ.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['newEmail', 'currentPassword'],
              properties: { newEmail: { type: 'string', format: 'email' }, currentPassword: { type: 'string', format: 'password' } },
            },
          },
        },
      },
      responses: {
        '202': {
          description: 'Đã gửi OTP',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { message: { type: 'string' }, newEmail: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } },
              },
            },
          },
        },
        '400': { description: 'VALIDATION_ERROR, INVALID_CURRENT_PASSWORD hoặc SAME_AS_CURRENT_EMAIL' },
        '401': unauthorized,
        '403': inactive,
        '409': { description: 'Email đã được sử dụng (ACCOUNT_EXISTS, details.field = newEmail)' },
        '502': { description: 'EMAIL_DELIVERY_FAILED: chưa gửi được email' },
      },
    },
  },
  '/users/me/email-change/confirm': {
    post: {
      tags: ['Profile'],
      summary: 'Xác nhận đổi email (bước 2: nhập OTP)',
      description: 'Đúng OTP thì đổi email đăng nhập, ghi emailVerifiedAt và Audit Log EMAIL_CHANGED. Mã chỉ dùng được một lần.',
      security,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', pattern: '^\\d{6}$' } } },
          },
        },
      },
      responses: {
        '200': ok,
        '400': { description: 'VALIDATION_ERROR hoặc INVALID_EMAIL_CHANGE_CODE (sai, hết hạn hoặc đã dùng)' },
        '401': unauthorized,
        '403': inactive,
        '409': { description: 'Email vừa bị tài khoản khác dùng (ACCOUNT_EXISTS)' },
      },
    },
  },
} as const
