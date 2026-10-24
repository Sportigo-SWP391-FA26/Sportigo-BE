import { z } from 'zod'

// FR-07: Manager chỉ tạo được 2 loại nhân sự này; Manager mới không tạo qua API
export const STAFF_ROLES = ['COACH', 'RECEPTIONIST'] as const
export const COACH_STATUSES = ['ACTIVE', 'INACTIVE', 'ON_LEAVE'] as const
// note: trường chỉ có ở bảng Coach; gửi cho Receptionist thì service trả 400 FIELD_NOT_ALLOWED
export const COACH_ONLY_FIELDS = ['bio', 'coachStatus'] as const

const phoneSchema = z.string().trim().regex(/^(0|\+84)[0-9]{9,10}$/, 'Số điện thoại không hợp lệ')

// note: chuẩn hóa chữ hoa để "coa-01" và "COA-01" bị coi là trùng
const staffCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,30}$/, 'Mã nhân sự gồm 3–30 ký tự chữ, số hoặc dấu gạch ngang')

const hiredAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD')
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), 'Ngày không hợp lệ')

export const listStaffSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    role: z.enum(STAFF_ROLES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export type ListStaffQuery = z.infer<typeof listStaffSchema>

export const createStaffSchema = z
  .object({
    role: z.enum(STAFF_ROLES),
    staffCode: staffCodeSchema,
    displayName: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
    phone: phoneSchema,
    // note: mật khẩu ban đầu do Manager đặt, nhân sự tự đổi lại bằng FR-62 sau khi xác minh email
    password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự').max(72),
    hiredAt: hiredAtSchema.optional(),
    bio: z.string().trim().max(1000).optional(),
  })
  .strict()

export type CreateStaffInput = z.infer<typeof createStaffSchema>

export const updateStaffSchema = z
  .object({
    staffCode: staffCodeSchema,
    displayName: z.string().trim().min(2).max(80),
    phone: phoneSchema,
    hiredAt: hiredAtSchema.nullable(),
    bio: z.string().trim().max(1000).nullable(),
    coachStatus: z.enum(COACH_STATUSES),
  })
  .partial()
  // note: strict → gửi role/email/status/password bị từ chối 400; đổi role tùy tiện là điều backlog cấm
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'Cần ít nhất một trường để cập nhật' })

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>
