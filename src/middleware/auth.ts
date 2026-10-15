import type { Request, RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { HttpError } from '../lib/http-error.js'

// Bản tối thiểu để các module dùng trước khi FR-04 (RBAC) hoàn thiện.
// Khi thay thế, giữ nguyên tên export: authenticate, authorize, getAuthUser.

export type RoleName = 'CENTER_MANAGER' | 'COACH' | 'MEMBER' | 'RECEPTIONIST'

export type AuthUser = {
  id: number
  role: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

// BR-06
export const FORBIDDEN_MESSAGE = 'Bạn không có quyền thực hiện thao tác này.'

function unauthenticated() {
  return new HttpError(401, 'Bạn cần đăng nhập để tiếp tục', 'UNAUTHENTICATED')
}

export const authenticate: RequestHandler = (request, _response, next) => {
  const [scheme, token] = request.headers.authorization?.split(' ') ?? []
  if (scheme !== 'Bearer' || !token) throw unauthenticated()

  let payload: string | jwt.JwtPayload
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    })
  } catch {
    throw unauthenticated()
  }

  if (typeof payload === 'string') throw unauthenticated()
  const userId = Number(payload.sub)
  if (!Number.isInteger(userId) || typeof payload.role !== 'string') {
    throw unauthenticated()
  }

  request.user = { id: userId, role: payload.role }
  next()
}

export function authorize(...roles: RoleName[]): RequestHandler {
  return (request, _response, next) => {
    const user = getAuthUser(request)
    if (!roles.some((role) => role === user.role)) {
      throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN')
    }
    next()
  }
}

export function getAuthUser(request: Request): AuthUser {
  if (!request.user) throw unauthenticated()
  return request.user
}
