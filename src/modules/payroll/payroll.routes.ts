import { Router, type RequestHandler } from 'express'
import PDFDocument from 'pdfkit'
import { resolve } from 'node:path'
import { authenticate, authorize, getAuthUser } from '../../middleware/auth.js'
import { compensationSchema, monthSchema, recurringItemSchema } from './payroll.schema.js'
import * as service from './payroll.service.js'
import { getStaffPerformance } from '../users/staff-performance.service.js'
import { staffPerformanceQuerySchema } from '../users/staff-performance.schema.js'
import { payrollWorkbook, performanceWorkbook } from './payroll.export.js'

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
  const performance = req.path.startsWith('/performance')
  const file = performance
    ? await performanceWorkbook(await getStaffPerformance(staffPerformanceQuerySchema.parse(req.query)))
    : await payrollWorkbook(await service.getPeriod(monthSchema.parse(req.params.month)))
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="Sportigo_${performance ? 'Performance' : 'Payroll'}_${req.params.month ?? 'report'}.xlsx"`)
  res.send(file)
}
payrollRouter.get('/performance/export', manager, sendWorkbook)
payrollRouter.get('/periods/:month/export', manager, sendWorkbook)
