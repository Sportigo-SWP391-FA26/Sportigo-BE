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

  const [coach, plan, enrollment] = await Promise.all([
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
}

// FR-52: đánh giá gắn với buổi đã kết thúc có điểm danh hợp lệ và chỉ số do Manager cấu hình.
// Các buổi 3–14 ngày trước nằm ngoài khối "Buổi dạy cần điểm danh" (hôm qua – hôm nay) nên không ảnh hưởng test khác.
async function seedAssessableSession() {
  const DAY = 24 * 60 * 60 * 1000;
  const [groupClass, sport, member1, member2] = await Promise.all([
    prisma.groupClass.findFirstOrThrow({ where: { name: 'Bơi cơ bản – lớp demo Training' } }),
    prisma.sport.findUniqueOrThrow({ where: { name: 'Bơi lội' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'member1.demo@sportcenter.local' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'member2.demo@sportcenter.local' } }),
  ]);
  const room = await prisma.room.findUniqueOrThrow({ where: { code: 'DEMO-POOL-01' } });
  const registrationOf = (memberId: number) =>
    prisma.classRegistration.findUniqueOrThrow({ where: { memberId_classId: { memberId, classId: groupClass.id } } });
  const [registration1, registration2] = await Promise.all([registrationOf(member1.id), registrationOf(member2.id)]);

  // Buổi đã kết thúc: Member 1 có mặt, Member 2 vắng
  const completedSession = async (daysAgo: number) => {
    const startsAt = new Date(Date.now() - daysAgo * DAY);
    const session = await prisma.classSession.create({
      data: {
        classId: groupClass.id,
        roomId: room.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 90 * 60 * 1000),
        status: 'COMPLETED',
        note: `DEMO_TRAINING_DONE_${daysAgo}D`,
      },
    });
    for (const [registration, status] of [[registration1, 'PRESENT'], [registration2, 'ABSENT']] as const) {
      await prisma.sessionAttendance.create({
        data: { registrationId: registration.id, classSessionId: session.id, status, markedById: groupClass.coachId, checkedAt: startsAt },
      });
    }
    return session;
  };

  // Hai đánh giá mẫu, mỗi đánh giá gắn đúng một buổi (ràng buộc ProgressAssessment_exactly_one_session_check)
  for (const daysAgo of [14, 7]) {
    const session = await completedSession(daysAgo);
    await prisma.progressAssessment.create({
      data: {
        memberId: member1.id,
        coachId: groupClass.coachId,
        classRegistrationId: registration1.id,
        classSessionId: session.id,
        assessmentDate: session.startsAt,
        score: daysAgo === 7 ? 8 : 7,
        metrics: { speed: daysAgo === 7 ? 8 : 6, endurance: daysAgo === 7 ? 7 : 5 },
        coachComment: daysAgo === 7 ? 'Tiến bộ tốt, giữ đều nhịp thở.' : 'Cần ổn định kỹ thuật chân.',
        recommendation: 'Tiếp tục theo giáo án hiện tại.',
      },
    });
  }

  // Buổi 3 ngày trước chưa đánh giá: form "Ghi đánh giá" chọn được
  const session = await completedSession(3);
  // Coach chỉ tạo giáo án cho môn mình dạy (CoachSport)
  await prisma.coachSport.upsert({
    where: { coachId_sportId: { coachId: groupClass.coachId, sportId: sport.id } },
    update: {},
    create: { coachId: groupClass.coachId, sportId: sport.id },
  });
  await prisma.assessmentMetricDefinition.create({
    data: { sportId: sport.id, code: 'TECHNIQUE', name: 'Kỹ thuật', unit: 'điểm', minValue: 0, maxValue: 10, isRequired: true, displayOrder: 1 },
  });
  console.log(`[test] Buổi đã kết thúc để đánh giá: id ${session.id}`);
}

main()
  .then(seedAssessableSession)
  .then(() => console.log('[test] Training E2E fixture is ready in the isolated test database.'))
  .finally(() => prisma.$disconnect());
