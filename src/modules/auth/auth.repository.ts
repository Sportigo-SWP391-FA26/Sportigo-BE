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
      status: 'INACTIVE',
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

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, include: { role: true } })
}

export function findUserById(id: number) {
  return prisma.user.findUnique({ where: { id }, include: { role: true } })
}

export function replaceVerificationToken(userId: number, tokenHash: string, expiresAt: Date) {
  return prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } }),
  ])
}

export function findVerificationToken(tokenHash: string) {
  return prisma.emailVerificationToken.findUnique({ where: { tokenHash }, include: { user: true } })
}

export function activateVerifiedUser(tokenId: number, userId: number) {
  return prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', emailVerifiedAt: new Date() } }),
  ])
}

export function saveRefreshToken(tokenHash: string, userId: number, expiresAt: Date) {
  return prisma.refreshToken.create({ data: { tokenHash, userId, expiresAt } })
}

export function findRefreshToken(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: { include: { role: true } } } })
}

export function revokeRefreshToken(tokenHash: string) {
  return prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
}
