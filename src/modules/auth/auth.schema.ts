import { z } from 'zod'

export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(8),
})

export type LoginInput = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    phone: z.string().trim().regex(/^(0|\+84)[0-9]{9,10}$/),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(72),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  })

export type RegisterInput = z.infer<typeof registerSchema>

export const verifyEmailSchema = z.object({ token: z.string().min(32) })
export const resendVerificationSchema = z.object({ email: z.string().trim().toLowerCase().email() })
export const refreshSchema = z.object({ refreshToken: z.string().optional() })
