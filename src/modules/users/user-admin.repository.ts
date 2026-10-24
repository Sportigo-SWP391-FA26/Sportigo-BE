import type { Prisma, UserStatus } from '@prisma/client'
// TEMP(FR-62): src/lib/audit.ts là bản tạm, xem comment tại đó
import { audit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'
import { NOTIFICATION_TYPES, notify } from '../notifications/notify.js'

// note: chỉ chọn trường cần hiển thị, không bao giờ lấy passwordHash
export const userSummarySelect = {
  id: true,
  email: true,
  phone: true,
  displayName: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  role: { select: { name: true } },
  member: { select: { memberCode: true } },
  coach: { select: { coachCode: true } },
} satisfies Prisma.UserSelect

export type UserSummaryRow = Prisma.UserGetPayload<{ select: typeof userSummarySelect }>

export function findUserSummary(id: number) {
  return prisma.user.findUnique({ where: { id }, select: userSummarySelect })
}

export type StatusChange = {
  actorId: number
  userId: number
  from: UserStatus
  to: UserStatus
  reason: string
  ipAddress?: string
}

// FR-06: đổi trạng thái + thu hồi phiên + audit + thông báo trong một transaction
export function changeUserStatus(change: StatusChange) {
  return prisma.$transaction(async (tx) => {
    // note: điều kiện status = trạng thái vừa đọc → nếu Manager khác vừa đổi trước thì count = 0, không ghi đè
    const updated = await tx.user.updateMany({
      where: { id: change.userId, status: change.from },
      data: { status: change.to },
    })
    if (updated.count !== 1) return null

    if (change.to === 'LOCKED') {
      // note: thu hồi mọi refresh token → không refresh được phiên cũ; login đã tự chặn tài khoản không ACTIVE
      await tx.refreshToken.updateMany({ where: { userId: change.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    }

    const locked = change.to === 'LOCKED'
    await audit(tx, {
      actorId: change.actorId,
      action: locked ? 'USER_LOCKED' : 'USER_UNLOCKED',
      entityType: 'User',
      entityId: change.userId,
      oldData: { status: change.from },
      newData: { status: change.to, reason: change.reason },
      ipAddress: change.ipAddress,
    })
    await notify(tx, {
      userIds: [change.userId],
      type: NOTIFICATION_TYPES.ACCOUNT_STATUS,
      title: locked ? 'Tài khoản đã bị khóa' : 'Tài khoản đã được mở khóa',
      content: locked
        ? `Tài khoản của bạn đã bị khóa. Lý do: ${change.reason}. Liên hệ quầy lễ tân nếu cần hỗ trợ.`
        : 'Tài khoản của bạn đã được mở khóa, bạn có thể đăng nhập lại.',
    })
    return tx.user.findUniqueOrThrow({ where: { id: change.userId }, select: userSummarySelect })
  })
}

export function searchUsers(where: Prisma.UserWhereInput, skip: number, take: number) {
  return prisma.$transaction([
    prisma.user.findMany({
      where,
      select: userSummarySelect,
      // note: sắp theo tên rồi id để thứ tự ổn định khi chuyển trang
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ])
}
