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
    response.status(422).json({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu không hợp lệ',
      details: error.flatten(),
    })
    return
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      code: error.code,
      message: error.message,
      details: error.details,
    })
    return
  }

  console.error(error)
  response.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Đã xảy ra lỗi hệ thống',
  })
}
