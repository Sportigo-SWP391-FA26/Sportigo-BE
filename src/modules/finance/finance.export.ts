import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

export async function toRevenueWorkbook(report: { gross: number; refunds: number; net: number; transactions: number; byChannel: Record<string, number> }) {
  const workbook = new ExcelJS.Workbook()
  const summary = workbook.addWorksheet('Revenue Summary')
  summary.columns = [{ header: 'Metric', key: 'metric', width: 28 }, { header: 'Value (VND)', key: 'value', width: 20 }]
  summary.addRows([{ metric: 'Gross revenue', value: report.gross }, { metric: 'Refunds', value: report.refunds }, { metric: 'Net revenue', value: report.net }, { metric: 'Transactions', value: report.transactions }])
  const channels = workbook.addWorksheet('By Channel')
  channels.columns = [{ header: 'Channel', key: 'channel', width: 24 }, { header: 'Net revenue (VND)', key: 'value', width: 22 }]
  channels.addRows(Object.entries(report.byChannel).map(([channel, value]) => ({ channel, value })))
  for (const sheet of workbook.worksheets) { sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; sheet.views = [{ state: 'frozen', ySplit: 1 }] }
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
