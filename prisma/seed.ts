import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedTrainingDemo } from './seed-training.js'

const prisma = new PrismaClient()

async function main() {
  for (const name of [
    'MEMBER',
    'COACH',
    'CENTER_MANAGER',
    'CASHIER',
    'RECEPTIONIST',
    'ADMIN',
  ]) {
    await prisma.role.upsert({
      where: { name },
      update: { isActive: true },
      create: { name },
    })
  }

  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_ACCOUNTS === 'true') {
    const demoPasswordHash = await bcrypt.hash('12345678', 12)
    const demoAccounts = [
      {
        email: 'coach1@gmail.com',
        displayName: 'Coach Demo',
        roleName: 'COACH',
      },
      {
        email: 'letan1@gmail.com',
        displayName: 'Receptionist Demo',
        roleName: 'RECEPTIONIST',
      },
      {
        email: 'admin1@gmail.com',
        displayName: 'Center Manager Demo',
        roleName: 'CENTER_MANAGER',
      },
    ] as const

    for (const account of demoAccounts) {
      const existingUser = await prisma.user.findUnique({
        where: { email: account.email },
      })
      if (existingUser) continue
      const role = await prisma.role.findUniqueOrThrow({
        where: { name: account.roleName },
      })
      const user = await prisma.user.upsert({
        where: { email: account.email },
        update: {},
        create: {
          email: account.email,
          displayName: account.displayName,
          passwordHash: demoPasswordHash,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
          roleId: role.id,
        },
      })

      if (account.roleName === 'COACH') {
        await prisma.coach.upsert({
          where: { userId: user.id },
          update: { status: 'ACTIVE' },
          create: { userId: user.id, coachCode: 'COA-CHECK-01' },
        })
      }
    }
  }

  const memberRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'MEMBER' },
  })
  const existingMembers = await prisma.user.findMany({
    where: { roleId: memberRole.id, member: null },
    select: { id: true },
  })

  for (const user of existingMembers) {
    await prisma.member.create({
      data: {
        userId: user.id,
        memberCode: `MEM-${String(user.id).padStart(6, '0')}`,
      },
    })
  }

  for (const method of [
    { code: 'CASH', name: 'Tiền mặt', isOnline: false },
    { code: 'BANK_TRANSFER', name: 'Chuyển khoản', isOnline: true },
    { code: 'VNPAY', name: 'VNPay', isOnline: true },
  ]) {
    await prisma.paymentMethod.upsert({
      where: { code: method.code },
      update: method,
      create: method,
    })
  }

  await seedTrainingDemo(prisma)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
