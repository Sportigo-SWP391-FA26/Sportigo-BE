const bearer = [{ bearerAuth: [] }]
const standard = { '401': { description: 'Chưa đăng nhập' }, '403': { description: 'Không có quyền' }, '422': { description: 'Dữ liệu hoặc quy tắc thời khóa biểu không hợp lệ' } }
const month = { name: 'month', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-12' } }
const selection = { type: 'object', required: ['dayOfWeek', 'shiftCode'], properties: { dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 }, shiftCode: { type: 'string', enum: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] } } }

export const coachAvailabilityPaths = {
  '/coaches/me/availability-calendar': { get: { tags: ['Coach Availability'], summary: 'Lấy thời khóa biểu availability tháng của Coach', security: bearer, parameters: [{ name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2026-12' } }], responses: { '200': { description: 'Lịch, ca cố định và quy tắc' }, ...standard } } },
  '/coaches/me/availability-submissions/{month}/draft': { put: { tags: ['Coach Availability'], summary: 'Lưu bản nháp availability', security: bearer, parameters: [month], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['selections'], properties: { selections: { type: 'array', items: selection } } } } } }, responses: { '200': { description: 'Đã lưu nháp' }, '409': { description: 'Ca đã phân công bị bỏ hoặc hết hạn' }, ...standard } } },
  '/coaches/me/availability-submissions/{month}/submit': { post: { tags: ['Coach Availability'], summary: 'Gửi availability để duyệt', security: bearer, parameters: [month], responses: { '200': { description: 'Đã gửi duyệt' }, '409': { description: 'Hết hạn hoặc trạng thái không phù hợp' }, ...standard } } },
  '/coaches/me/availability-change-requests': {
    get: { tags: ['Coach Availability'], summary: 'Danh sách yêu cầu đổi ca của Coach', security: bearer, responses: { '200': { description: 'Danh sách yêu cầu' }, ...standard } },
    post: { tags: ['Coach Availability'], summary: 'Yêu cầu thay ca đã phân công', security: bearer, responses: { '201': { description: 'Đã tạo yêu cầu' }, '409': { description: 'Ca chưa được phân công hoặc đã có yêu cầu' }, ...standard } },
  },
  '/coach-availability-submissions': { get: { tags: ['Coach Availability Review'], summary: 'Manager tra cứu lịch availability', security: bearer, responses: { '200': { description: 'Danh sách submission' }, ...standard } } },
  '/coach-availability-submissions/{id}': { get: { tags: ['Coach Availability Review'], summary: 'Chi tiết thời khóa biểu Coach', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Chi tiết submission' }, '404': { description: 'Không tìm thấy' }, ...standard } } },
  '/coach-availability-submissions/{id}/review': { post: { tags: ['Coach Availability Review'], summary: 'Duyệt hoặc từ chối toàn bộ lịch', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Đã xử lý' }, '409': { description: 'Có xung đột hoặc sai trạng thái' }, ...standard } } },
  '/coach-availability-change-requests': { get: { tags: ['Coach Availability Review'], summary: 'Manager tra cứu yêu cầu đổi ca', security: bearer, responses: { '200': { description: 'Danh sách yêu cầu đổi ca' }, ...standard } } },
  '/coach-availability-change-requests/{id}/review': { post: { tags: ['Coach Availability Review'], summary: 'Duyệt hoặc từ chối đổi ca', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'Đã cập nhật availability và các buổi đủ điều kiện' }, '409': { description: 'Coach, Member hoặc phòng bị trùng' }, ...standard } } },
} as const

