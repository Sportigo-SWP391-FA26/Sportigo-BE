import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import { resendVerification } from '../auth/auth.service.js'
import { createMemberAtCounter, generateMemberCode } from './members.repository.js'
import type { CreateMemberInput } from './members.schema.js'
import { findUserByEmailOrPhone } from './staff.repository.js'
import { toUserSummary } from './user-admin.service.js'
import { isUniqueViolation } from './users.repository.js'

const MAX_CODE_ATTEMPTS = 3

const isMemberCodeClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  String(error.meta?.target ?? '').includes('memberCode')

// FR-08
export async function createMember(actor: AuthUser, input: CreateMemberInput, ipAddress?: string) {
  const existing = await findUserByEmailOrPhone(input.email, input.phone)
  if (existing) {
    const field = existing.email === input.email ? 'email' : 'phone'
    throw new HttpError(409, (field === 'email' ? 'Email' : 'Số điện thoại') + ' đã được sử dụng', 'ACCOUNT_EXISTS', { field })
  }

  // note: mật khẩu ngẫu nhiên không ai biết; hội viên đặt mật khẩu thật qua "Quên mật khẩu" sau khi xác minh email
  const passwordHash = await bcrypt.hash(randomUUID(), 12)
  const data = {
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    passwordHash,
    dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
    gender: input.gender ?? null,
    emergencyContact: input.emergencyContact ?? null,
  }

  let created
  for (let attempt = 1; ; attempt++) {
    try {
      created = await createMemberAtCounter({ ...data, memberCode: generateMemberCode() }, actor.id, ipAddress)
      break
    } catch (error) {
      // note: mã sinh ngẫu nhiên hiếm khi trùng; trùng thì sinh mã khác, tối đa 3 lần
      if (isMemberCodeClash(error) && attempt < MAX_CODE_ATTEMPTS) continue
      // note: email/phone bị người khác tạo cùng lúc vượt qua pre-check
      if (isUniqueViolation(error)) throw new HttpError(409, 'Email hoặc số điện thoại đã được sử dụng', 'ACCOUNT_EXISTS')
      throw error
    }
  }

  let emailSent = true
  try {
    await resendVerification(created.email)
  } catch (error) {
    console.error('Verification email could not be delivered after counter registration', error)
    emailSent = false
  }
  return { ...toUserSummary(created), emailSent }
}
