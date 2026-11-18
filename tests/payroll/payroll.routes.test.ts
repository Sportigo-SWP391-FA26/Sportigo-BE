import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ownPayslips, ownPayslip, getPeriod } = vi.hoisted(() => ({ ownPayslips: vi.fn(), ownPayslip: vi.fn(), getPeriod: vi.fn() }))
vi.mock('../../src/lib/auth-state.js', () => ({ assertActiveSession: vi.fn() }))
vi.mock('../../src/modules/payroll/payroll.service.js', () => ({ ownPayslips, ownPayslip, getPeriod }))

import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { errorHandler } from '../../src/middleware/error-handler.js'
import { payrollRouter } from '../../src/modules/payroll/payroll.routes.js'

const app = express()
app.use(express.json())
app.use('/payroll', payrollRouter)
app.use(errorHandler)
const auth = (userId: number, role: string) => `Bearer ${createAccessToken({ userId, role })}`

beforeEach(() => { vi.clearAllMocks(); ownPayslips.mockResolvedValue([]); ownPayslip.mockResolvedValue({ period: { month: '2026-10' }, staffName: 'Nguyễn Văn A', staffCode: 'COACH-01', baseSalary: 5000000, absenceDeduction: 0, makeupCredit: 0, allowanceTotal: 0, deductionTotal: 0, netAmount: 5000000 }); getPeriod.mockResolvedValue({ month: '2026-10', entries: [] }) })

describe('Payroll access', () => {
  it('shows only the authenticated worker payslips', async () => {
    expect((await request(app).get('/payroll/me/payslips').set('Authorization', auth(12, 'COACH'))).status).toBe(200)
    expect(ownPayslips).toHaveBeenCalledWith(12)
    expect((await request(app).get('/payroll/me/payslips').set('Authorization', auth(17, 'RECEPTIONIST'))).status).toBe(200)
    expect(ownPayslips).toHaveBeenCalledWith(17)
    expect((await request(app).get('/payroll/me/payslips').set('Authorization', auth(2, 'MEMBER'))).status).toBe(403)
  })
  it('restricts the complete payroll period to Center Manager', async () => {
    expect((await request(app).get('/payroll/periods/2026-10').set('Authorization', auth(12, 'COACH'))).status).toBe(403)
    expect(getPeriod).not.toHaveBeenCalled()
    expect((await request(app).get('/payroll/periods/2026-10').set('Authorization', auth(1, 'CENTER_MANAGER'))).status).toBe(200)
    expect(getPeriod).toHaveBeenCalledWith('2026-10')
  })
  it('exports only the authenticated worker payslip as PDF', async () => {
    const response = await request(app).get('/payroll/me/payslips/2026-10/pdf').set('Authorization', auth(12, 'COACH'))
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/pdf')
    expect(ownPayslip).toHaveBeenCalledWith(12, '2026-10')
  })
})
