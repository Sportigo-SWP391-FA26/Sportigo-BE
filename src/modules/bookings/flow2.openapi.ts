const security = [{ bearerAuth: [] }]
const id = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'integer', minimum: 1 } })
const query = (name: string, schema: Record<string, unknown> = { type: 'string' }) => ({ name, in: 'query', schema })
const jsonBody = (required: string[], properties: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', required, properties } } },
})
const standard = {
  '400': { description: 'Dữ liệu không hợp lệ' },
  '401': { description: 'Chưa đăng nhập' },
  '403': { description: 'Không đủ quyền' },
  '404': { description: 'Không tìm thấy dữ liệu' },
  '409': { description: 'Xung đột trạng thái hoặc lịch' },
  '422': { description: 'Dữ liệu không hợp lệ' },
}
const operation = (tag: string, summary: string, extra: Record<string, unknown> = {}) => ({
  tags: [tag], summary, security, ...extra,
})
const publicOperation = (tag: string, summary: string, extra: Record<string, unknown> = {}) => ({
  tags: [tag], summary, ...extra,
})
const ok = { '200': { description: 'Thành công' }, ...standard }
const created = { '201': { description: 'Tạo thành công' }, ...standard }

const sportProperties = {
  name: { type: 'string', example: 'Bơi lội' },
  description: { type: 'string' },
  imageUrl: { type: 'string', format: 'uri' },
  isActive: { type: 'boolean' },
}
const roomProperties = {
  code: { type: 'string', example: 'POOL-01' },
  name: { type: 'string', example: 'Hồ bơi trong nhà' },
  capacity: { type: 'integer', minimum: 1 },
  status: { type: 'string', enum: ['AVAILABLE', 'MAINTENANCE', 'INACTIVE'] },
}
const sessionProperties = {
  roomId: { type: 'integer', minimum: 1 },
  startsAt: { type: 'string', format: 'date-time' },
  endsAt: { type: 'string', format: 'date-time' },
  note: { type: 'string' },
}

