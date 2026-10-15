import type { RequestHandler } from 'express'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'
import { loginSchema, refreshSchema, registerSchema, resendVerificationSchema, verifyEmailSchema } from './auth.schema.js'
import * as authService from './auth.service.js'

const REFRESH_COOKIE = 'sportigo_refresh'
const cookieOptions = {
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
