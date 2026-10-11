export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Sport Center API',
    version: '0.1.0',
    description: 'REST API cho hệ thống quản lý trung tâm thể thao.',
  },
  servers: [{ url: 'http://localhost:3000/api' }],
  paths: {
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
  },
} as const
