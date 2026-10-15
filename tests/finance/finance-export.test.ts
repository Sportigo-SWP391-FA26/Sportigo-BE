import { describe, expect, it } from 'vitest'
import { toClassPdf, toClassWorkbook, toRevenuePdf, toRevenueWorkbook } from '../../src/modules/finance/finance.export.js'

describe('finance exports', () => {
  it('creates valid Excel workbooks', async () => {
    const revenue = await toRevenueWorkbook({ gross: 1000, refunds: 100, net: 900, transactions: 2, byChannel: { ONLINE: 900 } })
    const classes = await toClassWorkbook([{ id: 1, name: 'Swimming', capacity: 20, confirmed: 15, waitlist: 2, occupancyRate: .75, attendanceRate: .9 }])
    expect(revenue.subarray(0, 2).toString()).toBe('PK')
    expect(classes.subarray(0, 2).toString()).toBe('PK')
  })

  it('creates valid PDF reports', async () => {
    const revenue = await toRevenuePdf({ gross: 1000, refunds: 100, net: 900, transactions: 2, byChannel: { ONLINE: 900 } })
    const classes = await toClassPdf([{ id: 1, name: 'Swimming', capacity: 20, confirmed: 15, waitlist: 2, occupancyRate: .75, attendanceRate: .9 }])
    expect(revenue.subarray(0, 4).toString()).toBe('%PDF')
    expect(classes.subarray(0, 4).toString()).toBe('%PDF')
  })
})
