// FR-66/67: tài liệu Swagger cho dạy thay, ca làm và chấm công
const security = [{ bearerAuth: [] }]
const coachTags = ['Session Coach']
const shiftTags = ['Staff Shifts']
const ok = (description: string) => ({ description })
const common = { '401': ok('Chưa đăng nhập'), '403': ok('Không đủ quyền') }
const pathInt = (name: string) => [{ name, in: 'path', required: true, schema: { type: 'integer' } }]
const query = (name: string, required = false, schema: object = { type: 'string', format: 'date' }) => ({ name, in: 'query', required, schema })
const json = (properties: object, required: string[] = []) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties, required } } } })
const dateTime = { type: 'string', format: 'date-time', example: '2026-11-20T08:00:00+07:00' }

export const workforcePaths = {
  '/coach-absences/private/me/sessions': { get: { tags: coachTags, security, summary: 'Coach xem các buổi 1–1 sắp tới có thể báo nghỉ', responses: { '200': ok('Danh sách'), ...common } } },
  '/coach-absences/private/me': {
    get: { tags: coachTags, security, summary: 'Coach xem yêu cầu báo nghỉ 1–1 của mình', responses: { '200': ok('Danh sách'), ...common } },
    post: { tags: coachTags, security, summary: 'Coach báo nghỉ một buổi 1–1 theo ngày của lịch lặp', requestBody: json({ scheduleId: { type: 'integer' }, sessionDate: { type: 'string', format: 'date' }, reason: { type: 'string' } }, ['scheduleId', 'sessionDate', 'reason']), responses: { '201': ok('Đã gửi Manager'), '409': ok('Buổi đã bắt đầu, hoàn thành hoặc đã báo nghỉ'), ...common } },
  },
  '/coach-absences/private': { get: { tags: coachTags, security, summary: 'Manager xem yêu cầu báo nghỉ buổi 1–1', responses: { '200': ok('Danh sách'), ...common } } },
  '/coach-absences/private/{id}/review': { post: { tags: coachTags, security, summary: 'Manager duyệt hủy buổi 1–1 hoặc từ chối', parameters: pathInt('id'), requestBody: json({ approve: { type: 'boolean' }, reason: { type: 'string' } }, ['approve']), responses: { '200': ok('Đã xử lý'), '409': ok('Buổi không còn đủ điều kiện hủy'), ...common } } },
  '/coach-absences/private/{id}/makeup': { post: { tags: coachTags, security, summary: 'Manager xếp buổi bù 1–1 trong 14 ngày và trước hạn khóa', parameters: pathInt('id'), requestBody: json({ coachId: { type: 'integer' }, roomId: { type: 'integer' }, startsAt: dateTime, endsAt: dateTime }, ['coachId', 'roomId', 'startsAt', 'endsAt']), responses: { '201': ok('Đã xếp bù'), '409': ok('Trùng lịch, thiếu availability hoặc quá hạn'), ...common } } },
  '/coach-absences/me': {
    get: { tags: coachTags, security, summary: 'Coach xem yêu cầu báo nghỉ của mình', responses: { '200': ok('Danh sách'), ...common } },
    post: { tags: coachTags, security, summary: 'Coach báo nghỉ một buổi chưa bắt đầu', requestBody: json({ sessionId: { type: 'integer' }, reason: { type: 'string' } }, ['sessionId', 'reason']), responses: { '201': ok('Đã gửi Manager'), '409': ok('Buổi đã bắt đầu hoặc đã báo nghỉ'), ...common } },
  },
  '/coach-absences': { get: { tags: coachTags, security, summary: 'Manager xem hàng đợi báo nghỉ và xếp bù', responses: { '200': ok('Danh sách'), ...common } } },
  '/coach-absences/{id}/review': { post: { tags: coachTags, security, summary: 'Manager duyệt hủy buổi hoặc từ chối báo nghỉ', parameters: pathInt('id'), requestBody: json({ approve: { type: 'boolean' }, reason: { type: 'string' } }, ['approve']), responses: { '200': ok('Đã xử lý'), '409': ok('Buổi không còn đủ điều kiện hủy'), ...common } } },
  '/coach-absences/{id}/makeup': { post: { tags: coachTags, security, summary: 'Manager xếp một buổi bù trong 14 ngày và trước hạn lớp', parameters: pathInt('id'), requestBody: json({ coachId: { type: 'integer' }, roomId: { type: 'integer' }, startsAt: dateTime, endsAt: dateTime }, ['coachId', 'roomId', 'startsAt', 'endsAt']), responses: { '201': ok('Đã xếp bù'), '409': ok('Trùng lịch, thiếu availability hoặc quá hạn'), ...common } } },
  '/session-coaches': {
    get: {
      tags: coachTags, security, summary: 'Manager xem coach dạy thực tế của các buổi (tối đa 31 ngày)',
      parameters: [query('from', true), query('to', true), query('coachId', false, { type: 'integer' }), query('changedOnly', false, { type: 'boolean' })],
      responses: { '200': ok('Danh sách buổi kèm coach lớp, coach dạy thực tế, người bị thay'), '400': ok('Khoảng ngày sai'), ...common },
    },
  },
  '/session-coaches/{sessionId}/candidates': {
    get: { tags: coachTags, security, summary: 'Coach có thể dạy thay (đúng môn, đang hoạt động, cờ rảnh/bận)', parameters: pathInt('sessionId'), responses: { '200': ok('Danh sách'), '404': ok('Không có buổi'), ...common } },
  },
  '/session-coaches/{sessionId}/substitute': {
    put: {
      tags: coachTags, security, summary: 'Giao người dạy thay cho buổi', parameters: pathInt('sessionId'),
      requestBody: json({ coachId: { type: 'integer' }, reason: { type: 'string' }, coachAbsent: { type: 'boolean', description: 'true = coach chính vắng (lỗi coach)' } }, ['coachId', 'reason']),
      responses: { '200': ok('Đã giao'), '409': ok('Sai môn, trùng lịch, trùng coach chính hoặc buổi đã khóa'), ...common },
    },
    delete: { tags: coachTags, security, summary: 'Hoàn tác dạy thay / coach vắng', parameters: pathInt('sessionId'), responses: { '200': ok('Đã trả về coach chính'), '409': ok('Không có gì để hoàn tác hoặc buổi đã khóa'), ...common } },
  },
  '/staff-shifts': {
    get: { tags: shiftTags, security, summary: 'Manager xem ca làm lễ tân', parameters: [query('from', true), query('to', true), query('staffId', false, { type: 'integer' })], responses: { '200': ok('Danh sách ca'), ...common } },
    post: {
      tags: shiftTags, security, summary: 'Manager xếp ca cho lễ tân',
      requestBody: json({ staffId: { type: 'integer' }, startsAt: dateTime, endsAt: dateTime, note: { type: 'string' } }, ['staffId', 'startsAt', 'endsAt']),
      responses: { '201': ok('Đã tạo'), '400': ok('Giờ ca sai'), '409': ok('Không phải lễ tân, trùng ca, ca đã kết thúc'), ...common },
    },
  },
  '/staff-shifts/{id}': {
    patch: { tags: shiftTags, security, summary: 'Manager sửa ca chưa vào làm', parameters: pathInt('id'), requestBody: json({ startsAt: dateTime, endsAt: dateTime, note: { type: 'string', nullable: true } }), responses: { '200': ok('Đã sửa'), '409': ok('Ca đã vào làm/đã hủy'), ...common } },
  },
  '/staff-shifts/{id}/cancel': {
    post: { tags: shiftTags, security, summary: 'Manager hủy ca chưa vào làm', parameters: pathInt('id'), requestBody: json({ reason: { type: 'string' } }, ['reason']), responses: { '200': ok('Đã hủy'), ...common } },
  },
  '/staff-shifts/me': {
    get: { tags: shiftTags, security, summary: 'Lễ tân xem ca của mình + tổng hợp', parameters: [query('from', true), query('to', true)], responses: { '200': ok('Ca và tổng hợp'), ...common } },
  },
  '/staff-shifts/{id}/clock-in': {
    post: { tags: shiftTags, security, summary: 'Lễ tân vào ca (từ 30 phút trước giờ bắt đầu)', parameters: pathInt('id'), responses: { '200': ok('Đã vào ca'), '409': ok('Ngoài khung giờ hoặc đã vào'), ...common } },
  },
  '/staff-shifts/{id}/clock-out': {
    post: { tags: shiftTags, security, summary: 'Lễ tân ra ca (tối đa 4 giờ sau giờ kết thúc)', parameters: pathInt('id'), responses: { '200': ok('Đã ra ca'), '409': ok('Chưa vào ca hoặc quá hạn'), ...common } },
  },
  '/staff-shifts/{id}/adjustments': {
    post: {
      tags: shiftTags, security, summary: 'Lễ tân xin sửa giờ vào/ra', parameters: pathInt('id'),
      requestBody: json({ clockInAt: dateTime, clockOutAt: dateTime, reason: { type: 'string' } }, ['reason']),
      responses: { '201': ok('Đã gửi, chờ duyệt'), '409': ok('Đang có yêu cầu chờ hoặc ngoài thời hạn'), ...common },
    },
  },
  '/staff-shifts/adjustments': {
    get: { tags: shiftTags, security, summary: 'Manager xem yêu cầu sửa công', parameters: [query('status', false, { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] })], responses: { '200': ok('Danh sách'), ...common } },
  },
  '/staff-shifts/adjustments/{id}/approve': {
    post: { tags: shiftTags, security, summary: 'Manager duyệt sửa công (ghi vào ca, lưu giờ cũ)', parameters: pathInt('id'), requestBody: json({ note: { type: 'string' } }), responses: { '200': ok('Đã duyệt'), ...common } },
  },
  '/staff-shifts/adjustments/{id}/reject': {
    post: { tags: shiftTags, security, summary: 'Manager từ chối sửa công (bắt buộc lý do)', parameters: pathInt('id'), requestBody: json({ note: { type: 'string' } }, ['note']), responses: { '200': ok('Đã từ chối'), ...common } },
  },
}
