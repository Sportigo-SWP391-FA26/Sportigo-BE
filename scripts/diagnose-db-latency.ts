import 'dotenv/config'
import { performance } from 'node:perf_hooks'
import { prisma } from '../src/lib/prisma.js'

async function timed(label: string, fn: () => Promise<unknown>) {
  const started = performance.now()
  await fn()
  console.log(`${label}: ${Math.round(performance.now() - started)} ms`)
}

try {
  await timed('first SELECT 1', () => prisma.$queryRaw`SELECT 1`)
  for (let index = 0; index < 5; index += 1) await timed(`warm SELECT 1 #${index + 1}`, () => prisma.$queryRaw`SELECT 1`)
  await timed('groupClass.findFirst', () => prisma.groupClass.findFirst({ select: { id: true } }))
  await timed('classSession.findFirst', () => prisma.classSession.findFirst({ select: { id: true } }))
  await timed('coachAvailability.findFirst', () => prisma.coachAvailability.findFirst({ select: { id: true } }))
} finally {
  await prisma.$disconnect()
}
