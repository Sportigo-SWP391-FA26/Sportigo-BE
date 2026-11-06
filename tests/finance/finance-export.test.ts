import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { toClassPdf, toClassWorkbook, toRevenuePdf, toRevenueWorkbook } from '../../src/modules/finance/finance.export.js'

describe('finance exports', () => {
  it('creates valid Excel workbooks', async () => {
    const revenue = await toRevenueWorkbook({
      period: { from: new Date('2026-11-01T00:00:00+07:00'), to: new Date('2026-11-30T23:59:59+07:00') },
      filters: { channel: null, itemType: null }, gross: 1000, discount: 50, refunds: 100, net: 900, transactions: 1, walletTopUps: 500,
      byChannel: { ONLINE: 900 }, byService: { GROUP_CLASS: { orders: 1, transactions: 1, gross: 1000, discount: 50, refunds: 100, net: 900 } },
      payments: [{
        id: 1, orderId: 1, paymentMethodId: 1, collectedById: null, reference: 'VNP-001', amount: 1000 as never, channel: 'ONLINE', status: 'PARTIALLY_REFUNDED', paidAt: new Date('2026-11-05'), createdAt: new Date('2026-11-05'),
        adjustments: [{ id: 1, paymentId: 1, createdById: 2, type: 'REFUND', amount: 100 as never, reason: 'Hủy hợp lệ', createdAt: new Date('2026-11-06') }], paymentMethod: { id: 1, code: 'VNPAY', name: 'VNPay', isOnline: true, isActive: true }, collectedBy: null,
        order: { id: 1, memberId: 3, promotionId: null, orderNumber: 'ORD-001', originalAmount: 1050 as never, discountAmount: 50 as never, finalAmount: 1000 as never, status: 'PARTIALLY_REFUNDED', expiresAt: null, paidAt: new Date('2026-11-05'), createdAt: new Date('2026-11-05'), updatedAt: new Date('2026-11-05'), member: { userId: 3, memberCode: 'MEM-001', trainingGoal: null, dateOfBirth: null, gender: null, emergencyContact: null, joinedAt: new Date(), user: { displayName: 'Nguyễn Văn A', email: 'member@example.com' } }, invoice: { id: 1, orderId: 1, invoiceNumber: 'INV-001', issuedAt: new Date(), subtotal: 1050 as never, discountAmount: 50 as never, totalAmount: 1000 as never }, items: [{ id: 1, orderId: 1, classRegistrationId: 1, privateEnrollmentId: null, itemType: 'GROUP_CLASS', itemNameSnapshot: 'Yoga cơ bản', unitPrice: 1050 as never, discountAmount: 50 as never, finalAmount: 1000 as never, createdAt: new Date() }] },
      }],
      refundRequests: [], refundAdjustments: [], walletTopUpPayments: [],
    } as never)
    const classes = await toClassWorkbook([{ id: 1, name: 'Swimming', capacity: 20, confirmed: 15, waitlist: 2, occupancyRate: .75, attendanceRate: .9 }])
    expect(revenue.subarray(0, 2).toString()).toBe('PK')
    expect(classes.subarray(0, 2).toString()).toBe('PK')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(revenue as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Tổng quan', 'Chi tiết giao dịch', 'Doanh thu dịch vụ', 'Hoàn tiền', 'Đối soát kênh'])
    expect(workbook.getWorksheet('Chi tiết giao dịch')?.getCell('B6').value).toBe('VNP-001')
    expect(workbook.getWorksheet('Đối soát kênh')?.getCell('A9').value).toBe('Nạp ví Sportigo')
  })

  it('creates valid PDF reports', async () => {
    const revenue = await toRevenuePdf({ gross: 1000, refunds: 100, net: 900, transactions: 2, byChannel: { ONLINE: 900 } })
    const classes = await toClassPdf([{ id: 1, name: 'Swimming', capacity: 20, confirmed: 15, waitlist: 2, occupancyRate: .75, attendanceRate: .9 }])
    expect(revenue.subarray(0, 4).toString()).toBe('%PDF')
    expect(classes.subarray(0, 4).toString()).toBe('%PDF')
  })
})
