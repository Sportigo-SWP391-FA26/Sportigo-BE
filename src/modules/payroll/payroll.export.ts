import ExcelJS from 'exceljs'
import type { getPeriod } from './payroll.service.js'
import type { getStaffPerformance } from '../users/staff-performance.service.js'

const C = { navy: 'FF0B1F3A', blue: 'FF2463E8', sky: 'FFEAF2FF', white: 'FFFFFFFF', muted: 'FF61738E', line: 'FFDCE5F1', orange: 'FFFFEBD7', green: 'FFE7F6E7' }
const money = '#,##0 "₫";[Red](#,##0 "₫")'
type Period = Awaited<ReturnType<typeof getPeriod>>
type Performance = Awaited<ReturnType<typeof getStaffPerformance>>

function setup(sheet: ExcelJS.Worksheet, widths: number[], headerRow: number) {
  sheet.columns = widths.map((width) => ({ width }))
  sheet.views = [{ state: 'frozen', ySplit: headerRow }]
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: widths.length } }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  sheet.getRow(headerRow).height = 30
  sheet.getRow(headerRow).eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } }; cell.font = { bold: true, color: { argb: C.white }, size: 10 }; cell.alignment = { vertical: 'middle', wrapText: true } })
  sheet.properties.defaultRowHeight = 23
}

function title(sheet: ExcelJS.Worksheet, lastColumn: number, heading: string, subtitle: string) {
  sheet.mergeCells(1, 1, 1, lastColumn)
  const first = sheet.getCell(1, 1)
  first.value = 'SPORTIGO  /  BÁO CÁO NHÂN SỰ'
  first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } }
  first.font = { bold: true, color: { argb: C.white }, size: 11 }
  first.alignment = { vertical: 'middle', indent: 1 }
  sheet.getRow(1).height = 30
  sheet.mergeCells(2, 1, 2, lastColumn)
  sheet.getCell(2, 1).value = heading
  sheet.getCell(2, 1).font = { bold: true, color: { argb: C.navy }, size: 19 }
  sheet.getRow(2).height = 38
  sheet.mergeCells(3, 1, 3, lastColumn)
  sheet.getCell(3, 1).value = subtitle
  sheet.getCell(3, 1).font = { color: { argb: C.muted }, size: 10 }
  sheet.getRow(3).height = 25
}

function stripe(sheet: ExcelJS.Worksheet, from: number, to: number, lastColumn: number) {
  for (let row = from; row <= to; row++) {
    sheet.getRow(row).height = 29
    for (let col = 1; col <= lastColumn; col++) {
      const cell = sheet.getCell(row, col)
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } }
      if ((row - from) % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sky } }
    }
  }
}

export async function payrollWorkbook(period: Period): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  book.creator = 'Sportigo'
  book.subject = 'Bảng lương nhân sự'
  const sheet = book.addWorksheet('Bảng lương', { properties: { tabColor: { argb: C.blue } } })
  const issueCount = period.entries.reduce((sum, entry) => sum + (Array.isArray(entry.reviewIssues) ? entry.reviewIssues.length : 0), 0)
  title(sheet, 12, `BẢNG LƯƠNG THÁNG ${period.month}`, `${period.status === 'APPROVED' ? 'ĐÃ DUYỆT' : 'BẢN NHÁP · CHƯA CHỐT'}  |  ${period.entries.length} nhân sự  |  ${issueCount} mục cần đối soát  |  Đơn vị: VND`)
  sheet.mergeCells('A5:C5'); sheet.getCell('A5').value = 'TỔNG THỰC NHẬN'
  sheet.mergeCells('A6:C6'); sheet.getCell('A6').value = period.entries.reduce((sum, entry) => sum + Number(entry.netAmount), 0)
  sheet.getCell('A6').numFmt = money; sheet.getCell('A6').font = { bold: true, size: 18, color: { argb: C.blue } }
  sheet.mergeCells('E5:G5'); sheet.getCell('E5').value = 'NHÂN SỰ'; sheet.mergeCells('E6:G6'); sheet.getCell('E6').value = period.entries.length
  sheet.mergeCells('I5:L5'); sheet.getCell('I5').value = 'MỤC CẦN ĐỐI SOÁT'; sheet.mergeCells('I6:L6'); sheet.getCell('I6').value = issueCount
  for (const ref of ['A5', 'E5', 'I5']) sheet.getCell(ref).font = { bold: true, color: { argb: C.muted }, size: 10 }
  for (const ref of ['E6', 'I6']) sheet.getCell(ref).font = { bold: true, size: 18, color: { argb: C.blue } }
  sheet.getRow(6).height = 35
  sheet.getRow(8).values = ['Nhân sự', 'Mã', 'Vai trò', 'Lương cơ bản', 'Ca/buổi dự kiến', 'Ca/buổi vắng', 'Trừ vắng', 'Bù ca', 'Phụ cấp', 'Khấu trừ', 'Thực nhận', 'Đối soát']
  for (const entry of period.entries) sheet.addRow([entry.staffName, entry.staffCode, entry.role === 'COACH' ? 'Coach' : 'Lễ tân', Number(entry.baseSalary), entry.scheduledUnits, entry.absentUnits, Number(entry.absenceDeduction), Number(entry.makeupCredit), Number(entry.allowanceTotal), Number(entry.deductionTotal), Number(entry.netAmount), (Array.isArray(entry.reviewIssues) ? entry.reviewIssues : []).join('; ') || 'Đã đối soát'])
  setup(sheet, [24, 22, 13, 18, 15, 15, 18, 16, 16, 16, 20, 62], 8)
  stripe(sheet, 9, 8 + period.entries.length, 12)
  for (let row = 9; row <= 8 + period.entries.length; row++) {
    for (const col of [4, 7, 8, 9, 10, 11]) sheet.getCell(row, col).numFmt = money
    sheet.getCell(row, 11).font = { bold: true, color: { argb: C.blue } }
    const issue = sheet.getCell(row, 12)
    issue.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: issue.value === 'Đã đối soát' ? C.green : C.orange } }
    if (issue.value !== 'Đã đối soát') sheet.getRow(row).height = 44
  }
  if (!period.entries.length) sheet.getCell('A9').value = 'Không có dữ liệu trong kỳ'
  return Buffer.from(await book.xlsx.writeBuffer())
}

