import type { Prisma, PrismaClient } from '@prisma/client'

// FR-54: điểm vào duy nhất để module khác tạo thông báo. Gọi trong transaction của nghiệp vụ
// (truyền tx) để thông báo chỉ được tạo khi thao tác chính thành công.

type Db = Prisma.TransactionClient | PrismaClient

export const NOTIFICATION_TYPES = {
  ACCOUNT_VERIFIED: 'ACCOUNT_VERIFIED',
  ACCOUNT_STATUS: 'ACCOUNT_STATUS',
  SCHEDULE_CHANGE: 'SCHEDULE_CHANGE',
  WAITLIST_OFFER: 'WAITLIST_OFFER',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  REFUND: 'REFUND',
  SUPPORT: 'SUPPORT',
} as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

export type NotifyInput = {
  userIds: number[]
  type: NotificationType
  title: string
  content: string
}

export async function notify(db: Db, input: NotifyInput) {
  // note: bỏ id trùng để một người không nhận 2 thông báo giống nhau trong cùng một lần
  const userIds = [...new Set(input.userIds)]
  if (userIds.length === 0) return 0
  // note: cắt tiêu đề cho vừa cột VarChar(160), tránh lỗi DB làm hỏng cả transaction nghiệp vụ
  const title = input.title.slice(0, 160)
  const result = await db.notification.createMany({
    data: userIds.map((userId) => ({ userId, type: input.type, title, content: input.content })),
  })
  return result.count
}
