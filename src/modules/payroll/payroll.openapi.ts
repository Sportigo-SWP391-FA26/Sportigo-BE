const manager = { security: [{ bearerAuth: [] }], tags: ['Payroll'], responses: { '200': { description: 'Thành công' }, '403': { description: 'Chỉ Center Manager' } } }
const own = { security: [{ bearerAuth: [] }], tags: ['Payroll'], responses: { '200': { description: 'Chỉ dữ liệu của chính nhân sự' }, '403': { description: 'Không có quyền' } } }
const month = [{ name: 'month', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } }]
const staffId = [{ name: 'staffId', in: 'path', required: true, schema: { type: 'integer' } }]
const json = (required: string[], properties: Record<string, unknown>) => ({ required: true, content: { 'application/json': { schema: { type: 'object', required, properties } } } })

export const payrollPaths = {
  '/payroll/me/performance': { get: { ...own, summary: 'Hiệu suất cá nhân Coach hoặc lễ tân' } },
  '/payroll/me/payslips': { get: { ...own, summary: 'Danh sách phiếu lương đã duyệt của tôi' } },
  '/payroll/me/payslips/{month}': { get: { ...own, summary: 'Phiếu lương của tôi', parameters: month } },
  '/payroll/me/payslips/{month}/pdf': { get: { ...own, summary: 'Tải phiếu lương PDF', parameters: month } },
  '/payroll/compensations/{staffId}': {
    get: { ...manager, summary: 'Lịch sử lương cơ bản', parameters: staffId },
    put: { ...manager, summary: 'Đặt lương cơ bản theo tháng hiệu lực', parameters: staffId, requestBody: json(['baseSalary', 'effectiveFromMonth'], { baseSalary: { type: 'integer', minimum: 0 }, effectiveFromMonth: { type: 'string', example: '2026-11' }, effectiveToMonth: { type: 'string', nullable: true } }) },
  },
  '/payroll/recurring-items/{staffId}': {
    get: { ...manager, summary: 'Phụ cấp và khấu trừ định kỳ', parameters: staffId },
    post: { ...manager, summary: 'Thêm khoản định kỳ', parameters: staffId, requestBody: json(['name', 'kind', 'amount', 'effectiveFromMonth'], { name: { type: 'string' }, kind: { type: 'string', enum: ['ALLOWANCE', 'DEDUCTION'] }, amount: { type: 'integer', minimum: 0 }, effectiveFromMonth: { type: 'string' }, effectiveToMonth: { type: 'string', nullable: true } }) },
  },
  '/payroll/recurring-items/{id}': { patch: { ...manager, summary: 'Sửa hoặc tắt khoản định kỳ', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }] } },
  '/payroll/periods': { get: { ...manager, summary: 'Danh sách kỳ lương' } },
  '/payroll/periods/{month}': { get: { ...manager, summary: 'Bảng lương tháng', parameters: month } },
  '/payroll/periods/{month}/build': { post: { ...manager, summary: 'Tính hoặc tính lại bảng lương nháp', parameters: month } },
  '/payroll/periods/{month}/approve': { post: { ...manager, summary: 'Duyệt và khóa bảng lương', parameters: month } },
  '/payroll/periods/{month}/export': { get: { ...manager, summary: 'Xuất bảng lương Excel', parameters: month } },
  '/payroll/performance/export': { get: { ...manager, summary: 'Xuất hiệu suất nhân sự Excel' } },
} as const
