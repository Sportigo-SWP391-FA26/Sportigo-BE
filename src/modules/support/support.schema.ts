import { z } from 'zod'

// note: cột category là VarChar tự do; giới hạn danh sách ở API để FE lọc/thống kê được
export const SUPPORT_CATEGORIES = ['ACCOUNT', 'PAYMENT', 'CLASS', 'PRIVATE_COURSE', 'FACILITY', 'OTHER'] as const
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export const REQUEST_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const

// note: đã đóng hoặc hủy thì không trao đổi thêm, Member cần gửi yêu cầu mới
export const FINISHED_STATUSES = ['CLOSED', 'CANCELLED'] as const

// FR-55
export const createSupportRequestSchema = z
  .object({
    subject: z.string().trim().min(5, 'Chủ đề cần ít nhất 5 ký tự').max(200),
    category: z.enum(SUPPORT_CATEGORIES),
    description: z.string().trim().min(10, 'Nội dung cần ít nhất 10 ký tự').max(5000),
    priority: z.enum(PRIORITIES).default('MEDIUM'),
  })
  .strict()

export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>

export const listSupportRequestsSchema = z
  .object({
    status: z.enum(REQUEST_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()

export type ListSupportRequestsQuery = z.infer<typeof listSupportRequestsSchema>

export const supportRequestIdSchema = z.object({ id: z.coerce.number().int().positive() })

export const sendMessageSchema = z
  .object({ content: z.string().trim().min(1, 'Tin nhắn không được để trống').max(2000) })
  .strict()

export type SendMessageInput = z.infer<typeof sendMessageSchema>
