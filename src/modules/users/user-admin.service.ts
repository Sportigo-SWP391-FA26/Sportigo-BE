import type { Prisma } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import { FORBIDDEN_MESSAGE, type AuthUser } from '../../middleware/auth.js'
import { changeUserStatus, findUserSummary, searchUsers, type UserSummaryRow } from './user-admin.repository.js'
import type { ChangeUserStatusInput, ListUsersQuery } from './user-admin.schema.js'

export function toUserSummary(user: UserSummaryRow) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role.name,
    status: user.status,
    // note: gộp mã hội viên / mã Coach / mã lễ tân (FR-07) thành một cột "code" cho bảng danh sách
    code: user.member?.memberCode ?? user.coach?.coachCode ?? user.receptionist?.staffCode ?? null,
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
      { receptionist: { staffCode: contains } },
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

// FR-06
export async function changeStatus(actor: AuthUser, userId: number, input: ChangeUserStatusInput, ipAddress?: string) {
  // note: không cho tự khóa mình, tránh trung tâm mất tài khoản quản trị duy nhất
  if (actor.id === userId) {
    throw new HttpError(400, 'Không thể tự thay đổi trạng thái tài khoản của mình', 'CANNOT_CHANGE_OWN_STATUS')
  }
  const target = await findUserSummary(userId)
  if (!target) throw new HttpError(404, 'Không tìm thấy người dùng', 'USER_NOT_FOUND')
  // note: Manager không khóa/mở khóa Manager khác; việc này cần xử lý ngoài hệ thống
  if (target.role.name === 'CENTER_MANAGER') throw new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN')

  let next: 'ACTIVE' | 'LOCKED' | 'INACTIVE' = input.status
  if (input.status === 'LOCKED') {
    if (target.status === 'LOCKED') throw new HttpError(409, 'Tài khoản đã bị khóa', 'STATUS_UNCHANGED')
  } else {
    if (target.status !== 'LOCKED') throw new HttpError(409, 'Tài khoản không ở trạng thái bị khóa', 'STATUS_UNCHANGED')
    // note: mở khóa tài khoản chưa xác minh email thì trả về INACTIVE, không cho bỏ qua bước xác minh
    if (!target.emailVerifiedAt) next = 'INACTIVE'
  }

  const updated = await changeUserStatus({ actorId: actor.id, userId, from: target.status, to: next, reason: input.reason, ipAddress })
  if (!updated) throw new HttpError(409, 'Trạng thái tài khoản vừa bị thay đổi, vui lòng tải lại', 'STATUS_CONFLICT')
  return toUserSummary(updated)
}
