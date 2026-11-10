import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const [coaches, plans] = await Promise.all([
    prisma.coach.findMany({
      where: { status: 'ACTIVE', user: { deletedAt: null } },
      select: {
        userId: true,
        user: { select: { displayName: true } },
        coachSports: { select: { sport: { select: { id: true, name: true } } } },
      },
      orderBy: { userId: 'asc' },
    }),
    prisma.workoutPlan.findMany({
      select: {
        id: true, name: true, sportId: true, createdById: true, durationWeeks: true, status: true,
        _count: { select: { items: true, assignments: true } },
      },
      orderBy: { id: 'asc' },
    }),
  ])
  console.log(JSON.stringify({ coaches, plans }, null, 2))
} finally {
  await prisma.$disconnect()
}
