import { describe, expect, it } from 'vitest'
import { registerSchema, resendVerificationSchema, verifyEmailSchema } from '../src/modules/auth/auth.schema.js'

describe('registerSchema', () => {
  const validInput = {
    displayName: 'Nguyễn Văn An',
    phone: '0918234567',
    email: 'member@sportigo.vn',
    password: 'Sportigo@123',
    confirmPassword: 'Sportigo@123',
  }

  it('accepts a valid member registration', () => {
    expect(registerSchema.safeParse(validInput).success).toBe(true)
  })

  it('rejects mismatched passwords', () => {
    expect(registerSchema.safeParse({ ...validInput, confirmPassword: 'Different123' }).success).toBe(false)
  })
})

describe('email verification schemas', () => {
  it('accepts a secure verification token', () => {
    expect(verifyEmailSchema.safeParse({ token: 'a'.repeat(64) }).success).toBe(true)
  })

  it('normalizes the email used to resend verification', () => {
    expect(resendVerificationSchema.parse({ email: ' MEMBER@SPORTIGO.VN ' }).email).toBe('member@sportigo.vn')
  })
})
