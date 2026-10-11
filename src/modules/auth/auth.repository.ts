import { prisma } from '../../lib/prisma.js'
import { randomUUID } from 'node:crypto'

export function findUserByIdentifier(identifier: string) {
  return prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { phone: identifier }],
    },
    include: { role: true },
  })
}

export function findExistingUser(email: string, phone: string) {
  return prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } })
}

export function createMember(data: {
  displayName: string
  email: string
  phone: string
  passwordHash: string
}) {
  return prisma.user.create({
    data: {
      ...data,
      member: {
        create: {
          memberCode: `MEM-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      },
      role: {
        connectOrCreate: {
          where: { name: 'MEMBER' },
          create: { name: 'MEMBER' },
        },
      },
    },
    include: { role: true },
  })
}
