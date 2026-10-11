import type { RequestHandler } from 'express'
import { loginSchema, registerSchema } from './auth.schema.js'
import * as authService from './auth.service.js'

export const login: RequestHandler = async (request, response) => {
  const result = await authService.login(loginSchema.parse(request.body))
  response.json(result)
}

export const register: RequestHandler = async (request, response) => {
  const result = await authService.register(registerSchema.parse(request.body))
  response.status(201).json(result)
}
