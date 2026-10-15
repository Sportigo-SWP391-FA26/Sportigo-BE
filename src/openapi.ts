import { trainingPaths } from './modules/training/training.openapi.js'

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Sport Center API',
    version: '0.1.0',
    description: 'REST API cho hệ thống quản lý trung tâm thể thao.',
  },
  servers: [{ url: 'http://localhost:3000/api' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  paths: {
    ...trainingPaths,
    '/auth/login': {
      post: {
        summary: 'Đăng nhập bằng email hoặc số điện thoại',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier', 'password'],
                properties: {
                  identifier: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Đăng nhập thành công' },
          '401': { description: 'Thông tin đăng nhập không đúng' },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Đăng ký tài khoản hội viên',
        requestBody: { required: true },
        responses: {
          '201': { description: 'Tạo tài khoản thành công' },
          '409': { description: 'Email hoặc số điện thoại đã tồn tại' },
          '422': { description: 'Dữ liệu không hợp lệ' },
        },
      },
    },
    '/auth/verify-email': {
      post: {
        summary: 'Xác minh email bằng liên kết một lần',
        requestBody: { required: true },
        responses: {
          '200': { description: 'Email đã được xác minh' },
          '400': { description: 'Token không hợp lệ hoặc hết hạn' },
        },
      },
    },
    '/auth/resend-verification': {
      post: {
        summary: 'Gửi lại email xác minh qua Gmail HTTPS webhook',
        requestBody: { required: true },
        responses: { '200': { description: 'Yêu cầu đã được tiếp nhận' } },
      },
    },
    '/auth/refresh': {
      post: {
        summary: 'Đổi refresh token HttpOnly lấy access token mới',
        responses: {
          '200': { description: 'Token mới đã được cấp' },
          '401': { description: 'Phiên đăng nhập không hợp lệ hoặc hết hạn' },
        },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Đăng xuất và thu hồi refresh token',
        responses: { '200': { description: 'Đã đăng xuất' } },
      },
    },
  },
} as const
