import { describe, expect, it } from 'vitest'
import { forgotPasswordSchema, googleLoginSchema, registerSchema, resendVerificationSchema, resetPasswordSchema, verifyEmailSchema } from '../src/modules/auth/auth.schema.js'

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
  it('accepts an email and a six-digit OTP', () => {
    expect(verifyEmailSchema.safeParse({ email: 'member@sportigo.vn', code: '123456' }).success).toBe(true)
  })

  it('rejects a verification code that is not six digits', () => {
    expect(verifyEmailSchema.safeParse({ email: 'member@sportigo.vn', code: '12345a' }).success).toBe(false)
  })

  it('normalizes the email used to resend verification', () => {
    expect(resendVerificationSchema.parse({ email: ' MEMBER@SPORTIGO.VN ' }).email).toBe('member@sportigo.vn')
  })
})

describe('password recovery and Google schemas', () => {
  it('normalizes the recovery email and accepts a valid reset payload', () => {
    expect(forgotPasswordSchema.parse({ email: ' MEMBER@SPORTIGO.VN ' }).email).toBe('member@sportigo.vn')
    expect(resetPasswordSchema.safeParse({ email: 'member@sportigo.vn', code: '123456', password: 'StrongPass123!', confirmPassword: 'StrongPass123!' }).success).toBe(true)
  })

  it('rejects invalid reset data and an empty Google credential', () => {
    expect(resetPasswordSchema.safeParse({ email: 'member@sportigo.vn', code: '123', password: 'StrongPass123!', confirmPassword: 'different' }).success).toBe(false)
    expect(googleLoginSchema.safeParse({ credential: '' }).success).toBe(false)
  })
})
