import { describe, expect, it } from 'vitest'
import { createPaymentUrl, normalizeVnpayQuery, signVnpay, verifyVnpay } from '../../src/modules/finance/vnpay.js'

describe('VNPay Sandbox signature', () => {
  it('signs and verifies canonical parameters', () => {
    const params = { vnp_Amount: '12500000', vnp_Command: 'pay', vnp_TmnCode: 'TESTSPORTIGO', vnp_TxnRef: 'VNP-100' }
    const signed = { ...params, vnp_SecureHash: signVnpay(params) }
    expect(signed.vnp_SecureHash).toMatch(/^[a-f0-9]{128}$/)
    expect(verifyVnpay(signed)).toBe(true)
    expect(verifyVnpay({ ...signed, vnp_Amount: '12500001' })).toBe(false)
  })

  it('creates a sandbox URL with amount in the smallest VNPay unit', () => {
    const url = new URL(createPaymentUrl({ reference: 'VNP-101', amount: 125_000, ipAddress: '127.0.0.1', orderInfo: 'Sportigo order' }))
    expect(url.origin + url.pathname).toBe('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html')
    expect(url.searchParams.get('vnp_Amount')).toBe('12500000')
    expect(url.searchParams.get('vnp_SecureHash')).toMatch(/^[a-f0-9]{128}$/)
  })

  it('keeps only string VNPay query values', () => {
    expect(normalizeVnpayQuery({ vnp_TxnRef: '1', ignored: 'x', vnp_Array: ['x'] })).toEqual({ vnp_TxnRef: '1' })
  })
})
