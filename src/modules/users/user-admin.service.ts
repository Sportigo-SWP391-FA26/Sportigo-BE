import type { Prisma } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import { FORBIDDEN_MESSAGE, type AuthUser } from '../../middleware/auth.js'
import { searchUsers, type UserSummaryRow } from './user-admin.repository.js'
import type { ListUsersQuery } from './user-admin.schema.js'

export function toUserSummary(user: UserSummaryRow) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role.name,
    status: user.status,
    // note: gộp mã hội viên / mã Coach thành một cột "code" cho bảng danh sách
    code: user.member?.memberCode ?? user.coach?.coachCode ?? null,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  }
}

function searchWhere(q: string): Prisma.UserWhereInput {
  const contains = { contains: q, mode: 'insensitive' as const }
  return {
    OR: [
      { displayName: contains },
      { email: contains },
      { phone: { contains: q } },
      { member: { memberCode: contains } },
      { coach: { coachCode: contains } },
    ],
  }
}

// FR-09
export async function listUsers(actor: AuthUser, query: ListUsersQuery) {
  // note: Receptionist chỉ được tra cứu hội viên (đúng phạm vi quyền); Manager xem được mọi role
  if (actor.role === 'RECEPTIONIST' && query.role && query.role !== 'MEMBER') {
    throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN')
  }
  const role = actor.role === 'RECEPTIONIST' ? 'MEMBER' : query.role

  const where: Prisma.UserWhereInput = {
    ...(role ? { role: { name: role } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? searchWhere(query.q) : {}),
  }
  const [rows, total] = await searchUsers(where, (query.page - 1) * query.pageSize, query.pageSize)
  return { items: rows.map(toUserSummary), page: query.page, pageSize: query.pageSize, total }
}
