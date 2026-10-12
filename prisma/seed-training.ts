import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Dữ liệu demo cho module Training (FR-47 → FR-53). Chạy lại nhiều lần an toàn:
// chỉ tạo khi chưa có, không xóa dữ liệu của người khác.
// Mỗi lần chạy, "buổi đang diễn ra" được dời về thời điểm hiện tại để demo điểm danh.

const DEMO_PASSWORD = 'ChangeMe123!'
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

async function upsertDemoUser(
  prisma: PrismaClient,
  data: {
    email: string
    displayName: string
    role: 'COACH' | 'MEMBER'
    code: string
    passwordHash: string
  },
) {
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: data.role },
  })
  const profile =
    data.role === 'COACH'
      ? { coach: { create: { coachCode: data.code } } }
      : { member: { create: { memberCode: data.code } } }
  return prisma.user.upsert({
    where: { email: data.email },
    update: {},
    create: {
      email: data.email,
      displayName: data.displayName,
      passwordHash: data.passwordHash,
      roleId: role.id,
      ...profile,
    },
  })
}

async function upsertSession(
  prisma: PrismaClient,
  data: { classId: number; roomId: number; note: string; startsAt: Date },
) {
  const endsAt = new Date(data.startsAt.getTime() + 90 * MINUTE)
  const existing = await prisma.classSession.findFirst({
    where: { classId: data.classId, note: data.note },
  })
  if (existing) {
    return prisma.classSession.update({
      where: { id: existing.id },
      data: { startsAt: data.startsAt, endsAt, status: 'SCHEDULED' },
    })
  }
  return prisma.classSession.create({ data: { ...data, endsAt } })
}

