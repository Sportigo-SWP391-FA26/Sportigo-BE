import bcrypt from 'bcryptjs'
import { HttpError } from '../../lib/http-error.js'
// TEMP(FR-62): createSession được export tạm từ auth.service.ts, xem comment tại đó
import { createSession } from '../auth/auth.service.js'
import {
  changePassword as savePassword,
  findOtherUserByPhone,
  findProfileById,
  isUniqueViolation,
  updateProfile,
  type ProfileChanges,
  type ProfileRow,
} from './users.repository.js'
import { COACH_FIELDS, MEMBER_FIELDS, type ChangePasswordInput, type UpdateProfileInput } from './users.schema.js'

// Cột @db.Date: trả "YYYY-MM-DD" thay vì timestamp nửa đêm UTC
const toDateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

function phoneTaken() {
  return new HttpError(409, 'Số điện thoại đã được sử dụng', 'ACCOUNT_EXISTS', { field: 'phone' })
}

function toProfile(user: ProfileRow) {
  // note: chọn từng trường để không bao giờ lộ passwordHash ra response
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role.name,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    member: user.member
      ? {
          memberCode: user.member.memberCode,
          dateOfBirth: toDateOnly(user.member.dateOfBirth),
          gender: user.member.gender,
          emergencyContact: user.member.emergencyContact,
          joinedAt: user.member.joinedAt,
        }
      : null,
    coach: user.coach
      ? { coachCode: user.coach.coachCode, bio: user.coach.bio, hiredAt: toDateOnly(user.coach.hiredAt) }
      : null,
  }
}

async function requireActiveUser(userId: number) {
  const user = await findProfileById(userId)
  // note: token hợp lệ nhưng user đã bị xóa → coi như chưa đăng nhập
  if (!user) throw new HttpError(401, 'Bạn cần đăng nhập để tiếp tục', 'UNAUTHENTICATED')
  // note: middleware chỉ kiểm tra JWT; tài khoản bị khóa vẫn còn access token tới 15 phút nên phải chặn ở đây
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'Tài khoản hiện không hoạt động', 'ACCOUNT_INACTIVE')
  return user
}

function assertFieldsAllowed(user: ProfileRow, input: UpdateProfileInput) {
  const sent = Object.keys(input)
  // note: dựa vào bản ghi Member/Coach thực tế thay vì chỉ tên role, tránh update vào bảng không tồn tại
  const forbidden = [
    ...(user.member ? [] : MEMBER_FIELDS.filter((field) => sent.includes(field))),
    ...(user.coach ? [] : COACH_FIELDS.filter((field) => sent.includes(field))),
  ]
  if (forbidden.length > 0) {
    throw new HttpError(400, 'Tài khoản của bạn không được cập nhật các trường này', 'FIELD_NOT_ALLOWED', {
      fields: forbidden,
    })
  }
}

function splitChanges(input: UpdateProfileInput): ProfileChanges {
  // note: chép từng trường đã biết sang đúng bảng, không spread body (tránh mass assignment)
  const changes: ProfileChanges = { user: {}, member: {}, coach: {} }
  if (input.displayName !== undefined) changes.user.displayName = input.displayName
  if (input.phone !== undefined) changes.user.phone = input.phone
  if (input.dateOfBirth !== undefined) {
    changes.member.dateOfBirth = input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null
  }
  if (input.gender !== undefined) changes.member.gender = input.gender
  if (input.emergencyContact !== undefined) changes.member.emergencyContact = input.emergencyContact
  if (input.bio !== undefined) changes.coach.bio = input.bio
  return changes
}

export async function getMe(userId: number) {
  return toProfile(await requireActiveUser(userId))
}

export async function updateMe(userId: number, input: UpdateProfileInput) {
  const user = await requireActiveUser(userId)
  assertFieldsAllowed(user, input)

  // note: chỉ kiểm tra trùng khi số mới khác số hiện tại để báo lỗi rõ ràng trước khi ghi
  if (input.phone !== undefined && input.phone !== user.phone) {
    if (await findOtherUserByPhone(input.phone, userId)) throw phoneTaken()
  }

  try {
    return toProfile(await updateProfile(userId, splitChanges(input)))
  } catch (error) {
    // note: bước kiểm tra trước vẫn có thể bị request khác chen giữa; unique constraint của DB là chốt chặn cuối
    if (isUniqueViolation(error)) throw phoneTaken()
    throw error
  }
}

// FR-62. Độ mạnh mật khẩu và confirmPassword đã được changePasswordSchema kiểm tra ở controller.
export async function changePassword(userId: number, input: ChangePasswordInput) {
  const user = await requireActiveUser(userId)

  // note: trả 400 chứ không 401, vì interceptor FE gặp 401 sẽ tự gọi /auth/refresh rồi gửi lại request
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Mật khẩu hiện tại không đúng', 'INVALID_CURRENT_PASSWORD')
  }
  // note: so với hash đang lưu thay vì so chuỗi currentPassword, nên vẫn đúng khi hai ô nhập khác nhau
  if (await bcrypt.compare(input.newPassword, user.passwordHash)) {
    throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại', 'SAME_AS_CURRENT_PASSWORD')
  }

  // note: cost 12 giống register/reset-password của module auth
  await savePassword(userId, await bcrypt.hash(input.newPassword, 12))

  const message = 'Đổi mật khẩu thành công. Các phiên đăng nhập khác đã bị đăng xuất.'
  // note: mọi refresh token (kể cả của phiên này) vừa bị thu hồi → cấp phiên mới để người đang đổi không bị đăng xuất
  return { message, ...(await createSession(user)) }
}
