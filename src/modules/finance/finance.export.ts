import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

type FinancialReport = Awaited<ReturnType<typeof import('./finance.service.js').financialReportData>>

const COLORS = { navy: 'FF0F2B5C', blue: 'FF2563EB', sky: 'FF38BDF8', lime: 'FF84CC16', orange: 'FFF97316', ink: 'FF121B2E', muted: 'FF64748B', line: 'FFE2E8F0', canvas: 'FFF8FAFC', white: 'FFFFFFFF', danger: 'FFDC2626' }
const moneyFormat = '#,##0 "₫";[Red]-#,##0 "₫";–'
const dateTimeFormat = 'dd/mm/yyyy hh:mm'
const channelLabels: Record<string, string> = { ONLINE: 'VNPay', COUNTER: 'Tiền mặt tại quầy', WALLET: 'Ví Sportigo' }
const serviceLabels: Record<string, string> = { GROUP_CLASS: 'Lớp nhóm', PRIVATE_COURSE: 'Khóa 1–1' }
const statusLabels: Record<string, string> = { SUCCESS: 'Thành công', PARTIALLY_REFUNDED: 'Hoàn một phần', REFUNDED: 'Đã hoàn', REQUESTED: 'Đã yêu cầu', UNDER_REVIEW: 'Đang xét duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', COMPLETED: 'Hoàn tất' }

function applySheetDefaults(sheet: ExcelJS.Worksheet, frozenRow = 1) {
  sheet.views = [{ state: 'frozen', ySplit: frozenRow }]
  sheet.properties.defaultRowHeight = 20
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  sheet.headerFooter.oddFooter = 'Sportigo · More than a workout                                      Trang &P / &N'
}

function styleTable(sheet: ExcelJS.Worksheet, headerRow: number, lastRow: number, moneyColumns: number[] = [], dateColumns: number[] = []) {
  const header = sheet.getRow(headerRow)
  header.height = 30
  header.font = { bold: true, color: { argb: COLORS.white }, size: 10 }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } }
  header.alignment = { vertical: 'middle', wrapText: true }
  for (let rowIndex = headerRow + 1; rowIndex <= Math.max(headerRow + 1, lastRow); rowIndex += 1) {
    const row = sheet.getRow(rowIndex)
    row.alignment = { vertical: 'middle', wrapText: true }
    if ((rowIndex - headerRow) % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.canvas } }
    row.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: COLORS.line } } } })
  }
  moneyColumns.forEach((column) => { sheet.getColumn(column).numFmt = moneyFormat })
  dateColumns.forEach((column) => { sheet.getColumn(column).numFmt = dateTimeFormat })
  if (lastRow >= headerRow) sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastRow, column: sheet.columnCount } }
}

function addTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, lastColumn: number) {
  sheet.mergeCells(1, 1, 1, lastColumn)
  sheet.getCell(1, 1).value = 'SPORTIGO'
  sheet.getCell(1, 1).font = { bold: true, color: { argb: COLORS.blue }, size: 13 }
  sheet.mergeCells(2, 1, 2, lastColumn)
  sheet.getCell(2, 1).value = title
  sheet.getCell(2, 1).font = { bold: true, color: { argb: COLORS.ink }, size: 21 }
  sheet.mergeCells(3, 1, 3, lastColumn)
  sheet.getCell(3, 1).value = subtitle
  sheet.getCell(3, 1).font = { color: { argb: COLORS.muted }, size: 10 }
  sheet.getRow(2).height = 30
}

