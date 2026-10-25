import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import { resendVerification } from '../auth/auth.service.js'
import { isUniqueViolation } from './users.repository.js'
import {
  createStaff as insertStaff,
  findStaff,
  findUserByEmailOrPhone,
  isStaffCodeTaken,
  searchStaff,
  updateStaff as saveStaff,
  type StaffChanges,
  type StaffRow,
} from './staff.repository.js'
import { COACH_ONLY_FIELDS, STAFF_ROLES, type CreateStaffInput, type ListStaffQuery, type UpdateStaffInput } from './staff.schema.js'

const toDateOnly = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null)
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`)

const isStaffRole = (role: string): role is (typeof STAFF_ROLES)[number] => (STAFF_ROLES as readonly string[]).includes(role)

export function toStaff(user: StaffRow) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role.name,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    // note: Coach dùng coachCode, Receptionist dùng staffCode; FE chỉ thấy một cột "staffCode"
    staffCode: user.coach?.coachCode ?? user.receptionist?.staffCode ?? null,
    hiredAt: toDateOnly(user.coach?.hiredAt ?? user.receptionist?.hiredAt),
    bio: user.coach?.bio ?? null,
    coachStatus: user.coach?.status ?? null,
    createdAt: user.createdAt,
  }
}

function duplicateAccount(found: { email: string; phone: string | null }, email?: string) {
  const field = found.email === email ? 'email' : 'phone'
  return new HttpError(409, (field === 'email' ? 'Email' : 'Số điện thoại') + ' đã được sử dụng', 'ACCOUNT_EXISTS', { field })
}

const duplicateCode = () => new HttpError(409, 'Mã nhân sự đã tồn tại', 'STAFF_CODE_EXISTS', { field: 'staffCode' })

// FR-07
export async function listStaff(query: ListStaffQuery) {
  const contains = { contains: query.q ?? '', mode: 'insensitive' as const }
  const where: Prisma.UserWhereInput = {
    role: { name: query.role ? query.role : { in: [...STAFF_ROLES] } },
    ...(query.q
      ? {
          OR: [
            { displayName: contains },
            { email: contains },
            { phone: { contains: query.q } },
            { coach: { coachCode: contains } },
            { receptionist: { staffCode: contains } },
          ],
        }
      : {}),
  }
  const [rows, total] = await searchStaff(where, (query.page - 1) * query.pageSize, query.pageSize)
  return { items: rows.map(toStaff), page: query.page, pageSize: query.pageSize, total }
}

// FR-07
export async function createStaff(actor: AuthUser, input: CreateStaffInput, ipAddress?: string) {
  if (input.role === 'RECEPTIONIST' && input.bio !== undefined) {
    throw new HttpError(400, 'Trường không áp dụng cho Receptionist', 'FIELD_NOT_ALLOWED', { fields: ['bio'] })
  }
  const existing = await findUserByEmailOrPhone(input.email, input.phone)
  if (existing) throw duplicateAccount(existing, input.email)
  if (await isStaffCodeTaken(input.staffCode)) throw duplicateCode()

  let created: StaffRow
  try {
    created = await insertStaff(
      {
        role: input.role,
        staffCode: input.staffCode,
        displayName: input.displayName,
        email: input.email,
        phone: input.phone,
        passwordHash: await bcrypt.hash(input.password, 12),
        hiredAt: input.hiredAt ? toDate(input.hiredAt) : null,
        bio: input.bio ?? null,
      },
      actor.id,
      ipAddress,
    )
  } catch (error) {
    // note: 2 Manager tạo cùng lúc vượt qua pre-check → unique của DB chặn, trả 409 thay vì 500
    if (isUniqueViolation(error)) throw new HttpError(409, 'Email, số điện thoại hoặc mã nhân sự đã tồn tại', 'ACCOUNT_EXISTS')
    throw error
  }

  // note: gửi OTP xác minh bằng luồng sẵn có của auth; lỗi gửi mail không làm hỏng tài khoản đã tạo
  let emailSent = true
  try {
    await resendVerification(created.email)
  } catch (error) {
    console.error('Verification email could not be delivered after staff creation', error)
    emailSent = false
  }
  return { ...toStaff(created), emailSent }
}

// FR-07
export async function updateStaff(actor: AuthUser, userId: number, input: UpdateStaffInput, ipAddress?: string) {
  const staff = await findStaff(userId)
  // note: id của Member/Manager cũng trả 404 để API này chỉ thao tác trên nhân sự
  if (!staff || !isStaffRole(staff.role.name)) throw new HttpError(404, 'Không tìm thấy nhân sự', 'STAFF_NOT_FOUND')

  const isCoach = staff.role.name === 'COACH'
  const notAllowed = isCoach ? [] : COACH_ONLY_FIELDS.filter((field) => field in input)
  if (notAllowed.length > 0) {
    throw new HttpError(400, 'Trường không áp dụng cho Receptionist', 'FIELD_NOT_ALLOWED', { fields: notAllowed })
  }
  // note: Receptionist tạo trước khi có bảng Receptionist chưa có mã → lần sửa đầu phải nhập mã
  if (!isCoach && !staff.receptionist && input.hiredAt !== undefined && !input.staffCode) {
    throw new HttpError(400, 'Cần nhập mã nhân sự trước', 'STAFF_CODE_REQUIRED', { fields: ['staffCode'] })
  }

  const current = toStaff(staff)
  if (input.phone && input.phone !== staff.phone) {
    const existing = await findUserByEmailOrPhone(undefined, input.phone, userId)
    if (existing) throw duplicateAccount(existing)
  }
  if (input.staffCode && input.staffCode !== current.staffCode && (await isStaffCodeTaken(input.staffCode, userId))) {
    throw duplicateCode()
  }

  // note: chọn từng trường vào đúng bảng, không spread body (tránh mass assignment)
  const changes: StaffChanges = { user: {}, coach: {}, receptionist: {} }
  if (input.displayName !== undefined) changes.user.displayName = input.displayName
  if (input.phone !== undefined) changes.user.phone = input.phone
  const hiredAt = input.hiredAt === undefined ? undefined : input.hiredAt === null ? null : toDate(input.hiredAt)
  if (isCoach) {
    if (input.staffCode !== undefined) changes.coach.coachCode = input.staffCode
    if (hiredAt !== undefined) changes.coach.hiredAt = hiredAt
    if (input.bio !== undefined) changes.coach.bio = input.bio
    if (input.coachStatus !== undefined) changes.coach.status = input.coachStatus
  } else {
    if (input.staffCode !== undefined) changes.receptionist.staffCode = input.staffCode
    if (hiredAt !== undefined) changes.receptionist.hiredAt = hiredAt
  }

  // note: audit chỉ lưu các trường thực sự gửi lên, kèm giá trị cũ để tra lại
  const sent = Object.keys(input) as (keyof UpdateStaffInput)[]
  const oldData = Object.fromEntries(sent.map((field) => [field, current[field]]))
  try {
    const updated = await saveStaff(userId, changes, { actorId: actor.id, oldData, newData: input, ipAddress })
    return toStaff(updated)
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, 'Số điện thoại hoặc mã nhân sự đã tồn tại', 'ACCOUNT_EXISTS')
    throw error
  }
}
