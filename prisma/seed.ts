import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedTrainingDemo } from './seed-training.js'

const prisma = new PrismaClient()

async function main() {
  for (const name of ['MEMBER', 'COACH', 'CENTER_MANAGER', 'CASHIER', 'RECEPTIONIST', 'ADMIN']) {
    await prisma.role.upsert({ where: { name }, update: { isActive: true }, create: { name } })
  }

  const role = await prisma.role.findUniqueOrThrow({
    where: { name: 'CENTER_MANAGER' },
  })

  await prisma.user.upsert({
    where: { email: 'manager@sportcenter.local' },
    update: {},
    create: {
      email: 'manager@sportcenter.local',
      displayName: 'Center Manager',
      passwordHash: await bcrypt.hash('ChangeMe123!', 12),
      roleId: role.id,
    },
  })

  const memberRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } })
  const existingMembers = await prisma.user.findMany({
    where: { roleId: memberRole.id, member: null },
    select: { id: true },
  })

  for (const user of existingMembers) {
    await prisma.member.create({
      data: { userId: user.id, memberCode: `MEM-${String(user.id).padStart(6, '0')}` },
    })
  }

  for (const method of [
    { code: 'CASH', name: 'Tiền mặt', isOnline: false },
    { code: 'BANK_TRANSFER', name: 'Chuyển khoản', isOnline: true },
    { code: 'VNPAY', name: 'VNPay', isOnline: true },
  ]) {
    await prisma.paymentMethod.upsert({ where: { code: method.code }, update: method, create: method })
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

