import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

type AccessTokenPayload = {
  userId: number
  role: string
}

export function createAccessToken(payload: AccessTokenPayload) {
  return jwt.sign({ role: payload.role }, env.JWT_ACCESS_SECRET, {
    subject: String(payload.userId),
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}
