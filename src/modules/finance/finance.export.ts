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
