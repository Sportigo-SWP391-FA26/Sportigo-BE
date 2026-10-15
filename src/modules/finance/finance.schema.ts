import { z } from 'zod'

export const idParamSchema = z.coerce.number().int().positive()
export const paginationSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) })
export const paymentListSchema = paginationSchema.extend({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), status: z.enum(['PENDING','SUCCESS','FAILED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED']).optional(), channel: z.enum(['ONLINE','COUNTER','WALLET']).optional(), memberId: z.coerce.number().int().positive().optional() })
export const revenueReportSchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), channel: z.enum(['ONLINE','COUNTER','WALLET']).optional(), itemType: z.enum(['GROUP_CLASS','PRIVATE_COURSE']).optional() })
export const classReportSchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), sportId: z.coerce.number().int().positive().optional(), coachId: z.coerce.number().int().positive().optional(), classId: z.coerce.number().int().positive().optional() })
export const auditListSchema = paginationSchema.extend({ actorId: z.coerce.number().int().positive().optional(), action: z.string().trim().min(1).optional(), entityType: z.string().trim().min(1).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() })
export const promotionApplySchema = z.object({ code: z.string().trim().min(1).max(50) })
export const walletPaymentSchema = z.object({ amount: z.coerce.number().positive().multipleOf(0.01) })
export const cashPaymentSchema = z.object({ amount: z.coerce.number().positive().multipleOf(0.01) })
export const refundCreateSchema = z.object({ requestedAmount: z.coerce.number().positive().multipleOf(0.01), reason: z.string().trim().min(5).max(1000) })
export const refundReviewSchema = z.object({ decision: z.enum(['REVIEW', 'APPROVE', 'REJECT']), note: z.string().trim().min(3).max(1000), approvedAmount: z.coerce.number().positive().multipleOf(0.01).optional() }).superRefine((value, ctx) => { if (value.decision === 'APPROVE' && !value.approvedAmount) ctx.addIssue({ code: 'custom', path: ['approvedAmount'], message: 'Cần nhập số tiền được duyệt' }) })
export const promotionSchema = z.object({
  code: z.string().trim().min(3).max(50).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(160), discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  discountValue: z.coerce.number().positive(), maxDiscount: z.coerce.number().positive().nullable().optional(),
  minOrderAmount: z.coerce.number().min(0).default(0), applicableType: z.enum(['ALL', 'GROUP_CLASS', 'PRIVATE_COURSE']).default('ALL'),
  startAt: z.coerce.date(), endAt: z.coerce.date(), totalUsageLimit: z.coerce.number().int().positive().nullable().optional(),
  perMemberLimit: z.coerce.number().int().positive().nullable().optional(), status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED']).default('DRAFT'),
}).refine((value) => value.endAt > value.startAt, { message: 'Thời gian khuyến mãi không hợp lệ', path: ['endAt'] })

export const orderItemSchema = z.object({
  itemType: z.enum(['GROUP_CLASS', 'PRIVATE_COURSE']), itemName: z.string().trim().min(2).max(200),
  unitPrice: z.coerce.number().positive(), classRegistrationId: z.number().int().positive().optional(), privateEnrollmentId: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  const references = Number(Boolean(value.classRegistrationId)) + Number(Boolean(value.privateEnrollmentId))
  if (references !== 1) ctx.addIssue({ code: 'custom', message: 'Order Item phải tham chiếu đúng một dịch vụ' })
  if (value.itemType === 'GROUP_CLASS' && !value.classRegistrationId) ctx.addIssue({ code: 'custom', message: 'Thiếu đăng ký lớp' })
  if (value.itemType === 'PRIVATE_COURSE' && !value.privateEnrollmentId) ctx.addIssue({ code: 'custom', message: 'Thiếu enrollment 1-1' })
})
