import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
// TEMP(FR-62): REFRESH_COOKIE, cookieOptions được export tạm từ auth.controller.ts, xem comment tại đó
import { REFRESH_COOKIE, cookieOptions } from '../auth/auth.controller.js'
import { changePasswordSchema, updateProfileSchema } from './users.schema.js'
import * as usersService from './users.service.js'

export const getMe: RequestHandler = async (request, response) => {
  // note: luôn lấy id từ token, không nhận id từ client
  response.json(await usersService.getMe(getAuthUser(request).id))
}

export const updateMe: RequestHandler = async (request, response) => {
  // note: parse lỗi → ZodError → errorHandler trả 422 VALIDATION_ERROR
  const input = updateProfileSchema.parse(request.body)
  response.json(await usersService.updateMe(getAuthUser(request).id, input))
}

export const changePassword: RequestHandler = async (request, response) => {
  // note: mật khẩu yếu hoặc confirmPassword không khớp → 422 trước khi chạm DB
  const input = changePasswordSchema.parse(request.body)
  const result = await usersService.changePassword(getAuthUser(request).id, input)
  // note: cookie dùng cùng tên/option (path /api/auth) với login nên /auth/refresh đọc được; refreshToken không trả trong body
  response.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions)
  response.json({ message: result.message, accessToken: result.accessToken })
}
