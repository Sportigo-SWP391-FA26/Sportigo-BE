export const contentPaths = {
  '/public/landing': {
    get: { tags: ['Public Content'], summary: 'Lấy nội dung Landing và số liệu thật', responses: { 200: { description: 'Dữ liệu Landing' } } },
  },
  '/public/newsletter': {
    post: { tags: ['Public Content'], summary: 'Đăng ký nhận tin', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } }, responses: { 201: { description: 'Đã đăng ký' }, 200: { description: 'Email đã đăng ký trước đó' } } },
  },
  '/members/me/home': {
    get: { tags: ['Member Home'], summary: 'Dữ liệu trang chủ hội viên', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Hồ sơ, lịch tuần, đề xuất và hoạt động gần đây' }, 401: { description: 'Chưa đăng nhập' } } },
  },
  '/reports/dashboard': {
    get: { tags: ['Reports'], summary: 'Số liệu dashboard Center Manager', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Số liệu vận hành hiện tại' }, 403: { description: 'Sai quyền' } } },
  },
  '/landing-content/{kind}': {
    get: { tags: ['Landing Management'], summary: 'Danh sách nội dung Landing', security: [{ bearerAuth: [] }], parameters: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['heroes', 'facilities', 'partners'] } }], responses: { 200: { description: 'Danh sách nội dung' } } },
    post: { tags: ['Landing Management'], summary: 'Tạo nội dung Landing', security: [{ bearerAuth: [] }], parameters: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['heroes', 'facilities', 'partners'] } }], responses: { 201: { description: 'Đã tạo' } } },
  },
  '/landing-content/{kind}/{id}': {
    patch: { tags: ['Landing Management'], summary: 'Cập nhật nội dung Landing', security: [{ bearerAuth: [] }], parameters: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string' } }, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Đã cập nhật' } } },
    delete: { tags: ['Landing Management'], summary: 'Ẩn nội dung Landing', security: [{ bearerAuth: [] }], parameters: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string' } }, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Đã ẩn' } } },
  },
  '/landing-content/settings': {
    get: { tags: ['Landing Management'], summary: 'Lấy cấu hình website', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Cấu hình website' } } },
    put: { tags: ['Landing Management'], summary: 'Cập nhật cấu hình website', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Đã cập nhật' } } },
  },
} as const