export async function toRevenueWorkbook(report: FinancialReport) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Sportigo'
  workbook.company = 'Sportigo'
  workbook.subject = 'Báo cáo tài chính'
  workbook.created = new Date()
  workbook.calcProperties.fullCalcOnLoad = true
  const periodLabel = `${report.period.from.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} – ${report.period.to.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
  const filterLabel = `Kỳ báo cáo: ${periodLabel} · Kênh: ${report.filters.channel ? channelLabels[report.filters.channel] : 'Tất cả'} · Dịch vụ: ${report.filters.itemType ? serviceLabels[report.filters.itemType] : 'Tất cả'}`

  const summary = workbook.addWorksheet('Tổng quan', { properties: { tabColor: { argb: COLORS.blue } } })
  summary.columns = [{ width: 26 }, { width: 20 }, { width: 4 }, { width: 26 }, { width: 20 }, { width: 4 }, { width: 26 }, { width: 20 }]
  addTitle(summary, 'BÁO CÁO TÀI CHÍNH', `${filterLabel} · Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`, 8)
  const metrics = [
    ['Doanh thu gộp', report.gross, COLORS.blue], ['Giảm giá', report.discount, COLORS.orange], ['Hoàn tiền', report.refunds, COLORS.danger],
    ['Doanh thu thuần', report.net, COLORS.lime], ['Số giao dịch', report.transactions, COLORS.sky], ['Nạp ví (không tính doanh thu)', report.walletTopUps, COLORS.navy],
  ] as const
  metrics.forEach(([label, value, color], index) => {
    const row = 5 + Math.floor(index / 3) * 3
    const column = 1 + (index % 3) * 3
    summary.mergeCells(row, column, row, column + 1)
    summary.getCell(row, column).value = label
    summary.getCell(row, column).font = { color: { argb: COLORS.muted }, size: 10, bold: true }
    summary.mergeCells(row + 1, column, row + 1, column + 1)
    summary.getCell(row + 1, column).value = value
    summary.getCell(row + 1, column).numFmt = label === 'Số giao dịch' ? '#,##0' : moneyFormat
    summary.getCell(row + 1, column).font = { color: { argb: color }, size: 18, bold: true }
    summary.getCell(row + 1, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.canvas } }
  })
  summary.getCell('A12').value = 'Doanh thu thuần theo kênh'
  summary.getCell('A12').font = { bold: true, size: 13, color: { argb: COLORS.ink } }
  summary.getRow(13).values = ['Kênh thanh toán', 'Doanh thu thuần']
  Object.entries(report.byChannel).forEach(([channel, value]) => summary.addRow([channelLabels[channel] ?? channel, value]))
  if (Object.keys(report.byChannel).length === 0) summary.addRow(['Không có dữ liệu trong kỳ', 0])
  styleTable(summary, 13, summary.rowCount, [2])
  summary.getCell('D12').value = 'Doanh thu theo dịch vụ'
  summary.getCell('D12').font = { bold: true, size: 13, color: { argb: COLORS.ink } }
  summary.getRow(13).getCell(4).value = 'Loại dịch vụ'
  summary.getRow(13).getCell(5).value = 'Số đơn'
  summary.getRow(13).getCell(6).value = 'Doanh thu thuần'
  const serviceEntries = Object.entries(report.byService)
  serviceEntries.forEach(([service, value], index) => {
    const row = 14 + index
    summary.getCell(row, 4).value = serviceLabels[service] ?? service
    summary.getCell(row, 5).value = value.orders
    summary.getCell(row, 6).value = value.net
    summary.getCell(row, 6).numFmt = moneyFormat
  })
  if (serviceEntries.length === 0) summary.getCell('D14').value = 'Không có dữ liệu trong kỳ'
  applySheetDefaults(summary, 3)

  const transactions = workbook.addWorksheet('Chi tiết giao dịch', { properties: { tabColor: { argb: COLORS.sky } } })
  transactions.columns = [18, 20, 21, 24, 18, 34, 18, 18, 18, 19, 19, 18, 22, 20, 18, 18].map((width) => ({ width }))
  addTitle(transactions, 'CHI TIẾT GIAO DỊCH', filterLabel, 16)
  transactions.getRow(5).values = ['Ngày thanh toán', 'Mã giao dịch', 'Mã đơn', 'Hội viên', 'Mã hội viên', 'Dịch vụ', 'Giá gốc', 'Giảm giá', 'Thanh toán', 'Kênh', 'Phương thức', 'Trạng thái', 'Người thu', 'Hóa đơn', 'Hoàn tiền', 'Doanh thu thuần']
  for (const payment of report.payments) {
    const serviceItems = payment.order.items.filter((item) => item.itemType !== 'WALLET_TOP_UP')
    const refund = payment.adjustments.reduce((sum, item) => sum + Number(item.amount), 0)
    transactions.addRow([
      payment.paidAt, payment.reference, payment.order.orderNumber, payment.order.member.user.displayName, payment.order.member.memberCode,
      serviceItems.map((item) => item.itemNameSnapshot).join(', '), Number(payment.order.originalAmount), Number(payment.order.discountAmount), Number(payment.amount),
      channelLabels[payment.channel] ?? payment.channel, payment.paymentMethod.name, statusLabels[payment.status] ?? payment.status,
      payment.collectedBy?.displayName ?? '—', payment.order.invoice?.invoiceNumber ?? '—', refund, Number(payment.amount) - refund,
    ])
  }
  if (report.payments.length === 0) transactions.addRow(['Không có dữ liệu trong kỳ'])
  styleTable(transactions, 5, transactions.rowCount, [7, 8, 9, 15, 16], [1])
  applySheetDefaults(transactions, 5)

  const services = workbook.addWorksheet('Doanh thu dịch vụ', { properties: { tabColor: { argb: COLORS.lime } } })
  services.columns = [28, 16, 18, 20, 20, 20, 20].map((width) => ({ width }))
  addTitle(services, 'DOANH THU THEO DỊCH VỤ', filterLabel, 7)
  services.getRow(5).values = ['Loại dịch vụ', 'Số đơn', 'Số giao dịch', 'Doanh thu gộp', 'Giảm giá', 'Hoàn tiền', 'Doanh thu thuần']
  for (const [service, value] of Object.entries(report.byService)) services.addRow([serviceLabels[service] ?? service, value.orders, value.transactions, value.gross, value.discount, value.refunds, value.net])
  if (Object.keys(report.byService).length === 0) services.addRow(['Không có dữ liệu trong kỳ'])
  styleTable(services, 5, services.rowCount, [4, 5, 6, 7])
  applySheetDefaults(services, 5)

  const refunds = workbook.addWorksheet('Hoàn tiền', { properties: { tabColor: { argb: COLORS.orange } } })
  refunds.columns = [18, 24, 28, 21, 32, 21, 19, 19, 38, 18, 23, 19].map((width) => ({ width }))
  addTitle(refunds, 'YÊU CẦU HOÀN TIỀN', filterLabel, 12)
  refunds.getRow(5).values = ['Ngày yêu cầu', 'Hội viên', 'Email', 'Mã đơn', 'Dịch vụ', 'Mã giao dịch', 'Số tiền yêu cầu', 'Số tiền duyệt', 'Lý do', 'Trạng thái', 'Người duyệt', 'Hoàn tất lúc']
  for (const request of report.refundRequests) refunds.addRow([request.requestedAt, request.member.user.displayName, request.member.user.email, request.orderItem.order.orderNumber, request.orderItem.itemNameSnapshot, request.payment?.reference ?? (request.adjustments.map((item) => item.payment.reference).join(', ') || '—'), Number(request.requestedAmount), request.approvedAmount ? Number(request.approvedAmount) : null, request.reason, statusLabels[request.status] ?? request.status, request.reviewedBy?.displayName ?? '—', request.completedAt])
  if (report.refundRequests.length === 0) refunds.addRow(['Không có dữ liệu trong kỳ'])
  styleTable(refunds, 5, refunds.rowCount, [7, 8], [1, 12])
  applySheetDefaults(refunds, 5)

  const reconciliation = workbook.addWorksheet('Đối soát kênh', { properties: { tabColor: { argb: COLORS.navy } } })
  reconciliation.columns = [30, 18, 22, 22, 22, 42].map((width) => ({ width }))
  addTitle(reconciliation, 'ĐỐI SOÁT KÊNH THANH TOÁN', `${filterLabel} · Nạp ví được tách riêng và không cộng vào doanh thu dịch vụ`, 6)
  reconciliation.getRow(5).values = ['Kênh', 'Số giao dịch', 'Tổng thu', 'Hoàn tiền', 'Giá trị thuần', 'Ghi chú']
  for (const channel of ['ONLINE', 'COUNTER', 'WALLET']) {
    const channelPayments = report.payments.filter((payment) => payment.channel === channel)
    const channelGross = channelPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    const channelRefunds = report.refundAdjustments.filter((adjustment) => adjustment.payment.channel === channel).reduce((sum, item) => sum + Number(item.amount), 0)
    reconciliation.addRow([channelLabels[channel], channelPayments.length, channelGross, channelRefunds, channelGross - channelRefunds, channel === 'WALLET' ? 'Doanh thu được ghi nhận khi ví thanh toán dịch vụ.' : ''])
  }
  reconciliation.addRow(['Nạp ví Sportigo', report.walletTopUpPayments.length, report.walletTopUps, 0, report.walletTopUps, 'Khoản giữ hộ/số dư ví; không tính vào doanh thu dịch vụ.'])
  styleTable(reconciliation, 5, reconciliation.rowCount, [3, 4, 5])
  applySheetDefaults(reconciliation, 5)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function toClassWorkbook(rows: { id: number; name: string; capacity: number; confirmed: number; waitlist: number; occupancyRate: number; attendanceRate: number }[]) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Class Operations')
  sheet.columns = [{ header: 'Class ID', key: 'id', width: 12 }, { header: 'Class', key: 'name', width: 32 }, { header: 'Capacity', key: 'capacity', width: 14 }, { header: 'Confirmed', key: 'confirmed', width: 14 }, { header: 'Waitlist', key: 'waitlist', width: 12 }, { header: 'Occupancy', key: 'occupancy', width: 15 }, { header: 'Attendance', key: 'attendance', width: 15 }]
  sheet.addRows(rows.map((row) => ({ ...row, occupancy: row.occupancyRate, attendance: row.attendanceRate }))); sheet.getColumn('occupancy').numFmt = '0.00%'; sheet.getColumn('attendance').numFmt = '0.00%'
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; sheet.views = [{ state: 'frozen', ySplit: 1 }]
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function simplePdf(title: string, lines: string[]) { const document = new PDFDocument({ size: 'A4', margin: 48 }); const chunks: Buffer[] = []; document.on('data', (chunk) => chunks.push(Buffer.from(chunk))); const done = new Promise<Buffer>((resolve) => document.on('end', () => resolve(Buffer.concat(chunks)))); document.fontSize(20).fillColor('#0f2b5c').text(title); document.moveDown().fontSize(10).fillColor('#334155'); for (const line of lines) document.text(line, { paragraphGap: 6 }); document.end(); return done }
export function toRevenuePdf(report: { gross: number; refunds: number; net: number; transactions: number; byChannel: Record<string, number> }) { return simplePdf('SPORTIGO REVENUE REPORT', [`Gross: ${report.gross.toLocaleString('vi-VN')} VND`, `Refunds: ${report.refunds.toLocaleString('vi-VN')} VND`, `Net: ${report.net.toLocaleString('vi-VN')} VND`, `Transactions: ${report.transactions}`, ...Object.entries(report.byChannel).map(([key, value]) => `${key}: ${value.toLocaleString('vi-VN')} VND`)]) }
export function toClassPdf(rows: { id: number; name: string; capacity: number; confirmed: number; waitlist: number; occupancyRate: number; attendanceRate: number }[]) { return simplePdf('SPORTIGO CLASS OPERATIONS REPORT', rows.map((row) => `#${row.id} ${row.name} | ${row.confirmed}/${row.capacity} | waitlist ${row.waitlist} | occupancy ${(row.occupancyRate * 100).toFixed(1)}% | attendance ${(row.attendanceRate * 100).toFixed(1)}%`)) }

