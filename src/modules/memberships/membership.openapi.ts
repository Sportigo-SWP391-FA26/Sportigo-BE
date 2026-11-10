const security = [{ bearerAuth: [] }]
const tags = ['Membership']
const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
const json = (properties: object) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties } } } })

const planBody = json({
  name: { type: 'string' },
  durationMonths: { type: 'integer', example: 3 },
  price: { type: 'number' },
  description: { type: 'string', nullable: true },
  status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] },
})
const purchaseBody = json({ planId: { type: 'integer' } })
const ok = (description: string) => ({ description })
const common = { '401': ok('Chưa đăng nhập'), '403': ok('Không đủ quyền') }

export const membershipPaths = {
  '/memberships/plans': {
    get: { tags, summary: 'Danh sách gói đang mở bán', responses: { '200': ok('Danh sách gói') } },
  },
  '/memberships/plans/manage': {
    get: { tags, security, summary: 'Manager xem mọi gói', responses: { '200': ok('Danh sách gói'), ...common } },
    post: { tags, security, summary: 'Tạo gói', requestBody: planBody, responses: { '201': ok('Đã tạo'), ...common } },
  },
  '/memberships/plans/manage/{id}': {
    patch: { tags, security, summary: 'Cập nhật gói', parameters: idParam, requestBody: planBody, responses: { '200': ok('Đã cập nhật'), ...common } },
    delete: { tags, security, summary: 'Xóa gói bản nháp chưa có người mua', parameters: idParam, responses: { '204': ok('Đã xóa'), '409': ok('Không được xóa'), ...common } },
  },
  '/memberships/purchase': {
    post: { tags, security, summary: 'Member tạo đơn mua gói', requestBody: purchaseBody, responses: { '201': ok('Đơn giữ trong 15 phút'), '409': ok('Gói không mở bán hoặc đã có đơn chờ'), ...common } },
  },
  '/members/{id}/memberships': {
    post: { tags, security, summary: 'Lễ tân tạo đơn mua gói cho hội viên', parameters: idParam, requestBody: purchaseBody, responses: { '201': ok('Đơn chờ thu tiền'), ...common } },
  },
  '/members/me/membership': {
    get: { tags, security, summary: 'Gói hiện tại, gói nối tiếp và lịch sử', responses: { '200': ok('Thông tin gói'), ...common } },
  },
  '/members/me/check-ins': {
    get: { tags, security, summary: 'Lịch sử check-in của tôi', responses: { '200': ok('Danh sách'), ...common } },
  },
  '/check-ins': {
    post: {
      tags, security, summary: 'Check-in phòng tập bằng mã QR hoặc mã thành viên',
      requestBody: json({ memberCode: { type: 'string', example: 'SG7K2P9X' }, method: { type: 'string', enum: ['QR', 'MANUAL'] } }),
      responses: { '201': ok('Đã check-in'), '200': ok('Quét lặp trong 5 phút, trả lần trước'), '404': ok('MEMBER_NOT_FOUND'), '409': ok('ACCOUNT_INACTIVE hoặc NO_ACTIVE_MEMBERSHIP'), ...common },
    },
    get: { tags, security, summary: 'Lượt check-in gần đây', responses: { '200': ok('Danh sách'), ...common } },
  },
}
