// TEMP(FR-62): src/lib/audit.ts là bản tạm, xem comment tại đó
import { audit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'
import { userSummarySelect } from './user-admin.repository.js'

export { generateMemberCode } from '../../lib/member-code.js'

export type NewMember = {
  displayName: string
  email: string
  phone: string
  passwordHash: string
  memberCode: string
  dateOfBirth: Date | null
  gender: string | null
  emergencyContact: string | null
}

export function createMemberAtCounter(data: NewMember, actorId: number, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        displayName: data.displayName,
        passwordHash: data.passwordHash,
        // note: INACTIVE tới khi hội viên nhập OTP xác minh email (activateVerifiedUser chuyển sang ACTIVE)
        status: 'INACTIVE',
        role: { connect: { name: 'MEMBER' } },
        member: {
          create: {
            memberCode: data.memberCode,
            dateOfBirth: data.dateOfBirth,
            gender: data.gender,
            emergencyContact: data.emergencyContact,
          },
        },
      },
      select: userSummarySelect,
    })
    await audit(tx, {
      actorId,
      action: 'MEMBER_CREATED',
      entityType: 'User',
      entityId: user.id,
      newData: { memberCode: data.memberCode, email: data.email, channel: 'COUNTER' },
      ipAddress,
    })
    return user
  })
}
