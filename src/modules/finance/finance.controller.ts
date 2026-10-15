import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import * as finance from './finance.service.js'
import { auditListSchema, cashPaymentSchema, classReportSchema, idParamSchema, paginationSchema, paymentListSchema, promotionApplySchema, promotionSchema, refundCreateSchema, refundReviewSchema, revenueReportSchema, walletPaymentSchema } from './finance.schema.js'
import { normalizeVnpayQuery, verifyVnpay } from './vnpay.js'
import { toClassPdf, toClassWorkbook, toInvoicePdf, toRevenuePdf, toRevenueWorkbook } from './finance.export.js'

const id = (value: unknown) => idParamSchema.parse(value)
const ip = (value: string | undefined) => value?.replace('::ffff:', '') ?? '127.0.0.1'

export const getOrder: RequestHandler = async (req, res) => res.json(await finance.getOrder(id(req.params.id), getAuthUser(req)))
export const applyPromotion: RequestHandler = async (req, res) => res.json(await finance.applyPromotion(id(req.params.id), promotionApplySchema.parse(req.body).code, getAuthUser(req)))
export const listPromotions: RequestHandler = async (_req, res) => res.json(await finance.listPromotions())
export const createPromotion: RequestHandler = async (req, res) => { const value = promotionSchema.parse(req.body); res.status(201).json(await finance.createPromotion(value, getAuthUser(req).id)) }
export const updatePromotion: RequestHandler = async (req, res) => { const value = promotionSchema.partial().parse(req.body); res.json(await finance.updatePromotion(id(req.params.id), value, getAuthUser(req).id)) }
export const createVnpayPayment: RequestHandler = async (req, res) => res.status(201).json(await finance.createVnpayPayment(id(req.params.id), getAuthUser(req), ip(req.ip)))
export const vnpayReturn: RequestHandler = async (req, res) => { const query = normalizeVnpayQuery(req.query); res.json({ valid: verifyVnpay(query), responseCode: query.vnp_ResponseCode, transactionStatus: query.vnp_TransactionStatus, reference: query.vnp_TxnRef }) }
export const vnpayIpn: RequestHandler = async (req, res) => res.json(await finance.processVnpayIpn(normalizeVnpayQuery(req.query)))
export const payCash: RequestHandler = async (req, res) => res.status(201).json(await finance.payCash(id(req.params.id), getAuthUser(req).id, cashPaymentSchema.parse(req.body).amount, ip(req.ip)))
export const payWallet: RequestHandler = async (req, res) => res.status(201).json(await finance.payWithWallet(id(req.params.id), walletPaymentSchema.parse(req.body).amount, getAuthUser(req).id))
export const getWallet: RequestHandler = async (req, res) => { const q = paginationSchema.parse(req.query); res.json(await finance.getWallet(getAuthUser(req).id, q.page, q.limit)) }
export const listPayments: RequestHandler = async (req, res) => { const q = paymentListSchema.parse(req.query); res.json(await finance.listPayments(getAuthUser(req), q)) }
export const requestRefund: RequestHandler = async (req, res) => { const value = refundCreateSchema.parse(req.body); res.status(201).json(await finance.requestRefund(id(req.params.id), getAuthUser(req).id, value.requestedAmount, value.reason)) }
export const listRefunds: RequestHandler = async (_req, res) => res.json(await finance.listRefunds())
export const reviewRefund: RequestHandler = async (req, res) => { const value = refundReviewSchema.parse(req.body); res.json(await finance.reviewRefund(id(req.params.id), value.decision, value.note, getAuthUser(req).id, value.approvedAmount)) }
export const completeRefund: RequestHandler = async (req, res) => res.json(await finance.completeRefund(id(req.params.id), getAuthUser(req).id, ip(req.ip)))
export const revenueReport: RequestHandler = async (req, res) => res.json(await finance.revenueReport(revenueReportSchema.parse(req.query)))
export const classReport: RequestHandler = async (req, res) => res.json(await finance.classReport(classReportSchema.parse(req.query)))
export const listAuditLogs: RequestHandler = async (req, res) => res.json(await finance.listAuditLogs(auditListSchema.parse(req.query)))
export const downloadInvoice: RequestHandler = async (req, res) => { const invoice = await finance.getInvoice(id(req.params.id), getAuthUser(req)); const pdf = await toInvoicePdf(invoice); res.type('application/pdf').attachment(`${invoice.invoiceNumber}.pdf`).send(pdf) }
export const exportRevenue: RequestHandler = async (req, res) => { const report = await finance.revenueReport(revenueReportSchema.parse(req.query)); const pdf = req.query.format === 'pdf'; const file = pdf ? await toRevenuePdf(report) : await toRevenueWorkbook(report); res.type(pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`sportigo-revenue.${pdf ? 'pdf' : 'xlsx'}`).send(file) }
export const exportClasses: RequestHandler = async (req, res) => { const report = await finance.classReport(classReportSchema.parse(req.query)); const pdf = req.query.format === 'pdf'; const file = pdf ? await toClassPdf(report) : await toClassWorkbook(report); res.type(pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`sportigo-classes.${pdf ? 'pdf' : 'xlsx'}`).send(file) }
