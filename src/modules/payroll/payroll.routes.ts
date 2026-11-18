import { Router, type RequestHandler } from 'express'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { resolve } from 'node:path'
import { authenticate, authorize, getAuthUser } from '../../middleware/auth.js'
import { compensationSchema, monthSchema, recurringItemSchema } from './payroll.schema.js'
import * as service from './payroll.service.js'
import { getStaffPerformance } from '../users/staff-performance.service.js'
import { staffPerformanceQuerySchema } from '../users/staff-performance.schema.js'

export const payrollRouter = Router()
payrollRouter.use(authenticate)
const manager = authorize('CENTER_MANAGER')
const staffId = (value: string) => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID nhân sự không hợp lệ')
  return id
}
const param = (value: string | string[] | undefined) => typeof value === 'string' ? value : ''

payrollRouter.get('/me/payslips', authorize('COACH', 'RECEPTIONIST'), async (req, res) => { res.json(await service.ownPayslips(getAuthUser(req).id)) })
payrollRouter.get('/me/performance', authorize('COACH', 'RECEPTIONIST'), async (req, res) => {
  const user = getAuthUser(req)
  const report = await getStaffPerformance(staffPerformanceQuerySchema.parse(req.query))
  res.json({ from: report.from, to: report.to, performance: user.role === 'COACH' ? report.coaches.find((v) => v.id === user.id) ?? null : report.receptionists.find((v) => v.id === user.id) ?? null })
})
payrollRouter.get('/me/payslips/:month', authorize('COACH', 'RECEPTIONIST'), async (req, res) => { res.json(await service.ownPayslip(getAuthUser(req).id, monthSchema.parse(req.params.month))) })
payrollRouter.get('/me/payslips/:month/pdf', authorize('COACH', 'RECEPTIONIST'), async (req, res) => {
  const entry = await service.ownPayslip(getAuthUser(req).id, monthSchema.parse(req.params.month))
  const pdf = new PDFDocument({ size: 'A4', margin: 48 })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="Sportigo_Payslip_${entry.period.month}.pdf"`)
  pdf.pipe(res)
  pdf.font(resolve(process.cwd(), 'src/assets/NotoSans.ttf')).fontSize(18).text('SPORTIGO · PHIẾU LƯƠNG')
  pdf.moveDown().fontSize(11)
  for (const [label, value] of Object.entries({ 'Tháng': entry.period.month, 'Nhân sự': entry.staffName, 'Mã nhân sự': entry.staffCode ?? '', 'Lương cơ bản (VND)': entry.baseSalary.toString(), 'Trừ vắng (VND)': entry.absenceDeduction.toString(), 'Bù ca (VND)': entry.makeupCredit.toString(), 'Phụ cấp (VND)': entry.allowanceTotal.toString(), 'Khấu trừ khác (VND)': entry.deductionTotal.toString(), 'Thực nhận (VND)': entry.netAmount.toString() })) pdf.text(`${label}: ${value}`)
  pdf.end()
})
payrollRouter.get('/compensations/:staffId', manager, async (req, res) => { res.json(await service.listCompensation(staffId(param(req.params.staffId)))) })
payrollRouter.put('/compensations/:staffId', manager, async (req, res) => { res.json(await service.setCompensation(staffId(param(req.params.staffId)), compensationSchema.parse(req.body), getAuthUser(req).id)) })
payrollRouter.get('/recurring-items/:staffId', manager, async (req, res) => { res.json(await service.listRecurringItems(staffId(param(req.params.staffId)))) })
payrollRouter.post('/recurring-items/:staffId', manager, async (req, res) => { res.status(201).json(await service.createRecurringItem(staffId(param(req.params.staffId)), recurringItemSchema.parse(req.body), getAuthUser(req).id)) })
payrollRouter.patch('/recurring-items/:id', manager, async (req, res) => { res.json(await service.updateRecurringItem(staffId(param(req.params.id)), recurringItemSchema.partial().parse(req.body), getAuthUser(req).id)) })
payrollRouter.get('/periods', manager, async (_req, res) => { res.json(await service.listPeriods()) })
payrollRouter.get('/periods/:month', manager, async (req, res) => { res.json(await service.getPeriod(monthSchema.parse(req.params.month))) })
payrollRouter.post('/periods/:month/build', manager, async (req, res) => { res.json(await service.buildPeriod(monthSchema.parse(req.params.month), getAuthUser(req).id)) })
payrollRouter.post('/periods/:month/approve', manager, async (req, res) => { res.json(await service.approvePeriod(monthSchema.parse(req.params.month), getAuthUser(req).id)) })

const sendWorkbook: RequestHandler = async (req, res) => {
  const workbook = new ExcelJS.Workbook()
  if (req.path.startsWith('/performance')) {
    const report = await getStaffPerformance(staffPerformanceQuerySchema.parse(req.query))
    const coaches = workbook.addWorksheet('Hiệu suất Coach')
    coaches.addRow(['Coach', 'Mã', 'Buổi nhóm', 'Buổi 1-1', 'Đánh giá', 'Học viên'])
    report.coaches.forEach((v) => coaches.addRow([v.displayName, v.staffCode, v.groupSessionsHeld, v.privateSessions, v.assessments, v.activeTrainees]))
    const reception = workbook.addWorksheet('Hiệu suất lễ tân')
    reception.addRow(['Nhân sự', 'Mã', 'Yêu cầu xử lý', 'Tiền mặt thu', 'Hội viên mới'])
    report.receptionists.forEach((v) => reception.addRow([v.displayName, v.staffCode, v.supportResolved, v.cashCollected, v.membersCreated]))
  } else {
    const period = await service.getPeriod(monthSchema.parse(req.params.month))
    const sheet = workbook.addWorksheet('Bảng lương')
    sheet.addRow(['Sportigo', `Bảng lương ${period.month}`, period.status])
    sheet.addRow(['Nhân sự', 'Mã', 'Vai trò', 'Lương cơ bản', 'Ca dự kiến', 'Ca vắng', 'Trừ vắng', 'Bù ca', 'Phụ cấp', 'Khấu trừ', 'Thực nhận', 'Cần kiểm tra'])
    period.entries.forEach((v) => sheet.addRow([v.staffName, v.staffCode, v.role, Number(v.baseSalary), v.scheduledUnits, v.absentUnits, Number(v.absenceDeduction), Number(v.makeupCredit), Number(v.allowanceTotal), Number(v.deductionTotal), Number(v.netAmount), (v.reviewIssues as string[]).join('; ')]))
  }
  workbook.eachSheet((sheet) => {
    sheet.views = [{ state: 'frozen', ySplit: sheet.name === 'Bảng lương' ? 2 : 1 }]
    sheet.columns.forEach((column) => { column.width = 22 })
    sheet.getRow(sheet.name === 'Bảng lương' ? 2 : 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(sheet.name === 'Bảng lương' ? 2 : 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1457C3' } }
    sheet.autoFilter = { from: { row: sheet.name === 'Bảng lương' ? 2 : 1, column: 1 }, to: { row: sheet.name === 'Bảng lương' ? 2 : 1, column: sheet.columnCount } }
    sheet.pageSetup.orientation = 'landscape'
  })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="Sportigo_${req.path.startsWith('/performance') ? 'Performance' : 'Payroll'}_${req.params.month ?? 'report'}.xlsx"`)
  await workbook.xlsx.write(res)
  res.end()
}
payrollRouter.get('/performance/export', manager, sendWorkbook)
payrollRouter.get('/periods/:month/export', manager, sendWorkbook)
