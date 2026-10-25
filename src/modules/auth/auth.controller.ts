import type { RequestHandler } from 'express'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'
import { forgotPasswordSchema, googleLoginSchema, loginSchema, refreshSchema, registerSchema, resendVerificationSchema, resetPasswordSchema, verifyEmailSchema } from './auth.schema.js'
import * as authService from './auth.service.js'

// TEMP(FR-62): thêm "export" để users.controller set cookie refresh mới khi đổi mật khẩu; giá trị không đổi.
// Khi Tài export chính thức thì sửa import trong users.controller.ts và xóa comment này.
export const REFRESH_COOKIE = 'sportigo_refresh'
export const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: (env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

function readRefreshCookie(cookieHeader?: string) {
  return cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(REFRESH_COOKIE + '='))?.slice(REFRESH_COOKIE.length + 1)
}

export const login: RequestHandler = async (request, response) => {
  const result = await authService.login(loginSchema.parse(request.body))
  response.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions)
  response.json({ accessToken: result.accessToken, user: result.user })
}

export const register: RequestHandler = async (request, response) => {
  const result = await authService.register(registerSchema.parse(request.body))
  response.status(201).json(result)
}

export const verifyEmail: RequestHandler = async (request, response) => {
  const { email, code } = verifyEmailSchema.parse(request.body)
  response.json(await authService.verifyEmail(email, code))
}

export const resendVerification: RequestHandler = async (request, response) => {
  const { email } = resendVerificationSchema.parse(request.body)
  response.json(await authService.resendVerification(email))
}

export const forgotPassword: RequestHandler = async (request, response) => {
  const { email } = forgotPasswordSchema.parse(request.body)
  response.json(await authService.forgotPassword(email))
}

export const resetPassword: RequestHandler = async (request, response) => {
  const input = resetPasswordSchema.parse(request.body)
  response.json(await authService.resetPassword(input))
}

export const googleLogin: RequestHandler = async (request, response) => {
  const { credential } = googleLoginSchema.parse(request.body)
  const result = await authService.loginWithGoogle(credential)
  response.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions)
  response.json({ accessToken: result.accessToken, user: result.user })
}

export const refresh: RequestHandler = async (request, response) => {
  const body = refreshSchema.parse(request.body ?? {})
  const token = body.refreshToken ?? readRefreshCookie(request.headers.cookie)
  if (!token) throw new HttpError(401, 'Không tìm thấy phiên đăng nhập', 'MISSING_REFRESH_TOKEN')
  const result = await authService.refresh(token)
  response.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions)
  response.json({ accessToken: result.accessToken })
}

export const logout: RequestHandler = async (request, response) => {
  const token = readRefreshCookie(request.headers.cookie)
  const result = await authService.logout(token)
  response.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined })
  response.json(result)
}
