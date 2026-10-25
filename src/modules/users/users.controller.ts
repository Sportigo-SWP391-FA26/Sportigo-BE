import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
// TEMP(FR-62): REFRESH_COOKIE, cookieOptions được export tạm từ auth.controller.ts, xem comment tại đó
import { REFRESH_COOKIE, cookieOptions } from '../auth/auth.controller.js'
import { changePasswordSchema, confirmEmailChangeSchema, emailChangeSchema, updateProfileSchema } from './users.schema.js'
import * as usersService from './users.service.js'

export const getMe: RequestHandler = async (request, response) => {
  // note: luôn lấy id từ token, không nhận id từ client
  response.json(await usersService.getMe(getAuthUser(request).id))
}

export const updateMe: RequestHandler = async (request, response) => {
  // note: parse lỗi → ZodError → errorHandler trả 400 VALIDATION_ERROR
  const input = updateProfileSchema.parse(request.body)
  response.json(await usersService.updateMe(getAuthUser(request).id, input))
}

export const changePassword: RequestHandler = async (request, response) => {
  // note: mật khẩu yếu hoặc confirmPassword không khớp → 400 VALIDATION_ERROR trước khi chạm DB
  const input = changePasswordSchema.parse(request.body)
  const result = await usersService.changePassword(getAuthUser(request).id, input)
  // note: cookie dùng cùng tên/option (path /api/auth) với login nên /auth/refresh đọc được; refreshToken không trả trong body
  response.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions)
  response.json({ message: result.message, accessToken: result.accessToken })
}

// FR-05 đổi email bước 1: body { newEmail, currentPassword }; 202 vì email chỉ đổi sau khi xác nhận OTP
export const requestEmailChange: RequestHandler = async (request, response) => {
  const input = emailChangeSchema.parse(request.body)
  response.status(202).json(await usersService.requestEmailChange(getAuthUser(request).id, input))
}

// FR-05 đổi email bước 2: body { code }; trả hồ sơ mới để FE cập nhật cache
export const confirmEmailChange: RequestHandler = async (request, response) => {
  const { code } = confirmEmailChangeSchema.parse(request.body)
  response.json(await usersService.confirmEmailChange(getAuthUser(request).id, code))
}
