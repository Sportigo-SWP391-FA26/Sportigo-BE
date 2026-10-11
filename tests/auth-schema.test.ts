import { describe, expect, it } from 'vitest'
import { registerSchema } from '../src/modules/auth/auth.schema.js'

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
