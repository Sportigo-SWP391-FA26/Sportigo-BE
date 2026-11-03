import type { Prisma } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import { FORBIDDEN_MESSAGE, type AuthUser } from '../../middleware/auth.js'
import { changeUserStatus, findUserSummary, searchUsers, softDeleteUser, type UserSummaryRow } from './user-admin.repository.js'
import type { ChangeUserStatusInput, ListUsersQuery } from './user-admin.schema.js'
import { KeyedReadCache } from '../../lib/read-cache.js'
// note: dùng để xóa cache hồ sơ khi đổi trạng thái/xóa tài khoản
import { invalidateProfileCache } from './users.service.js'

type UserListResult = { items: ReturnType<typeof toUserSummary>[]; page: number; pageSize: number; total: number }
const userListCache = new KeyedReadCache<UserListResult>(30_000)

export function invalidateUserListCache() {
  userListCache.invalidate()
}

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

  const key = JSON.stringify({ role, status: query.status, q: query.q, page: query.page, pageSize: query.pageSize })
  return userListCache.get(key, async () => {
    const where: Prisma.UserWhereInput = {
      ...(role ? { role: { name: role } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? searchWhere(query.q) : {}),
    }
    const [rows, total] = await searchUsers(where, (query.page - 1) * query.pageSize, query.pageSize)
    return { items: rows.map(toUserSummary), page: query.page, pageSize: query.pageSize, total }
  })
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
    if (target.status === 'ACTIVE') throw new HttpError(409, 'Tài khoản đã được kích hoạt', 'STATUS_UNCHANGED')
    // Mở khóa vẫn giữ yêu cầu xác minh cũ; riêng INACTIVE là thao tác kích hoạt thủ công có chủ đích.
    if (target.status === 'LOCKED' && !target.emailVerifiedAt) next = 'INACTIVE'
  }

  const updated = await changeUserStatus({
    actorId: actor.id,
    userId,
    from: target.status,
    to: next,
    reason: input.reason,
    ipAddress,
    verifyEmail: target.status === 'INACTIVE' && next === 'ACTIVE',
  })
  if (!updated) throw new HttpError(409, 'Trạng thái tài khoản vừa bị thay đổi, vui lòng tải lại', 'STATUS_CONFLICT')
  invalidateUserListCache()
  // note: xóa cache /users/me để tài khoản vừa khóa bị chặn ngay (403), vừa mở khóa thì thấy trạng thái mới ngay
  invalidateProfileCache()
  return toUserSummary(updated)
}


export async function deleteAccount(actor: AuthUser, userId: number, ipAddress?: string) {
  if (actor.id === userId) throw new HttpError(400, 'Không thể tự xóa tài khoản của mình', 'CANNOT_DELETE_OWN_ACCOUNT')
  const target = await findUserSummary(userId)
  if (!target) throw new HttpError(404, 'Không tìm thấy người dùng', 'USER_NOT_FOUND')
  if (target.role.name === 'CENTER_MANAGER') throw new HttpError(403, 'Không thể xóa tài khoản Center Manager', 'CANNOT_DELETE_MANAGER')
  await softDeleteUser(actor.id, userId, ipAddress)
  invalidateUserListCache()
  // note: tài khoản đã xóa mềm cũng không được đọc hồ sơ từ cache cũ
  invalidateProfileCache()
}
