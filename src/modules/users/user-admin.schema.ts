import { z } from 'zod'

export const ROLE_NAMES = ['CENTER_MANAGER', 'RECEPTIONIST', 'COACH', 'MEMBER'] as const
export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'INACTIVE'] as const

// FR-09: tìm và lọc người dùng
export const listUsersSchema = z
  .object({
    // note: một ô tìm kiếm chung cho tên, email, số điện thoại hoặc mã (mã hội viên / mã Coach)
    q: z.string().trim().max(100).optional(),
    role: z.enum(ROLE_NAMES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export type ListUsersQuery = z.infer<typeof listUsersSchema>

export const userIdSchema = z.object({ id: z.coerce.number().int().positive() })

// FR-06: Manager chỉ chuyển giữa hai trạng thái ACTIVE ↔ LOCKED; INACTIVE là "chưa xác minh email" do hệ thống quản lý
export const changeUserStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'LOCKED']),
    // note: bắt buộc lý do để audit log có ngữ cảnh khi tra lại sau này
    reason: z.string().trim().min(3, 'Lý do cần ít nhất 3 ký tự').max(500),
  })
  .strict()

export type ChangeUserStatusInput = z.infer<typeof changeUserStatusSchema>
