import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import * as controller from './finance.controller.js'

export const financeRouter = Router()

financeRouter.get('/payments/vnpay/return', controller.vnpayReturn)
financeRouter.get('/payments/vnpay/ipn', controller.vnpayIpn)
financeRouter.get('/orders/:id', authenticate, authorize('MEMBER', 'RECEPTIONIST', 'CENTER_MANAGER'), controller.getOrder)
financeRouter.post('/orders/:id/promotion', authenticate, authorize('MEMBER'), controller.applyPromotion)
financeRouter.post('/orders/:id/payments/vnpay', authenticate, authorize('MEMBER'), controller.createVnpayPayment)
financeRouter.post('/orders/:id/payments/cash', authenticate, authorize('RECEPTIONIST'), controller.payCash)
financeRouter.post('/orders/:id/wallet-payments', authenticate, authorize('MEMBER'), controller.payWallet)
financeRouter.get('/members/me/wallet', authenticate, authorize('MEMBER'), controller.getWallet)
financeRouter.get('/payments', authenticate, authorize('MEMBER', 'RECEPTIONIST', 'CENTER_MANAGER'), controller.listPayments)
financeRouter.post('/payments/:id/refund-requests', authenticate, authorize('MEMBER'), controller.requestRefund)
financeRouter.get('/refund-requests', authenticate, authorize('CENTER_MANAGER'), controller.listRefunds)
financeRouter.patch('/refund-requests/:id/review', authenticate, authorize('CENTER_MANAGER'), controller.reviewRefund)
financeRouter.post('/refund-requests/:id/complete', authenticate, authorize('CENTER_MANAGER'), controller.completeRefund)
financeRouter.get('/promotions', authenticate, authorize('MEMBER', 'RECEPTIONIST', 'CENTER_MANAGER'), controller.listPromotions)
financeRouter.post('/promotions', authenticate, authorize('CENTER_MANAGER'), controller.createPromotion)
financeRouter.patch('/promotions/:id', authenticate, authorize('CENTER_MANAGER'), controller.updatePromotion)
financeRouter.get('/reports/revenue', authenticate, authorize('CENTER_MANAGER'), controller.revenueReport)
financeRouter.get('/reports/revenue/export', authenticate, authorize('CENTER_MANAGER'), controller.exportRevenue)
financeRouter.get('/reports/classes', authenticate, authorize('CENTER_MANAGER'), controller.classReport)
financeRouter.get('/reports/classes/export', authenticate, authorize('CENTER_MANAGER'), controller.exportClasses)
financeRouter.get('/audit-logs', authenticate, authorize('CENTER_MANAGER'), controller.listAuditLogs)
financeRouter.get('/invoices/:id/pdf', authenticate, authorize('MEMBER', 'RECEPTIONIST', 'CENTER_MANAGER'), controller.downloadInvoice)