export function toInvoicePdf(invoice: { invoiceNumber: string; issuedAt: Date; subtotal: unknown; discountAmount: unknown; totalAmount: unknown; order: { orderNumber: string; member: { user: { displayName: string; email: string } }; items: { itemNameSnapshot: string; finalAmount: unknown }[] } }) {
  const document = new PDFDocument({ size: 'A4', margin: 54 })
  const chunks: Buffer[] = []
  document.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const done = new Promise<Buffer>((resolve) => document.on('end', () => resolve(Buffer.concat(chunks))))
  document.fontSize(24).fillColor('#0f2b5c').text('SPORTIGO INVOICE')
  document.moveDown().fontSize(11).fillColor('#334155')
  document.text(`Invoice: ${invoice.invoiceNumber}`)
  document.text(`Order: ${invoice.order.orderNumber}`)
  document.text(`Issued: ${invoice.issuedAt.toISOString()}`)
  document.text(`Member: ${invoice.order.member.user.displayName} (${invoice.order.member.user.email})`)
  document.moveDown().fontSize(12).fillColor('#0f172a')
  for (const item of invoice.order.items) document.text(`${item.itemNameSnapshot}  -  ${Number(item.finalAmount).toLocaleString('vi-VN')} VND`)
  document.moveDown().text(`Subtotal: ${Number(invoice.subtotal).toLocaleString('vi-VN')} VND`)
  document.text(`Discount: ${Number(invoice.discountAmount).toLocaleString('vi-VN')} VND`)
  document.fontSize(16).fillColor('#2563eb').text(`Total: ${Number(invoice.totalAmount).toLocaleString('vi-VN')} VND`)
  document.end()
  return done
}
