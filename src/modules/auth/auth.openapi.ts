const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema } },
})

const object = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object', required, properties,
})

const responses = {
  validation: { description: 'Dữ liệu không hợp lệ' },
  unauthorized: { description: 'Thông tin xác thực không hợp lệ' },
}

export const authPaths = {
  '/auth/login': { post: { tags: ['Login'], summary: 'Đăng nhập bằng email hoặc số điện thoại', requestBody: jsonBody(object(['identifier', 'password'], { identifier: { type: 'string', example: 'member1@gmail.com' }, password: { type: 'string', format: 'password', minLength: 8 } })), responses: { '200': { description: 'Đăng nhập thành công' }, '401': responses.unauthorized, '403': { description: 'Tài khoản chưa xác minh hoặc không hoạt động' }, '422': responses.validation } } },
  '/auth/google': { post: { tags: ['Login'], summary: 'Đăng nhập bằng Google ID token', requestBody: jsonBody(object(['credential'], { credential: { type: 'string', description: 'Google ID token' } })), responses: { '200': { description: 'Đăng nhập thành công' }, '401': responses.unauthorized, '503': { description: 'Google OAuth chưa được cấu hình' } } } },
  '/auth/register': { post: { tags: ['Registration'], summary: 'Đăng ký tài khoản Member', requestBody: jsonBody(object(['displayName', 'phone', 'email', 'password', 'confirmPassword'], { displayName: { type: 'string', example: 'Nguyễn Văn A' }, phone: { type: 'string', example: '0912345678' }, email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password', minLength: 8 }, confirmPassword: { type: 'string', format: 'password' } })), responses: { '201': { description: 'Tạo tài khoản và gửi OTP thành công' }, '409': { description: 'Email hoặc số điện thoại đã tồn tại' }, '422': responses.validation } } },
  '/auth/verify-email': { post: { tags: ['Email Verification'], summary: 'Xác minh email bằng OTP', requestBody: jsonBody(object(['email', 'code'], { email: { type: 'string', format: 'email' }, code: { type: 'string', pattern: '^\\d{6}$', example: '123456' } })), responses: { '200': { description: 'Xác minh thành công' }, '400': { description: 'OTP sai hoặc hết hạn' }, '422': responses.validation } } },
  '/auth/resend-verification': { post: { tags: ['Email Verification'], summary: 'Gửi lại OTP xác minh', requestBody: jsonBody(object(['email'], { email: { type: 'string', format: 'email' } })), responses: { '200': { description: 'Đã tiếp nhận yêu cầu' }, '422': responses.validation } } },
  '/auth/forgot-password': { post: { tags: ['Password Recovery'], summary: 'Yêu cầu OTP khôi phục mật khẩu', requestBody: jsonBody(object(['email'], { email: { type: 'string', format: 'email' } })), responses: { '200': { description: 'Đã tiếp nhận yêu cầu' }, '422': responses.validation } } },
  '/auth/reset-password': { post: { tags: ['Password Recovery'], summary: 'Đặt lại mật khẩu bằng OTP', requestBody: jsonBody(object(['email', 'code', 'password', 'confirmPassword'], { email: { type: 'string', format: 'email' }, code: { type: 'string', pattern: '^\\d{6}$' }, password: { type: 'string', format: 'password', minLength: 8 }, confirmPassword: { type: 'string', format: 'password' } })), responses: { '200': { description: 'Đổi mật khẩu thành công' }, '400': { description: 'OTP sai hoặc hết hạn' }, '422': responses.validation } } },
  '/auth/refresh': { post: { tags: ['Session'], summary: 'Làm mới access token', requestBody: jsonBody(object([], { refreshToken: { type: 'string', description: 'Không bắt buộc nếu refresh token nằm trong cookie' } })), responses: { '200': { description: 'Cấp token mới thành công' }, '401': responses.unauthorized } } },
  '/auth/logout': { post: { tags: ['Session'], summary: 'Đăng xuất và thu hồi refresh token', requestBody: jsonBody(object([], { refreshToken: { type: 'string' } })), responses: { '200': { description: 'Đăng xuất thành công' } } } },
} as const