export const flow2Paths = {
  '/sports': {
    get: operation('Sports', 'Danh sách môn thể thao', { responses: ok }),
    post: operation('Sports', 'Tạo môn thể thao', { requestBody: jsonBody(['name'], sportProperties), responses: created }),
  },
  '/sports/{id}': {
    put: operation('Sports', 'Cập nhật môn thể thao', { parameters: [id()], requestBody: jsonBody([], sportProperties), responses: ok }),
    delete: operation('Sports', 'Xóa môn chưa được sử dụng', { parameters: [id()], responses: ok }),
  },
  '/rooms': {
    get: operation('Rooms', 'Danh sách phòng', { responses: ok }),
    post: operation('Rooms', 'Tạo phòng', { requestBody: jsonBody(['code', 'name', 'capacity'], roomProperties), responses: created }),
  },
  '/rooms/{id}': {
    put: operation('Rooms', 'Cập nhật phòng và trạng thái', { parameters: [id()], requestBody: jsonBody([], roomProperties), responses: ok }),
    delete: operation('Rooms', 'Xóa phòng chưa có lịch', { parameters: [id()], responses: ok }),
  },
  '/coaches/{id}/availability': {
    get: operation('Coaches', 'Xem lịch khả dụng của Coach', { parameters: [id()], responses: ok }),
    post: operation('Coaches', 'Thêm khung giờ khả dụng cho Coach', {
      parameters: [id()],
      requestBody: jsonBody(['dayOfWeek', 'startTime', 'endTime', 'effectiveFrom'], {
        dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
        startTime: { type: 'string', example: '09:00' },
        endTime: { type: 'string', example: '11:00' },
        effectiveFrom: { type: 'string', format: 'date' },
        effectiveTo: { type: 'string', format: 'date' },
      }),
      responses: created,
    }),
  },
  '/group-classes': {
    get: operation('Group Classes', 'Danh sách lớp nhóm dành cho quản lý', { responses: ok }),
    post: operation('Group Classes', 'Tạo lớp nhóm dạng nháp', {
      requestBody: jsonBody(['sportId', 'coachId', 'name', 'capacity', 'tuitionFee', 'registrationOpenAt', 'registrationCloseAt', 'startDate', 'endDate'], {
        sportId: { type: 'integer' }, coachId: { type: 'integer' }, name: { type: 'string' },
        description: { type: 'string' }, capacity: { type: 'integer', minimum: 1 }, tuitionFee: { type: 'number', minimum: 0 },
        registrationOpenAt: { type: 'string', format: 'date-time' }, registrationCloseAt: { type: 'string', format: 'date-time' },
        startDate: { type: 'string', format: 'date-time' }, endDate: { type: 'string', format: 'date-time' },
      }),
      responses: created,
    }),
  },
  '/group-classes/{id}/status': {
    patch: operation('Group Classes', 'Cập nhật trạng thái lớp nhóm', { parameters: [id()], requestBody: jsonBody(['status'], { status: { type: 'string', enum: ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED'] } }), responses: ok }),
  },
  '/group-classes/{id}/coach': {
    patch: operation('Group Classes', 'Phân công hoặc thay Coach', { parameters: [id()], requestBody: jsonBody(['coachId'], { coachId: { type: 'integer', minimum: 1 } }), responses: ok }),
  },
  '/group-classes/{id}/sessions': {
    get: operation('Class Sessions', 'Danh sách buổi học của lớp', { parameters: [id()], responses: ok }),
    post: operation('Class Sessions', 'Tạo một buổi học cho lớp', { parameters: [id()], requestBody: jsonBody(['roomId', 'startsAt', 'endsAt'], sessionProperties), responses: created }),
  },
  '/group-classes/{id}/sessions/recurring': {
    post: operation('Class Sessions', 'Tạo lịch học lặp hằng tuần', {
      parameters: [id()],
      requestBody: jsonBody(['roomId', 'dayOfWeek', 'startTime', 'endTime', 'recurrence'], {
        roomId: { type: 'integer' }, dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
        startTime: { type: 'string', example: '09:00' }, endTime: { type: 'string', example: '11:00' },
        recurrence: { type: 'object', required: ['effectiveFrom', 'effectiveTo'], properties: { effectiveFrom: { type: 'string', format: 'date' }, effectiveTo: { type: 'string', format: 'date' } } },
        note: { type: 'string' },
      }),
      responses: created,
    }),
  },
  '/group-classes/{id}/cancel': {
    post: operation('Group Classes', 'Trung tâm hủy lớp và tự động hoàn tiền vào ví', { parameters: [id()], responses: ok }),
  },
  '/group-classes/{id}/register-on-behalf': {
    post: operation('Bookings', 'Receptionist đăng ký lớp thay Member', { parameters: [id()], requestBody: jsonBody(['memberId'], { memberId: { type: 'integer', minimum: 1 } }), responses: created }),
  },
  '/class-sessions': {
    post: operation('Class Sessions', 'Tạo buổi học với classId trong request', { requestBody: jsonBody(['classId', 'roomId', 'startsAt', 'endsAt'], { classId: { type: 'integer' }, ...sessionProperties }), responses: created }),
  },
  '/class-sessions/{id}/change': {
    post: operation('Class Sessions', 'Đổi thời gian hoặc phòng của buổi học', { parameters: [id()], requestBody: jsonBody(['reason'], { newStartsAt: { type: 'string', format: 'date-time' }, newRoomId: { type: 'integer' }, reason: { type: 'string' } }), responses: ok }),
  },
  '/bookings/classes': {
    get: publicOperation('Bookings', 'Tìm và lọc lớp nhóm công khai', { parameters: [query('sportId', { type: 'integer' }), query('coachId', { type: 'integer' }), query('date', { type: 'string', format: 'date' }), query('page', { type: 'integer', default: 1 }), query('limit', { type: 'integer', default: 10 })], responses: { '200': { description: 'Danh sách lớp phân trang' }, '422': standard['422'] } }),
  },
  '/bookings/classes/{id}': {
    get: publicOperation('Bookings', 'Xem chi tiết lớp, lịch và số chỗ', { parameters: [id()], responses: { '200': { description: 'Chi tiết lớp' }, '404': standard['404'] } }),
  },
  '/bookings/classes/{id}/register': {
    post: operation('Bookings', 'Member đăng ký lớp và tạo Order', { parameters: [id()], responses: created }),
  },
  '/bookings/registrations/{id}/cancel': {
    post: operation('Bookings', 'Hủy đăng ký trước 48 giờ và tự động hoàn tiền vào ví', { parameters: [id()], responses: ok }),
  },
  '/group-classes/{id}/waitlist': {
    post: operation('Waitlist', 'Tham gia danh sách chờ khi lớp đầy', { parameters: [id()], responses: created }),
  },
  '/group-classes/{id}/waitlist/respond': {
    post: operation('Waitlist', 'Chấp nhận hoặc từ chối lời mời waitlist', { parameters: [id()], requestBody: jsonBody(['accept'], { accept: { type: 'boolean' } }), responses: ok }),
  },
  '/private-courses': {
    get: operation('Private Courses', 'Danh sách khóa 1–1 đang cung cấp', { parameters: [query('sportId', { type: 'integer' })], responses: ok }),
    post: operation('Private Courses', 'Tạo khóa 1–1 nhiều buổi', { requestBody: jsonBody(['sportId', 'name', 'totalSessions', 'sessionDurationMinutes', 'validityDays', 'price'], { sportId: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, totalSessions: { type: 'integer', minimum: 2 }, sessionDurationMinutes: { type: 'integer', minimum: 1 }, validityDays: { type: 'integer', minimum: 1 }, price: { type: 'number', minimum: 0 } }), responses: created }),
  },
  '/private-courses/{id}': {
    patch: operation('Private Courses', 'Cập nhật khóa 1–1', { parameters: [id()], responses: ok }),
  },
  '/private-courses/{id}/coaches': {
    post: operation('Private Courses', 'Gán Coach đủ chuyên môn cho khóa', { parameters: [id()], requestBody: jsonBody(['coachId'], { coachId: { type: 'integer' }, customPrice: { type: 'number', minimum: 0 } }), responses: created }),
  },
  '/private-courses/{id}/coaches/{coachId}': {
    delete: operation('Private Courses', 'Ngừng Coach cung cấp khóa 1–1', { parameters: [id(), id('coachId')], responses: ok }),
  },
  '/private-courses/{id}/enroll': {
    post: operation('Private Enrollments', 'Mua khóa 1–1 và chọn lịch tuần cố định', { parameters: [id()], responses: created }),
  },
  '/private-courses/enrollments': {
    get: operation('Private Enrollments', 'Danh sách enrollment theo phạm vi role', { responses: ok }),
    post: operation('Private Enrollments', 'Tạo enrollment 1–1 cho Member hiện tại', { responses: created }),
  },
  '/private-courses/enrollments/{id}': {
    get: operation('Private Enrollments', 'Xem lịch, trạng thái và số buổi còn lại', { parameters: [id()], responses: ok }),
  },
  '/private-courses/enrollments/{id}/schedules': {
    post: operation('Private Enrollments', 'Thêm lịch cố định cho enrollment đã kích hoạt', { parameters: [id()], responses: created }),
  },
  '/private-courses/enrollments/{id}/schedules/{scheduleId}/attendance': {
    post: operation('Private Enrollments', 'Coach ghi nhận một buổi 1–1 đã hoàn thành', { parameters: [id(), id('scheduleId')], requestBody: jsonBody(['sessionDate'], { sessionDate: { type: 'string', format: 'date' } }), responses: created }),
  },
  '/sessions/{sessionId}/attendance': {
    get: operation('Attendance', 'Xem điểm danh của một buổi lớp nhóm', { parameters: [id('sessionId')], responses: ok }),
  },
  '/sessions/{sessionId}/check-in': {
    post: operation('Attendance', 'Coach ghi nhận điểm danh lớp nhóm', { parameters: [id('sessionId')], requestBody: jsonBody(['memberId', 'status'], { memberId: { type: 'integer' }, status: { type: 'string', enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] } }), responses: ok }),
  },
  '/reports/attendance': {
    get: operation('Reports', 'Báo cáo điểm danh', { parameters: [query('classId', { type: 'integer' })], responses: ok }),
  },
} as const
