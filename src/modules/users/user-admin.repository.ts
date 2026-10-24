import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

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
