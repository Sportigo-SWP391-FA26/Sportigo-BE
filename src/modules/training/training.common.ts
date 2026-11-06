import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { HttpError } from '../../lib/http-error.js'
import { prisma } from '../../lib/prisma.js'
import { FORBIDDEN_MESSAGE } from '../../middleware/auth.js'

export const CENTER_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Nguyên văn cột "Exception / Error Message" trong backlog-and-rules.md
export const BR_MESSAGES = {
  BR42: 'Học viên chưa đăng ký hợp lệ cho buổi học này.',
  BR43: 'Bản ghi điểm danh không hợp lệ hoặc buổi học đã khóa dữ liệu.',
  BR44: 'Giáo án không cùng môn hoặc chưa được kích hoạt.',
  BR45: 'Thứ tự mục giáo án bị trùng.',
  BR46: 'Coach không phụ trách học viên hoặc ngữ cảnh đánh giá không hợp lệ.',
} as const

export function forbidden() {
  return new HttpError(403, FORBIDDEN_MESSAGE, 'FORBIDDEN')
}

export function notFound(message: string) {
  return new HttpError(404, message, 'NOT_FOUND')
}

export const idSchema = z.coerce.number().int().positive()
export const idParamsSchema = z.object({ id: idSchema })

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type Pagination = z.infer<typeof paginationSchema>

export function toSkipTake({ page, pageSize }: Pagination) {
  return { skip: (page - 1) * pageSize, take: pageSize }
}

export function toPage<T>(items: T[], total: number, pagination: Pagination) {
  return { items, page: pagination.page, pageSize: pagination.pageSize, total }
}

export type Db = Prisma.TransactionClient

export function runInTransaction<T>(work: (tx: Db) => Promise<T>) {
  return prisma.$transaction(work)
}

export function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

// Cột @db.Date: trả "YYYY-MM-DD" thay vì timestamp nửa đêm UTC
export function toDateOnly(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null
}

export function toCenterDateOnly(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CENTER_TIME_ZONE }).format(date)
}

export function parseDateOnly(value: string) {
  if (!DATE_ONLY.test(value)) throw new HttpError(400, 'Ngày không hợp lệ', 'INVALID_DATE')
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!, 12))
}

export const memberRefSelect = {
  userId: true,
  memberCode: true,
  user: { select: { displayName: true } },
} as const

export const coachRefSelect = {
  userId: true,
  coachCode: true,
  user: { select: { displayName: true } },
} as const

type PersonRow = { userId: number; user: { displayName: string } }

export function toMemberRef(member: PersonRow & { memberCode: string }) {
  return {
    id: member.userId,
    memberCode: member.memberCode,
    displayName: member.user.displayName,
  }
}

export function toCoachRef(coach: PersonRow & { coachCode: string }) {
  return {
    id: coach.userId,
    coachCode: coach.coachCode,
    displayName: coach.user.displayName,
  }
}
