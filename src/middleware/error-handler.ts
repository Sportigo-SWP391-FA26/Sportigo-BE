import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../lib/http-error.js'

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  void _next
  if (error instanceof ZodError) {
    response.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu không hợp lệ',
      details: error.flatten(),
    })
    return
  }

  if (error instanceof HttpError) {
    response.status(error.status === 422 ? 400 : error.status).json({
      code: error.code,
      message: error.message,
      details: error.details,
    })
    return
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code
    if (code === 'P2002') {
      response.status(409).json({
        code: 'RESOURCE_CONFLICT',
        message: 'Dữ liệu đã tồn tại.',
      })
      return
    }
    if (code === 'P2025') {
      response.status(404).json({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Không tìm thấy tài nguyên.',
      })
      return
    }
    if (code === 'P2003') {
      response.status(409).json({
        code: 'RELATED_RESOURCE_CONFLICT',
        message: 'Không thể thay đổi dữ liệu đang được tham chiếu.',
      })
      return
    }
  }

  console.error(error)
  response.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Đã xảy ra lỗi hệ thống',
  })
}
