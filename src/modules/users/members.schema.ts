import { z } from 'zod'
import { dateOnlySchema } from './users.schema.js'

// FR-08: Receptionist tạo tài khoản Member tại quầy; mật khẩu do hội viên tự đặt sau khi xác minh email
export const createMemberSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().regex(/^(0|\+84)[0-9]{9,10}$/, 'Số điện thoại không hợp lệ'),
    dateOfBirth: dateOnlySchema.optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    emergencyContact: z.string().trim().min(1).max(100).optional(),
  })
  // note: strict → không nhận memberCode/password/role từ client, mã do hệ thống sinh
  .strict()

export type CreateMemberInput = z.infer<typeof createMemberSchema>
