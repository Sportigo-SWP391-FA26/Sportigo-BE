import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
// TEMP(FR-62): src/lib/audit.ts là bản tạm, xem comment tại đó
import { audit } from '../../lib/audit.js'

export const profileInclude = {
  role: true,
  member: true,
  coach: true,
} satisfies Prisma.UserInclude

export type ProfileRow = Prisma.UserGetPayload<{ include: typeof profileInclude }>

export type ProfileChanges = {
  user: Prisma.UserUpdateInput
  member: Prisma.MemberUpdateInput
  coach: Prisma.CoachUpdateInput
}

export function findProfileById(id: number) {
  return prisma.user.findUnique({ where: { id }, include: profileInclude })
}

export function findOtherUserByPhone(phone: string, excludeUserId: number) {
  // note: loại chính mình ra để giữ nguyên số điện thoại hiện tại không bị báo trùng
  return prisma.user.findFirst({ where: { phone, id: { not: excludeUserId } }, select: { id: true } })
}

export function updateProfile(userId: number, changes: ProfileChanges) {
  // note: User và Member/Coach là 2 bảng → cập nhật trong 1 transaction để không lưu dở dang
  return prisma.$transaction(async (tx) => {
    if (Object.keys(changes.user).length > 0) {
      await tx.user.update({ where: { id: userId }, data: changes.user })
    }
    if (Object.keys(changes.member).length > 0) {
      await tx.member.update({ where: { userId }, data: changes.member })
    }
    if (Object.keys(changes.coach).length > 0) {
      await tx.coach.update({ where: { userId }, data: changes.coach })
    }
    return tx.user.findUniqueOrThrow({ where: { id: userId }, include: profileInclude })
  })
}

export function changePassword(userId: number, passwordHash: string) {
  // note: đổi hash và thu hồi mọi refresh token trong cùng transaction → không còn phiên cũ nào refresh được
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } })
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
    // note: ghi log trong cùng transaction; không truyền oldData/newData để hash mật khẩu không bao giờ vào log
    await audit(tx, { actorId: userId, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId })
  })
}

// FR-05 đổi email: kiểm tra email đã thuộc tài khoản nào chưa (kể cả tài khoản bị khóa)
export function findUserIdByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } })
}

// note: mỗi người chỉ giữ 1 yêu cầu đang chờ; xóa yêu cầu cũ chưa dùng rồi tạo mới trong cùng transaction
export function replaceEmailChangeRequest(input: { userId: number; newEmail: string; tokenHash: string; expiresAt: Date }) {
  return prisma.$transaction([
    prisma.emailChangeRequest.deleteMany({ where: { userId: input.userId, usedAt: null } }),
    prisma.emailChangeRequest.create({ data: input, select: { id: true, expiresAt: true } }),
  ])
}

export function findPendingEmailChange(userId: number) {
  return prisma.emailChangeRequest.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: 'desc' } })
}

export function applyEmailChange(input: { requestId: number; userId: number; oldEmail: string; newEmail: string }) {
  return prisma.$transaction(async (tx) => {
    // note: đánh dấu đã dùng có điều kiện → 2 request xác nhận cùng lúc chỉ 1 cái thành công, mã không dùng lại được
    const consumed = await tx.emailChangeRequest.updateMany({
      where: { id: input.requestId, userId: input.userId, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (consumed.count !== 1) return null
    // note: email mới đã chứng minh sở hữu bằng OTP nên ghi luôn thời điểm xác minh
    await tx.user.update({ where: { id: input.userId }, data: { email: input.newEmail, emailVerifiedAt: new Date() } })
    await audit(tx, {
      actorId: input.userId,
      action: 'EMAIL_CHANGED',
      entityType: 'User',
      entityId: input.userId,
      oldData: { email: input.oldEmail },
      newData: { email: input.newEmail },
    })
    return tx.user.findUniqueOrThrow({ where: { id: input.userId }, include: profileInclude })
  })
}

// note: P2002 = vi phạm unique constraint (vd. 2 request cùng lúc lấy 1 số điện thoại)
export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