export async function seedTrainingDemo(prisma: PrismaClient) {
  const now = Date.now()
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  const coach = await upsertDemoUser(prisma, {
    email: 'coach.demo@sportcenter.local',
    displayName: 'Lê Văn Cường',
    role: 'COACH',
    code: 'COA-DEMO-01',
    passwordHash,
  })
  const members = [
    await upsertDemoUser(prisma, {
      email: 'member1.demo@sportcenter.local',
      displayName: 'Trần Thị Bình',
      role: 'MEMBER',
      code: 'MEM-DEMO-01',
      passwordHash,
    }),
    await upsertDemoUser(prisma, {
      email: 'member2.demo@sportcenter.local',
      displayName: 'Phạm Minh Đức',
      role: 'MEMBER',
      code: 'MEM-DEMO-02',
      passwordHash,
    }),
  ]

  const sport = await prisma.sport.upsert({
    where: { name: 'Bơi lội' },
    update: {},
    create: { name: 'Bơi lội', description: 'Bơi ếch, bơi sải' },
  })
  const room = await prisma.room.upsert({
    where: { code: 'DEMO-POOL-01' },
    update: {},
    create: { code: 'DEMO-POOL-01', name: 'Hồ bơi demo', capacity: 20 },
  })

  const className = 'Bơi cơ bản – lớp demo Training'
  const groupClass =
    (await prisma.groupClass.findFirst({ where: { name: className } })) ??
    (await prisma.groupClass.create({
      data: {
        name: className,
        sportId: sport.id,
        coachId: coach.id,
        status: 'IN_PROGRESS',
        capacity: 10,
        tuitionFee: 1_500_000,
        registrationOpenAt: new Date(now - 30 * DAY),
        registrationCloseAt: new Date(now - 8 * DAY),
        startDate: new Date(now - 7 * DAY),
        endDate: new Date(now + 60 * DAY),
      },
    }))

  const ongoingSession = await upsertSession(prisma, {
    classId: groupClass.id,
    roomId: room.id,
    note: 'DEMO_TRAINING_ONGOING',
    startsAt: new Date(now - 30 * MINUTE),
  })
  const nextSession = await upsertSession(prisma, {
    classId: groupClass.id,
    roomId: room.id,
    note: 'DEMO_TRAINING_NEXT',
    startsAt: new Date(now + 2 * DAY),
  })

  for (const member of members) {
    await prisma.classRegistration.upsert({
      where: {
        memberId_classId: { memberId: member.id, classId: groupClass.id },
      },
      update: {},
      create: {
        memberId: member.id,
        classId: groupClass.id,
        status: 'CONFIRMED',
        price: 1_500_000,
      },
    })
  }

  const courseName = 'Bơi 1-1 – 12 buổi (demo)'
  const privateCourse =
    (await prisma.privateCourse.findFirst({ where: { name: courseName } })) ??
    (await prisma.privateCourse.create({
      data: {
        name: courseName,
        sportId: sport.id,
        status: 'ACTIVE',
        totalSessions: 12,
        sessionDurationMinutes: 60,
        validityDays: 90,
        price: 6_000_000,
      },
    }))
  await prisma.coachPrivateCourse.upsert({
    where: {
      coachId_privateCourseId: {
        coachId: coach.id,
        privateCourseId: privateCourse.id,
      },
    },
    update: {},
    create: { coachId: coach.id, privateCourseId: privateCourse.id },
  })
  const firstMember = members[0]!
  const enrollment =
    (await prisma.privateCourseEnrollment.findFirst({
      where: { memberId: firstMember.id, privateCourseId: privateCourse.id },
    })) ??
    (await prisma.privateCourseEnrollment.create({
      data: {
        memberId: firstMember.id,
        coachId: coach.id,
        privateCourseId: privateCourse.id,
        status: 'ACTIVE',
        purchasedSessions: 12,
        remainingSessions: 12,
        purchasedPrice: 6_000_000,
        startDate: new Date(now),
        expiryDate: new Date(now + 90 * DAY),
      },
    }))

  const planName = 'Bơi ếch nền tảng 4 tuần (demo)'
  const plan =
    (await prisma.workoutPlan.findFirst({ where: { name: planName } })) ??
    (await prisma.workoutPlan.create({
      data: {
        name: planName,
        sportId: sport.id,
        createdById: coach.id,
        level: 'BEGINNER',
        description: 'Giáo án mẫu cho người mới học bơi ếch',
        durationWeeks: 4,
        status: 'ACTIVE',
        items: {
          create: [
            {
              weekNumber: 1,
              sessionNumber: 1,
              itemOrder: 1,
              title: 'Khởi động',
              content: 'Xoay khớp, đi bộ dưới nước 5 phút',
              durationMinutes: 10,
              intensity: 'LOW',
            },
            {
              weekNumber: 1,
              sessionNumber: 1,
              itemOrder: 2,
              title: 'Thở nước',
              content: 'Hít trên mặt nước, thở ra dưới nước',
              sets: 3,
              repetitions: 10,
              intensity: 'LOW',
            },
            {
              weekNumber: 1,
              sessionNumber: 1,
              itemOrder: 3,
              title: 'Đạp chân ếch bám thành',
              content: 'Bám thành hồ, tập nhịp đạp chân',
              sets: 4,
              repetitions: 12,
              intensity: 'MEDIUM',
            },
            {
              weekNumber: 1,
              sessionNumber: 2,
              itemOrder: 1,
              title: 'Lướt nước',
              content: 'Đạp thành hồ lướt nước với phao',
              sets: 5,
              repetitions: 1,
              intensity: 'MEDIUM',
            },
            {
              weekNumber: 1,
              sessionNumber: 2,
              itemOrder: 2,
              title: 'Thả lỏng',
              content: 'Bơi nhẹ 100m, giãn cơ',
              durationMinutes: 10,
              intensity: 'LOW',
            },
          ],
        },
      },
    }))

  console.log(
    '[seed-training] Dữ liệu demo Training (mật khẩu: %s)',
    DEMO_PASSWORD,
  )
  console.table([
    { key: 'Coach', value: `coach.demo@sportcenter.local (id ${coach.id})` },
    {
      key: 'Member 1',
      value: `member1.demo@sportcenter.local (id ${firstMember.id})`,
    },
    {
      key: 'Member 2',
      value: `member2.demo@sportcenter.local (id ${members[1]!.id})`,
    },
    { key: 'Môn', value: `${sport.name} (id ${sport.id})` },
    { key: 'Lớp nhóm', value: `${groupClass.name} (id ${groupClass.id})` },
    { key: 'Buổi đang diễn ra', value: `id ${ongoingSession.id}` },
    { key: 'Buổi sắp tới', value: `id ${nextSession.id}` },
    {
      key: 'Khóa 1-1',
      value: `${privateCourse.name} (id ${privateCourse.id})`,
    },
    { key: 'Enrollment ACTIVE', value: `id ${enrollment.id} (Member 1)` },
    { key: 'Giáo án ACTIVE', value: `${plan.name} (id ${plan.id})` },
  ])
}
