import bcrypt from 'bcryptjs'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { HttpError } from '../../lib/http-error.js'
import { sendEmailChangeCode } from './email-change.mail.js'
// TEMP(FR-62): createSession được export tạm từ auth.service.ts, xem comment tại đó
import { createSession } from '../auth/auth.service.js'
import {
  applyEmailChange,
  changePassword as savePassword,
  findOtherUserByPhone,
  findPendingEmailChange,
  findProfileById,
  findUserIdByEmail,
  isUniqueViolation,
  replaceEmailChangeRequest,
  updateProfile,
  type ProfileChanges,
  type ProfileRow,
} from './users.repository.js'
import {
  COACH_FIELDS,
  MEMBER_FIELDS,
  type ChangePasswordInput,
  type EmailChangeInput,
  type UpdateProfileInput,
} from './users.schema.js'

// note: OTP đổi email sống 10 phút, bằng thời hạn OTP xác minh/quên mật khẩu của module auth
const EMAIL_CHANGE_TTL_MS = 10 * 60 * 1000
// note: băm OTP kèm userId và email mới → mã của người này không dùng được cho người khác hay email khác
const hashEmailCode = (userId: number, newEmail: string, code: string) =>
  createHash('sha256').update(`${userId}:${newEmail}:${code}`).digest('hex')

const emailTaken = () => new HttpError(409, 'Email đã được sử dụng', 'ACCOUNT_EXISTS', { field: 'newEmail' })
const invalidEmailCode = () => new HttpError(400, 'Mã OTP không đúng hoặc đã hết hạn', 'INVALID_EMAIL_CHANGE_CODE')

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

// FR-05 đổi email, bước 1: kiểm tra mật khẩu, gửi OTP tới email mới. Email thật CHƯA đổi ở bước này.
export async function requestEmailChange(userId: number, input: EmailChangeInput) {
  const user = await requireActiveUser(userId)
  // note: bắt nhập lại mật khẩu để người cầm máy đang đăng nhập sẵn không đổi được email đăng nhập của chủ tài khoản
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Mật khẩu hiện tại không đúng', 'INVALID_CURRENT_PASSWORD')
  }
  if (input.newEmail === user.email) throw new HttpError(400, 'Email mới phải khác email hiện tại', 'SAME_AS_CURRENT_EMAIL')
  // note: báo trùng sớm để người dùng không phải chờ OTP rồi mới biết email đã có người dùng
  if (await findUserIdByEmail(input.newEmail)) throw emailTaken()

  // note: OTP 6 chữ số giống luồng xác minh email của auth; chỉ lưu hash, không lưu mã gốc
  const code = randomInt(100_000, 1_000_000).toString()
  const [, created] = await replaceEmailChangeRequest({
    userId,
    newEmail: input.newEmail,
    tokenHash: hashEmailCode(userId, input.newEmail, code),
    expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
  })
  try {
    await sendEmailChangeCode({ email: input.newEmail, displayName: user.displayName, code })
  } catch (error) {
    // note: không gửi được thì người dùng không có mã để xác nhận → báo lỗi để họ bấm gửi lại
    console.error('Email change code could not be delivered', error)
    throw new HttpError(502, 'Chưa gửi được mã xác nhận tới email mới, vui lòng thử lại', 'EMAIL_DELIVERY_FAILED')
  }
  return { message: 'Đã gửi mã OTP tới email mới.', newEmail: input.newEmail, expiresAt: created.expiresAt }
}

// FR-05 đổi email, bước 2: nhập đúng OTP thì mới thay email đăng nhập
export async function confirmEmailChange(userId: number, code: string) {
  const user = await requireActiveUser(userId)
  const pending = await findPendingEmailChange(userId)
  // note: so sánh hash bằng timingSafeEqual để thời gian phản hồi không lộ mã đúng tới đâu (giống auth.verifyEmail)
  const supplied = Buffer.from(hashEmailCode(userId, pending?.newEmail ?? '', code))
  const stored = Buffer.from(pending?.tokenHash ?? hashEmailCode(0, '', 'invalid'))
  const matches = supplied.length === stored.length && timingSafeEqual(supplied, stored)
  if (!pending || !matches || pending.expiresAt <= new Date()) throw invalidEmailCode()

  // note: trong 10 phút chờ OTP có thể người khác đã đăng ký đúng email đó → kiểm tra lại trước khi ghi
  if (await findUserIdByEmail(pending.newEmail)) throw emailTaken()
  try {
    const updated = await applyEmailChange({ requestId: pending.id, userId, oldEmail: user.email, newEmail: pending.newEmail })
    // note: null = mã vừa bị dùng/hết hạn bởi request khác chen giữa
    if (!updated) throw invalidEmailCode()
    return toProfile(updated)
  } catch (error) {
    // note: unique của cột email là chốt chặn cuối khi 2 người cùng lấy một email
    if (isUniqueViolation(error)) throw emailTaken()
    throw error
  }
}
