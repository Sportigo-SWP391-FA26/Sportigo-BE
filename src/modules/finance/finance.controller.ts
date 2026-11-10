import type { RequestHandler } from 'express'
import { env } from '../../config/env.js'
import { getAuthUser } from '../../middleware/auth.js'
import * as finance from './finance.service.js'
import { auditExportSchema, auditListSchema, cashOrderSearchSchema, cashPaymentSchema, classReportSchema, idParamSchema, paginationSchema, paymentListSchema, promotionApplySchema, promotionSchema, promotionUpdateSchema, refundCreateSchema, refundReviewSchema, revenueReportSchema, walletPaymentSchema, walletTopUpSchema } from './finance.schema.js'
import { normalizeVnpayQuery } from './vnpay.js'
import { toAuditWorkbook, toClassPdf, toClassWorkbook, toInvoicePdf, toRevenuePdf, toRevenueWorkbook } from './finance.export.js'

const id = (value: unknown) => idParamSchema.parse(value)
const ip = (value: string | undefined) => value?.replace('::ffff:', '') ?? '127.0.0.1'

export const getOrder: RequestHandler = async (req, res) => res.json(await finance.getOrder(id(req.params.id), getAuthUser(req)))
export const applyPromotion: RequestHandler = async (req, res) => res.json(await finance.applyPromotion(id(req.params.id), promotionApplySchema.parse(req.body).code, getAuthUser(req)))
export const listPromotions: RequestHandler = async (req, res) => res.json(await finance.listPromotions(getAuthUser(req)))
export const createPromotion: RequestHandler = async (req, res) => { const value = promotionSchema.parse(req.body); res.status(201).json(await finance.createPromotion(value, getAuthUser(req).id)) }
export const updatePromotion: RequestHandler = async (req, res) => { const value = promotionUpdateSchema.parse(req.body); res.json(await finance.updatePromotion(id(req.params.id), value, getAuthUser(req).id)) }
export const createVnpayPayment: RequestHandler = async (req, res) => res.status(201).json(await finance.createVnpayPayment(id(req.params.id), getAuthUser(req), ip(req.ip)))
export const createWalletTopUp: RequestHandler = async (req, res) => res.status(201).json(await finance.createWalletTopUp(getAuthUser(req).id, walletTopUpSchema.parse(req.body).amount, ip(req.ip)))
export const searchCashOrders: RequestHandler = async (req, res) => res.json(await finance.searchCashOrders(cashOrderSearchSchema.parse(req.query).q))
export const vnpayReturn: RequestHandler = async (req, res) => {
  const query = normalizeVnpayQuery(req.query)
  await finance.processVnpayReturn(query)
  const target = new URL('/member/payments/result', env.APP_URL)
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value)
  res.redirect(302, target.toString())
}
export const verifyVnpayReturn: RequestHandler = async (req, res) => res.json(await finance.processVnpayReturn(normalizeVnpayQuery(req.query)))
export const vnpayIpn: RequestHandler = async (req, res) => res.json(await finance.processVnpayIpn(normalizeVnpayQuery(req.query)))
export const payCash: RequestHandler = async (req, res) => res.status(201).json(await finance.payCash(id(req.params.id), getAuthUser(req).id, cashPaymentSchema.parse(req.body).amount, ip(req.ip)))
export const payWallet: RequestHandler = async (req, res) => res.status(201).json(await finance.payWithWallet(id(req.params.id), walletPaymentSchema.parse(req.body).amount, getAuthUser(req).id))
export const payWalletLegacy: RequestHandler = async (req, res) => res.json(await finance.payRemainingWithWallet(id(req.params.id), getAuthUser(req).id))
export const getWallet: RequestHandler = async (req, res) => { const q = paginationSchema.parse(req.query); res.json(await finance.getWallet(getAuthUser(req).id, q.page, q.limit)) }
export const listPayments: RequestHandler = async (req, res) => { const q = paymentListSchema.parse(req.query); res.json(await finance.listPayments(getAuthUser(req), q)) }
export const requestRefund: RequestHandler = async (req, res) => { const value = refundCreateSchema.parse(req.body); res.status(201).json(await finance.requestRefund(id(req.params.id), getAuthUser(req).id, value.requestedAmount, value.reason)) }
export const requestItemRefund: RequestHandler = async (req, res) => { const value = refundCreateSchema.parse(req.body); res.status(201).json(await finance.requestOrderItemRefund(id(req.params.id), getAuthUser(req).id, value.requestedAmount, value.reason)) }
export const listRefunds: RequestHandler = async (_req, res) => res.json(await finance.listRefunds())
export const reviewRefund: RequestHandler = async (req, res) => { const value = refundReviewSchema.parse(req.body); res.json(await finance.reviewRefund(id(req.params.id), value.decision, value.note, getAuthUser(req).id, value.approvedAmount)) }
export const completeRefund: RequestHandler = async (req, res) => res.json(await finance.completeRefund(id(req.params.id), getAuthUser(req).id, ip(req.ip)))
export const revenueReport: RequestHandler = async (req, res) => res.json(await finance.revenueReport(revenueReportSchema.parse(req.query)))
export const classReport: RequestHandler = async (req, res) => res.json(await finance.classReport(classReportSchema.parse(req.query)))
export const listAuditLogs: RequestHandler = async (req, res) => res.json(await finance.listAuditLogs(auditListSchema.parse(req.query)))
export const exportAuditLogs: RequestHandler = async (req, res) => {
  const file = await toAuditWorkbook(await finance.auditLogsForExport(auditExportSchema.parse(req.query)))
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('Sportigo_NhatKyHeThong.xlsx').send(file)
}
export const downloadInvoice: RequestHandler = async (req, res) => { const invoice = await finance.getInvoice(id(req.params.id), getAuthUser(req)); const pdf = await toInvoicePdf(invoice); res.type('application/pdf').attachment(`${invoice.invoiceNumber}.pdf`).send(pdf) }
export const exportRevenue: RequestHandler = async (req, res) => {
  const query = revenueReportSchema.parse(req.query)
  const pdf = req.query.format === 'pdf'
  const report = pdf ? await finance.revenueReport(query) : await finance.financialReportData(query)
  const file = pdf ? await toRevenuePdf(report) : await toRevenueWorkbook(report as Awaited<ReturnType<typeof finance.financialReportData>>)
  const period = finance.normalizeRevenuePeriod(query).from.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
  res.type(pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .attachment(`Sportigo_BaoCaoTaiChinh_${period}.${pdf ? 'pdf' : 'xlsx'}`)
    .send(file)
}
export const exportClasses: RequestHandler = async (req, res) => { const report = await finance.classReport(classReportSchema.parse(req.query)); const pdf = req.query.format === 'pdf'; const file = pdf ? await toClassPdf(report) : await toClassWorkbook(report); res.type(pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`sportigo-classes.${pdf ? 'pdf' : 'xlsx'}`).send(file) }
