import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { payrollWorkbook, performanceWorkbook } from '../../src/modules/payroll/payroll.export.js'

describe('staff Excel exports', () => {
  it('keeps payroll money numeric and review issues visible', async () => {
    const file = await payrollWorkbook({ month: '2026-10', status: 'DRAFT', entries: [{ staffName: 'Coach A', staffCode: 'C-01', role: 'COACH', baseSalary: 9000000, scheduledUnits: 4, absentUnits: 1, absenceDeduction: 2250000, makeupCredit: 0, allowanceTotal: 0, deductionTotal: 0, netAmount: 6750000, reviewIssues: ['Chưa điểm danh'] }] } as never)
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(file as never)
    const sheet = book.getWorksheet('Bảng lương')!
    expect(sheet.getCell('A6').value).toBe(6750000)
    expect(sheet.getCell('K9').value).toBe(6750000)
    expect(sheet.getCell('K9').numFmt).toContain('#,##0')
    expect(sheet.getCell('L9').value).toBe('Chưa điểm danh')
    expect(sheet.autoFilter).toBeTruthy()
  })

  it('exports separate coach and reception details without inventing attendance', async () => {
    const file = await performanceWorkbook({ from: '2026-05-01', to: '2026-05-31', totals: { groupSessionsHeld: 2, privateSessions: 0, supportResolved: 1, membersCreated: 0, cashCollected: 100000 }, coaches: [{ displayName: 'Coach A', staffCode: 'C-01', groupSessionsHeld: 2, groupSessionsMarked: 2, privateSessions: 0, attendanceRate: null, assessments: 0, activeTrainees: 0, coachStatus: 'ACTIVE' }], receptionists: [{ displayName: 'Lễ tân A', staffCode: 'R-01', supportResolved: 1, supportInProgress: 0, avgResolutionHours: 1.5, cashPayments: 1, cashCollected: 100000, membersCreated: 0 }] } as never)
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(file as never)
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Tổng quan', 'Hiệu suất Coach', 'Hiệu suất lễ tân'])
    expect(book.getWorksheet('Hiệu suất Coach')!.getCell('F6').value).toBeNull()
    expect(book.getWorksheet('Hiệu suất lễ tân')!.getCell('G6').value).toBe(100000)
  })
})
