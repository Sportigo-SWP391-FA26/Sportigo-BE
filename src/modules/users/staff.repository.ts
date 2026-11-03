import type { Prisma } from '@prisma/client'
import { audit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'

// note: không select passwordHash; lấy cả 2 bảng hồ sơ vì một nhân sự chỉ có 1 trong 2
export const staffSelect = {
  id: true,
  email: true,
  phone: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  role: { select: { name: true } },
  coach: { select: { coachCode: true, bio: true, status: true, hiredAt: true } },
  receptionist: { select: { staffCode: true, hiredAt: true } },
} satisfies Prisma.UserSelect

export type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>

export function searchStaff(where: Prisma.UserWhereInput, skip: number, take: number) {
  return Promise.all([
    prisma.user.findMany({ where, select: staffSelect, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], skip, take }),
    prisma.user.count({ where }),
  ])
}

export function findStaff(id: number) {
  return prisma.user.findUnique({ where: { id }, select: staffSelect })
}

export function findUserByEmailOrPhone(email: string | undefined, phone: string | undefined, excludeUserId?: number) {
  const or: Prisma.UserWhereInput[] = []
  if (email) or.push({ email })
  if (phone) or.push({ phone })
  if (or.length === 0) return Promise.resolve(null)
  return prisma.user.findFirst({
    where: { OR: or, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { email: true, phone: true },
  })
}

// note: mã nhân sự phải duy nhất trên cả 2 bảng Coach và Receptionist (unique của DB chỉ chặn trong từng bảng)
export async function isStaffCodeTaken(code: string, excludeUserId?: number) {
  const notSelf = excludeUserId ? { userId: { not: excludeUserId } } : {}
  const [coach, receptionist] = await prisma.$transaction([
    prisma.coach.count({ where: { coachCode: { equals: code, mode: 'insensitive' }, ...notSelf } }),
    prisma.receptionist.count({ where: { staffCode: { equals: code, mode: 'insensitive' }, ...notSelf } }),
  ])
  return coach + receptionist > 0
}

export type NewStaff = {
  role: 'COACH' | 'RECEPTIONIST'
  displayName: string
  email: string
  phone: string
  passwordHash: string
  avatarUrl: string | null
  hiredAt: Date | null
  bio: string | null
}

export function createStaff(data: NewStaff, actorId: number, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        displayName: data.displayName,
        passwordHash: data.passwordHash,
        avatarUrl: data.avatarUrl,
        // note: INACTIVE + chưa xác minh → nhân sự phải nhập OTP gửi về email trước khi đăng nhập (giống đăng ký Member)
        status: 'INACTIVE',
        role: { connect: { name: data.role } },
      },
      select: { id: true },
    })
    // Mã dựa trên userId nên duy nhất, ổn định và không cần Manager nhập hoặc xử lý tranh chấp đồng thời.
    const staffCode = `${data.role === 'COACH' ? 'COA' : 'REC'}-${String(createdUser.id).padStart(6, '0')}`
    if (data.role === 'COACH') {
      await tx.coach.create({ data: { userId: createdUser.id, coachCode: staffCode, hiredAt: data.hiredAt, bio: data.bio } })
    } else {
      await tx.receptionist.create({ data: { userId: createdUser.id, staffCode, hiredAt: data.hiredAt } })
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: createdUser.id }, select: staffSelect })
    await audit(tx, {
      actorId,
      action: 'STAFF_CREATED',
      entityType: 'User',
      entityId: user.id,
      newData: { role: data.role, staffCode, email: data.email },
      ipAddress,
    })
    return user
  })
}

export type StaffChanges = {
  user: Prisma.UserUpdateInput
  coach: Prisma.CoachUpdateInput
  receptionist: { staffCode?: string; hiredAt?: Date | null }
}

export function updateStaff(
  userId: number,
  changes: StaffChanges,
  log: { actorId: number; oldData: unknown; newData: unknown; ipAddress?: string },
) {
  return prisma.$transaction(async (tx) => {
    if (Object.keys(changes.user).length > 0) await tx.user.update({ where: { id: userId }, data: changes.user })
    if (Object.keys(changes.coach).length > 0) await tx.coach.update({ where: { userId }, data: changes.coach })
    const { staffCode, hiredAt } = changes.receptionist
    if (staffCode !== undefined || hiredAt !== undefined) {
      // note: Receptionist tạo trước migration chưa có dòng hồ sơ → upsert; service đã bắt buộc có staffCode cho trường hợp này
      await tx.receptionist.upsert({
        where: { userId },
        update: changes.receptionist,
        create: { userId, staffCode: staffCode ?? '', hiredAt: hiredAt ?? null },
      })
    }
    await audit(tx, { ...log, action: 'STAFF_UPDATED', entityType: 'User', entityId: userId })
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select: staffSelect })
  })
}
