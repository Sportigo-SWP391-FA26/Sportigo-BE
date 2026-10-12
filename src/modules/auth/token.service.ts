import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

type AccessTokenPayload = {
  userId: number
  role: string
}

export type RefreshTokenPayload = AccessTokenPayload & { tokenId: string }

export function createAccessToken(payload: AccessTokenPayload) {
  return jwt.sign({ role: payload.role }, env.JWT_ACCESS_SECRET, {
    subject: String(payload.userId),
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}


export function createRefreshToken(payload: RefreshTokenPayload) {
  return jwt.sign({ role: payload.role, tokenId: payload.tokenId }, env.JWT_REFRESH_SECRET, {
    subject: String(payload.userId),
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  })
}

export function verifyRefreshToken(token: string) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload
  if (!payload.sub || typeof payload.tokenId !== 'string' || typeof payload.role !== 'string') {
    throw new Error('Invalid refresh token')
  }
  return { userId: Number(payload.sub), tokenId: payload.tokenId, role: payload.role }
}
