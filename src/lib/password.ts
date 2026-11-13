import { z } from 'zod'

export const PASSWORD_RULE_MESSAGE = 'Mật khẩu phải dài từ 8 đến 72 ký tự'

// BR-03: dùng chung cho đăng ký, đặt lại, đổi mật khẩu và tạo nhân sự; chỉ kiểm tra độ dài.
// 72 là giới hạn byte bcrypt dùng khi băm.
export const strongPasswordSchema = z.string().min(8, PASSWORD_RULE_MESSAGE).max(72, PASSWORD_RULE_MESSAGE)
