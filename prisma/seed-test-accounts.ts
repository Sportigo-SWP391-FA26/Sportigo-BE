import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const password = '12345678'

const accounts = [
  { email: 'member1@gmail.com', displayName: 'Member Test 1', role: 'MEMBER' },
  { email: 'coach1@gmail.com', displayName: 'Coach Test 1', role: 'COACH' },
  { email: 'letan1@gmail.com', displayName: 'Lễ tân Test 1', role: 'RECEPTIONIST' },
  { email: 'centermanager1@gmail.com', displayName: 'Center Manager Test 1', role: 'CENTER_MANAGER' },
] as const

async function main() {
  const passwordHash = await bcrypt.hash(password, 12)

  for (const account of accounts) {
    const role = await prisma.role.upsert({
      where: { name: account.role },
      update: { isActive: true },
      create: { name: account.role, isActive: true },
    })
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        displayName: account.displayName,
        passwordHash,
        roleId: role.id,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
      create: {
        email: account.email,
        displayName: account.displayName,
        passwordHash,
        roleId: role.id,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    })

    if (account.role === 'MEMBER') {
      await prisma.member.upsert({
        where: { userId: user.id },
        update: { memberCode: 'TEST-MEMBER-01' },
        create: { userId: user.id, memberCode: 'TEST-MEMBER-01' },
      })
    }
    if (account.role === 'COACH') {
      await prisma.coach.upsert({
        where: { userId: user.id },
        update: { coachCode: 'TEST-COACH-01', status: 'ACTIVE' },
        create: {
          userId: user.id,
          coachCode: 'TEST-COACH-01',
          status: 'ACTIVE',
          hiredAt: new Date(),
          bio: 'Tài khoản Coach dùng để kiểm thử các luồng Sportigo.',
        },
      })
      const sport = await prisma.sport.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } })
      if (sport) {
        await prisma.coachSport.upsert({
          where: { coachId_sportId: { coachId: user.id, sportId: sport.id } },
          update: {},
          create: { coachId: user.id, sportId: sport.id },
        })
      }
    }
    if (account.role === 'RECEPTIONIST') {
      await prisma.receptionist.upsert({
        where: { userId: user.id },
        update: { staffCode: 'TEST-REC-01' },
        create: { userId: user.id, staffCode: 'TEST-REC-01', hiredAt: new Date() },
      })
    }
  }

  console.log('[seed-test-accounts] 4 test accounts are ready.')
}

main()
  .catch((error) => {
    console.error('[seed-test-accounts] Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
