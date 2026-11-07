import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { assertSafeTestDatabase } from './test-database.js';
import { seedTrainingDemo } from './seed-training-e2e.js';

const url = process.env.TEST_DATABASE_URL;
assertSafeTestDatabase(url);

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  for (const name of ['MEMBER', 'COACH', 'CENTER_MANAGER', 'RECEPTIONIST']) {
    await prisma.role.create({ data: { name } });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CENTER_MANAGER' } });
  await prisma.user.create({
    data: {
      email: 'manager@sportcenter.local',
      displayName: 'Center Manager',
      passwordHash: await bcrypt.hash('ChangeMe123!', 12),
      emailVerifiedAt: new Date(),
      roleId: role.id,
    },
  });
  await seedTrainingDemo(prisma);
  await prisma.user.updateMany({
    where: { emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
  });

  const [member, coach, plan, enrollment] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: 'member1.demo@sportcenter.local' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'coach.demo@sportcenter.local' } }),
    prisma.workoutPlan.findFirstOrThrow({ where: { name: 'Bơi ếch nền tảng 4 tuần (demo)' } }),
    prisma.privateCourseEnrollment.findFirstOrThrow({
      where: { member: { user: { email: 'member1.demo@sportcenter.local' } } },
    }),
  ]);
  await prisma.planPrivateEnrollment.create({
    data: {
      enrollmentId: enrollment.id,
      workoutPlanId: plan.id,
      assignedById: coach.id,
      status: 'ACTIVE',
    },
  });
  for (const daysAgo of [14, 3]) {
    await prisma.progressAssessment.create({
      data: {
        memberId: member.id,
        coachId: coach.id,
        privateEnrollmentId: enrollment.id,
        assessmentDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        score: daysAgo === 3 ? 8.2 : 6.8,
        metrics: { 'Tốc độ (1–10)': daysAgo === 3 ? 8 : 6, 'Sức bền (1–10)': daysAgo === 3 ? 7 : 5 },
        coachComment: daysAgo === 3 ? 'Tiến bộ tốt, giữ đều nhịp thở.' : 'Cần ổn định kỹ thuật chân.',
        recommendation: 'Tiếp tục theo giáo án hiện tại.',
      },
    });
  }
}

main()
  .then(() => console.log('[test] Training E2E fixture is ready in the isolated test database.'))
  .finally(() => prisma.$disconnect());
