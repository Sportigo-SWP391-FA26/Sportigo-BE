import bcrypt from 'bcryptjs'
import { HttpError } from '../../lib/http-error.js'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import { createMember, findExistingUser, findUserByIdentifier } from './auth.repository.js'
import { createAccessToken } from './token.service.js'

export async function login(input: LoginInput) {
  const user = await findUserByIdentifier(input.identifier)

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(
      401,
      'Email, số điện thoại hoặc mật khẩu không đúng',
      'INVALID_CREDENTIALS',
    )
  }

  if (user.status !== 'ACTIVE') {
    throw new HttpError(
      403,
      'Tài khoản hiện không hoạt động',
      'ACCOUNT_INACTIVE',
    )
  }

  const accessToken = createAccessToken({
    userId: user.id,
    role: user.role.name,
  })

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      role: user.role.name,
    },
  }
}

export async function register(input: RegisterInput) {
  const existingUser = await findExistingUser(input.email, input.phone)
  if (existingUser) {
    const field = existingUser.email === input.email ? 'email' : 'phone'
    throw new HttpError(409, `${field === 'email' ? 'Email' : 'Số điện thoại'} đã được sử dụng`, 'ACCOUNT_EXISTS', { field })
  }

  const passwordHash = await bcrypt.hash(input.password, 12)
  const user = await createMember({
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    passwordHash,
  })
  const accessToken = createAccessToken({ userId: user.id, role: user.role.name })

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      role: user.role.name,
    },
  }
}
