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

// note: P2002 = vi phạm unique constraint (vd. 2 request cùng lúc lấy 1 số điện thoại)
export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
