import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { env } from '../../config/env.js'
import { HttpError } from '../../lib/http-error.js'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import {
  activateVerifiedUser,
  createMember,
  findExistingUser,
  findRefreshToken,
  findUserByEmail,
  findUserByIdentifier,
  findVerificationToken,
  replaceVerificationToken,
  revokeRefreshToken,
  saveRefreshToken,
} from './auth.repository.js'
import { sendVerificationEmail } from './email.service.js'
import { createAccessToken, createRefreshToken, verifyRefreshToken } from './token.service.js'

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function publicUser(user: { id: number; email: string; phone: string | null; displayName: string; role: { name: string } }) {
  return { id: user.id, email: user.email, phone: user.phone, displayName: user.displayName, role: user.role.name }
}

async function createSession(user: { id: number; role: { name: string } }) {
  const tokenId = randomUUID()
  const refreshToken = createRefreshToken({ userId: user.id, role: user.role.name, tokenId })
  await saveRefreshToken(hash(refreshToken), user.id, new Date(Date.now() + REFRESH_TTL_MS))
  return { accessToken: createAccessToken({ userId: user.id, role: user.role.name }), refreshToken }
}

async function issueVerification(user: { id: number; email: string; displayName: string }) {
  const token = randomBytes(32).toString('hex')
  await replaceVerificationToken(user.id, hash(token), new Date(Date.now() + VERIFICATION_TTL_MS))
  const verificationUrl = env.APP_URL + '/verify-email?token=' + token
  await sendVerificationEmail({ email: user.email, displayName: user.displayName, verificationUrl })
  return env.NODE_ENV === 'production' ? undefined : verificationUrl
}

export async function login(input: LoginInput) {
  const user = await findUserByIdentifier(input.identifier)
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, 'Email, số điện thoại hoặc mật khẩu không đúng', 'INVALID_CREDENTIALS')
  }
  if (!user.emailVerifiedAt) throw new HttpError(403, 'Vui lòng xác minh email trước khi đăng nhập', 'EMAIL_NOT_VERIFIED')
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'Tài khoản hiện không hoạt động', 'ACCOUNT_INACTIVE')
  return { ...(await createSession(user)), user: publicUser(user) }
}

export async function register(input: RegisterInput) {
  const existingUser = await findExistingUser(input.email, input.phone)
  if (existingUser) {
    const field = existingUser.email === input.email ? 'email' : 'phone'
    throw new HttpError(409, (field === 'email' ? 'Email' : 'Số điện thoại') + ' đã được sử dụng', 'ACCOUNT_EXISTS', { field })
  }
  const user = await createMember({
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    passwordHash: await bcrypt.hash(input.password, 12),
  })
  const verificationUrl = await issueVerification(user)
  return { message: 'Đăng ký thành công. Vui lòng kiểm tra email để kích hoạt tài khoản.', email: user.email, verificationUrl }
}

export async function verifyEmail(token: string) {
  const record = await findVerificationToken(hash(token))
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw new HttpError(400, 'Liên kết xác minh không hợp lệ hoặc đã hết hạn', 'INVALID_VERIFICATION_TOKEN')
  }
  await activateVerifiedUser(record.id, record.userId)
  return { message: 'Email đã được xác minh. Bạn có thể đăng nhập.' }
}

export async function resendVerification(email: string) {
  const user = await findUserByEmail(email)
  if (!user || user.emailVerifiedAt) return { message: 'Nếu tài khoản cần xác minh, email mới sẽ được gửi.' }
  const verificationUrl = await issueVerification(user)
  return { message: 'Email xác minh mới đã được gửi.', verificationUrl }
}

export async function refresh(rawToken: string) {
  try {
    verifyRefreshToken(rawToken)
  } catch {
    throw new HttpError(401, 'Phiên đăng nhập không hợp lệ', 'INVALID_REFRESH_TOKEN')
  }
  const stored = await findRefreshToken(hash(rawToken))
  if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || stored.user.status !== 'ACTIVE') {
    throw new HttpError(401, 'Phiên đăng nhập đã hết hạn', 'INVALID_REFRESH_TOKEN')
  }
  await revokeRefreshToken(hash(rawToken))
  return createSession(stored.user)
}

export async function logout(rawToken?: string) {
  if (rawToken) await revokeRefreshToken(hash(rawToken))
  return { message: 'Đã đăng xuất.' }
}