export async function performanceWorkbook(report: Performance): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  book.creator = 'Sportigo'
  book.subject = 'Hiệu suất nhân sự'
  const period = `${report.from} – ${report.to}`
  const summary = book.addWorksheet('Tổng quan', { properties: { tabColor: { argb: C.blue } } })
  title(summary, 5, 'HIỆU SUẤT NHÂN SỰ', `Kỳ báo cáo: ${period}  |  Số liệu từ hoạt động đã ghi nhận`)
  summary.getRow(5).values = ['Chỉ số', 'Giá trị', 'Chỉ số', 'Giá trị']
  const metrics = [['Buổi lớp nhóm', report.totals.groupSessionsHeld, 'Buổi 1–1', report.totals.privateSessions], ['Yêu cầu hỗ trợ đã xử lý', report.totals.supportResolved, 'Hội viên mới', report.totals.membersCreated], ['Tiền mặt đã thu', report.totals.cashCollected, 'Số Coach', report.coaches.length], ['Số lễ tân', report.receptionists.length, '', '']]
  metrics.forEach((row) => summary.addRow(row))
  setup(summary, [32, 22, 32, 22, 4], 5)
  stripe(summary, 6, 9, 4)
  summary.getCell('B8').numFmt = money
  const coaches = book.addWorksheet('Hiệu suất Coach', { properties: { tabColor: { argb: C.blue } } })
  title(coaches, 9, 'HIỆU SUẤT COACH', `Kỳ báo cáo: ${period}  |  Tỷ lệ tham dự để trống khi chưa có điểm danh`)
  coaches.getRow(5).values = ['Coach', 'Mã nhân sự', 'Buổi nhóm', 'Đã điểm danh', 'Buổi 1–1', 'Tỷ lệ tham dự', 'Đánh giá', 'Học viên đang tập', 'Trạng thái']
  report.coaches.forEach((v) => coaches.addRow([v.displayName, v.staffCode, v.groupSessionsHeld, v.groupSessionsMarked, v.privateSessions, v.attendanceRate, v.assessments, v.activeTrainees, v.coachStatus ?? v.accountStatus]))
  setup(coaches, [27, 25, 16, 17, 16, 20, 15, 22, 20], 5)
  stripe(coaches, 6, 5 + report.coaches.length, 9)
  for (let row = 6; row <= 5 + report.coaches.length; row++) coaches.getCell(row, 6).numFmt = '0.0%'
  const reception = book.addWorksheet('Hiệu suất lễ tân', { properties: { tabColor: { argb: C.blue } } })
  title(reception, 8, 'HIỆU SUẤT LỄ TÂN', `Kỳ báo cáo: ${period}  |  Tiền mặt đã thu không phải tiền lương`)
  reception.getRow(5).values = ['Nhân sự', 'Mã nhân sự', 'Đã xử lý', 'Đang xử lý', 'Xử lý TB (giờ)', 'Giao dịch tiền mặt', 'Tiền mặt đã thu', 'Hội viên mới']
  report.receptionists.forEach((v) => reception.addRow([v.displayName, v.staffCode, v.supportResolved, v.supportInProgress, v.avgResolutionHours, v.cashPayments, v.cashCollected, v.membersCreated]))
  setup(reception, [27, 25, 17, 17, 19, 22, 23, 17], 5)
  stripe(reception, 6, 5 + report.receptionists.length, 8)
  for (let row = 6; row <= 5 + report.receptionists.length; row++) reception.getCell(row, 7).numFmt = money
  return Buffer.from(await book.xlsx.writeBuffer())
}
