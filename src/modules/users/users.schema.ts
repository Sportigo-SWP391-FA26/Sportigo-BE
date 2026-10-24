import { z } from 'zod'

// note: trường riêng theo role; service dùng 2 danh sách này để trả 400 FIELD_NOT_ALLOWED
export const MEMBER_FIELDS = ['dateOfBirth', 'gender', 'emergencyContact'] as const
export const COACH_FIELDS = ['bio'] as const

const today = () => new Date().toISOString().slice(0, 10)

// note: export để members.schema (FR-08) dùng chung rule ngày sinh
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD')
  // note: chặn ngày không tồn tại như 2001-02-30 (Date tự lăn sang tháng sau nên chuỗi sẽ khác)
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), 'Ngày không hợp lệ')
  // note: so sánh chuỗi YYYY-MM-DD theo thứ tự từ điển tương đương so sánh ngày
  .refine((value) => value >= '1900-01-01' && value <= today(), 'Ngày sinh phải từ 1900 đến hôm nay')

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    // note: cùng regex với registerSchema; không nhận null vì phone là định danh đăng nhập
    phone: z.string().trim().regex(/^(0|\+84)[0-9]{9,10}$/, 'Số điện thoại không hợp lệ'),
    dateOfBirth: dateOnlySchema.nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable(),
    emergencyContact: z.string().trim().min(1).max(100).nullable(),
    bio: z.string().trim().max(1000).nullable(),
  })
  .partial()
  // note: strict → mọi trường lạ (email, role, status, memberCode...) bị từ chối với 400 VALIDATION_ERROR
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  })

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

// note: cùng rule với registerSchema/resetPasswordSchema (8–72 ký tự; bcrypt chỉ dùng 72 byte đầu)
const passwordSchema = z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự').max(72)

export const changePasswordSchema = z
  .object({
    // note: mật khẩu hiện tại chỉ cần khác rỗng; đúng/sai do service so với hash
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const emailChangeSchema = z
  .object({
    // note: chuẩn hóa chữ thường giống register để so trùng email chính xác
    newEmail: z.string().trim().toLowerCase().email(),
    currentPassword: z.string().min(1),
  })
  .strict()

export type EmailChangeInput = z.infer<typeof emailChangeSchema>

export const confirmEmailChangeSchema = z
  .object({ code: z.string().trim().regex(/^\d{6}$/, 'Mã OTP phải gồm đúng 6 chữ số') })
  .strict()
