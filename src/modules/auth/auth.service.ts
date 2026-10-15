import bcrypt from 'bcryptjs'
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { HttpError } from '../../lib/http-error.js'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import {
  activateVerifiedUser,
  createMember,
  findExistingUser,
  findRefreshToken,
  findUserByEmail,
  findUserByIdentifier,
  findLatestVerificationForEmail,
  replaceVerificationToken,
  revokeRefreshToken,
  saveRefreshToken,
} from './auth.repository.js'
import { sendVerificationEmail } from './email.service.js'
import { createAccessToken, createRefreshToken, verifyRefreshToken } from './token.service.js'

const VERIFICATION_TTL_MS = 10 * 60 * 1000
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
  const code = randomInt(100_000, 1_000_000).toString()
  await replaceVerificationToken(user.id, hash(`${user.id}:${code}`), new Date(Date.now() + VERIFICATION_TTL_MS))
  await sendVerificationEmail({ email: user.email, displayName: user.displayName, code })
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
  try {
    await issueVerification(user)
    return {
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để kích hoạt tài khoản.',
      email: user.email,
      emailSent: true,
    }
  } catch (error) {
    // The account and verification token already exist. Returning a successful
    // registration prevents the user from retrying registration and receiving
    // a misleading duplicate-account error. They can retry delivery from the
    // verification screen without weakening the verification requirement.
    console.error('Verification email could not be delivered after registration', error)
    return {
      message: 'Tài khoản đã được tạo nhưng email xác minh chưa gửi được. Vui lòng thử gửi lại.',
      email: user.email,
      emailSent: false,
    }
  }
}

export async function verifyEmail(email: string, code: string) {
  const record = await findLatestVerificationForEmail(email)
  const suppliedHash = Buffer.from(hash(`${record?.userId ?? 0}:${code}`))
  const storedHash = Buffer.from(record?.tokenHash ?? hash('invalid'))
  const matches = suppliedHash.length === storedHash.length && timingSafeEqual(suppliedHash, storedHash)
  if (!record || !matches || record.expiresAt <= new Date()) {
    throw new HttpError(400, 'Mã OTP không đúng hoặc đã hết hạn', 'INVALID_VERIFICATION_CODE')
  }
  await activateVerifiedUser(record.id, record.userId)
  return { message: 'Email đã được xác minh. Bạn có thể đăng nhập.' }
}

export async function resendVerification(email: string) {
  const user = await findUserByEmail(email)
  if (!user || user.emailVerifiedAt) return { message: 'Nếu tài khoản cần xác minh, email mới sẽ được gửi.' }
  await issueVerification(user)
  return { message: 'Mã OTP xác minh mới đã được gửi.' }
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
