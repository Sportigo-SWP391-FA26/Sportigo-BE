import { PrismaClient } from '@prisma/client'

import {
  centerDateOnly,
  centerDateTime,
  centerDayOfWeek,
} from '../src/lib/center-time.js'

const prisma = new PrismaClient()

const MEMBER_EMAILS = ['member1@gmail.com', 'thanhtai15072004@gmail.com'] as const
const CLASS_NAME = 'Bơi lội kỹ thuật cơ bản'
const LEGACY_CLASS_NAME = 'DEMO-TODAY Bơi lội Flow 4'
const PLAN_NAME = 'Giáo án Yoga nền tảng 4 tuần'
const LEGACY_PLAN_NAME = 'DEMO-TODAY Giáo án Yoga'
const SESSION_NOTE = 'Buổi học Bơi lội hôm nay'
const LEGACY_SESSION_NOTE = 'DEMO-TODAY ACTIVE SESSION'
const GYM_CLASS_NAME = 'Gym sức mạnh nền tảng'
const BADMINTON_CLASS_NAME = 'Cầu lông phản xạ và kỹ thuật'

function clockDate(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return new Date(Date.UTC(1970, 0, 1, hours, minutes))
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

async function main() {
  const now = new Date()
  const today = centerDateOnly(now)
  const dayOfWeek = centerDayOfWeek(now)

  const members = await prisma.user.findMany({
    where: { email: { in: [...MEMBER_EMAILS] } },
    include: { role: true, member: true },
  })
  const memberByEmail = new Map(members.map((member) => [member.email, member]))

  for (const email of MEMBER_EMAILS) {
    const user = memberByEmail.get(email)
    if (!user || user.role.name !== 'MEMBER' || !user.member || user.status !== 'ACTIVE') {
      throw new Error(`Tài khoản ${email} không tồn tại, không ACTIVE hoặc chưa có hồ sơ Member.`)
    }
  }

  const [swimming, gym, yoga, badminton, pool, gymRoom, yogaRoom, badmintonRoom, swimCoach, gymCoach, yogaCoach, badmintonCoach, yogaCourse] = await Promise.all([
    prisma.sport.findFirst({ where: { name: 'Bơi lội', isActive: true } }),
    prisma.sport.findFirst({ where: { name: 'Gym', isActive: true } }),
    prisma.sport.findFirst({ where: { name: 'Yoga', isActive: true } }),
    prisma.sport.findFirst({ where: { name: 'Cầu lông', isActive: true } }),
    prisma.room.findFirst({ where: { code: 'SPT-POOL-01', status: 'AVAILABLE' } }),
    prisma.room.findFirst({ where: { code: 'SPT-GYM-01', status: 'AVAILABLE' } }),
    prisma.room.findFirst({ where: { code: 'SPT-YOGA-01', status: 'AVAILABLE' } }),
    prisma.room.findFirst({ where: { code: 'SPT-COURT-01', status: 'AVAILABLE' } }),
    prisma.coach.findFirst({ where: { user: { email: 'coach1@gmail.com' }, status: 'ACTIVE', coachSports: { some: { sport: { name: 'Bơi lội' } } } } }),
    prisma.coach.findFirst({ where: { user: { email: 'coach5@gmail.com' }, status: 'ACTIVE', coachSports: { some: { sport: { name: 'Gym' } } } } }),
    prisma.coach.findFirst({ where: { user: { email: 'coach2@gmail.com' }, status: 'ACTIVE', coachSports: { some: { sport: { name: 'Yoga' } } } } }),
    prisma.coach.findFirst({ where: { user: { email: 'coach3@gmail.com' }, status: 'ACTIVE', coachSports: { some: { sport: { name: 'Cầu lông' } } } } }),
    prisma.privateCourse.findFirst({ where: { name: 'Yoga 1-1 10 buổi', status: 'ACTIVE' } }),
  ])

  if (!swimming || !gym || !yoga || !badminton || !pool || !gymRoom || !yogaRoom || !badmintonRoom || !swimCoach || !gymCoach || !yogaCoach || !badmintonCoach || !yogaCourse) {
    throw new Error('Thiếu môn, phòng, Coach hoặc khóa Yoga 1-1 cần thiết cho dữ liệu demo.')
  }

  const gymStartsAt = centerDateTime(today, { hours: 19, minutes: 30 })
  const gymEndsAt = centerDateTime(today, { hours: 21, minutes: 0 })
  const activeStartsAt = centerDateTime(today, { hours: 11, minutes: 0 })
  const activeEndsAt = centerDateTime(today, { hours: 12, minutes: 30 })
  const futureStartsAt = centerDateTime(today, { hours: 13, minutes: 30 })
  const futureEndsAt = centerDateTime(today, { hours: 15, minutes: 0 })
  const privateSlots = [
    [{ start: 7 * 60, end: 8 * 60 + 30 }, { start: 15 * 60 + 30, end: 17 * 60 }],
    [{ start: 9 * 60, end: 10 * 60 + 30 }, { start: 17 * 60 + 30, end: 19 * 60 }],
  ]

  const result = await prisma.$transaction(async (tx) => {
    const existingClass = await tx.groupClass.findFirst({
      where: { name: { in: [CLASS_NAME, LEGACY_CLASS_NAME] } },
      orderBy: { id: 'asc' },
    })
    const classData = {
      sportId: swimming.id,
      coachId: swimCoach.userId,
      name: CLASS_NAME,
      description: 'Lớp Bơi lội giúp hội viên rèn luyện kỹ thuật nền tảng, nhịp thở và sức bền.',
      capacity: Math.min(pool.capacity, 10),
      totalSessions: 1,
      sessionsPerWeek: 1,
      tuitionFee: 0,
      registrationOpenAt: addDays(today, -1),
      registrationCloseAt: activeEndsAt,
      startDate: today,
      endDate: addDays(today, 7),
      status: 'OPEN' as const,
    }
    const groupClass = existingClass
      ? await tx.groupClass.update({ where: { id: existingClass.id }, data: classData })
      : await tx.groupClass.create({ data: classData })

    const existingSession = await tx.classSession.findFirst({
      where: { classId: groupClass.id, note: { in: [SESSION_NOTE, LEGACY_SESSION_NOTE] } },
    })
    const classSession = existingSession
      ? await tx.classSession.update({
          where: { id: existingSession.id },
          data: { roomId: pool.id, coachId: swimCoach.userId, startsAt: activeStartsAt, endsAt: activeEndsAt, status: 'SCHEDULED', note: SESSION_NOTE },
        })
      : await tx.classSession.create({
          data: { classId: groupClass.id, roomId: pool.id, coachId: swimCoach.userId, startsAt: activeStartsAt, endsAt: activeEndsAt, status: 'SCHEDULED', note: SESSION_NOTE },
        })

    async function upsertAdditionalClass(input: {
      name: string
      description: string
      sportId: number
      coachId: number
      roomId: number
      roomCapacity: number
      startsAt: Date
      endsAt: Date
      note: string
      status: 'COMPLETED' | 'SCHEDULED'
    }) {
      const existing = await tx.groupClass.findFirst({ where: { name: input.name }, orderBy: { id: 'asc' } })
      const data = {
        sportId: input.sportId,
        coachId: input.coachId,
        name: input.name,
        description: input.description,
        capacity: Math.min(input.roomCapacity, 10),
        totalSessions: 1,
        sessionsPerWeek: 1,
        tuitionFee: 0,
        registrationOpenAt: addDays(today, -1),
        registrationCloseAt: input.endsAt,
        startDate: today,
        endDate: addDays(today, 7),
        status: 'OPEN' as const,
      }
      const item = existing
        ? await tx.groupClass.update({ where: { id: existing.id }, data })
        : await tx.groupClass.create({ data })
      const existingSlot = await tx.classSession.findFirst({ where: { classId: item.id, note: input.note } })
      const session = existingSlot
        ? await tx.classSession.update({ where: { id: existingSlot.id }, data: { roomId: input.roomId, coachId: input.coachId, startsAt: input.startsAt, endsAt: input.endsAt, status: input.status } })
        : await tx.classSession.create({ data: { classId: item.id, roomId: input.roomId, coachId: input.coachId, startsAt: input.startsAt, endsAt: input.endsAt, status: input.status, note: input.note } })
      return { groupClass: item, session }
    }

    const gymClass = await upsertAdditionalClass({
      name: GYM_CLASS_NAME,
      description: 'Lớp Gym tập trung vào kỹ thuật vận động, sức mạnh nền tảng và kiểm soát tư thế.',
      sportId: gym.id,
      coachId: gymCoach.userId,
      roomId: gymRoom.id,
      roomCapacity: gymRoom.capacity,
      startsAt: gymStartsAt,
      endsAt: gymEndsAt,
      note: 'Buổi Gym hôm nay',
      status: 'SCHEDULED',
    })
    const badmintonClass = await upsertAdditionalClass({
      name: BADMINTON_CLASS_NAME,
      description: 'Lớp Cầu lông luyện phản xạ, di chuyển và kỹ thuật đánh cầu cơ bản.',
      sportId: badminton.id,
      coachId: badmintonCoach.userId,
      roomId: badmintonRoom.id,
      roomCapacity: badmintonRoom.capacity,
      startsAt: futureStartsAt,
      endsAt: futureEndsAt,
      note: 'Buổi Cầu lông hôm nay',
      status: 'SCHEDULED',
    })
    const groupClasses = [groupClass, gymClass.groupClass, badmintonClass.groupClass]
    const classSessions = [classSession, gymClass.session, badmintonClass.session]

    const registrations = []
    const enrollments = []
    const schedules = []

    for (const [index, email] of MEMBER_EMAILS.entries()) {
      const member = memberByEmail.get(email)!
      for (const item of groupClasses) {
        registrations.push(await tx.classRegistration.upsert({
          where: { memberId_classId: { memberId: member.id, classId: item.id } },
          update: { status: 'CONFIRMED', price: 0, cancelledAt: null },
          create: { memberId: member.id, classId: item.id, status: 'CONFIRMED', price: 0 },
        }))
      }

      const existingEnrollment = await tx.privateCourseEnrollment.findFirst({
        where: { memberId: member.id, privateCourseId: yogaCourse.id, coachId: yogaCoach.userId },
        orderBy: { id: 'desc' },
      })
      const enrollmentData = {
        memberId: member.id,
        privateCourseId: yogaCourse.id,
        coachId: yogaCoach.userId,
        purchasedSessions: yogaCourse.totalSessions,
        remainingSessions: yogaCourse.totalSessions,
        purchasedPrice: 0,
        startDate: today,
        expiryDate: addDays(today, yogaCourse.validityDays),
        status: 'ACTIVE' as const,
      }
      const enrollment = existingEnrollment
        ? await tx.privateCourseEnrollment.update({ where: { id: existingEnrollment.id }, data: enrollmentData })
        : await tx.privateCourseEnrollment.create({ data: enrollmentData })
      enrollments.push(enrollment)

      const existingSchedules = await tx.privateCourseSchedule.findMany({
        where: { enrollmentId: enrollment.id, dayOfWeek, effectiveFrom: today },
        orderBy: { id: 'asc' },
      })
      for (const [slotIndex, slot] of privateSlots[index].entries()) {
        const scheduleData = {
          enrollmentId: enrollment.id,
          roomId: yogaRoom.id,
          dayOfWeek,
          startTime: clockDate(slot.start),
          endTime: clockDate(slot.end),
          effectiveFrom: today,
          effectiveTo: addDays(today, yogaCourse.validityDays),
          status: 'ACTIVE' as const,
        }
        const existingSchedule = existingSchedules[slotIndex]
        schedules.push(existingSchedule
          ? await tx.privateCourseSchedule.update({
              where: { id: existingSchedule.id },
              data: scheduleData,
            })
          : await tx.privateCourseSchedule.create({ data: scheduleData }))
      }
    }

    const existingPlan = await tx.workoutPlan.findFirst({
      where: { name: { in: [PLAN_NAME, LEGACY_PLAN_NAME] } },
      orderBy: { id: 'asc' },
    })
    const planData = {
      sportId: yoga.id,
      createdById: yogaCoach.userId,
      name: PLAN_NAME,
      level: 'BEGINNER',
      description: 'Giáo án Yoga nền tảng giúp cải thiện khả năng hít thở, độ linh hoạt và thăng bằng.',
      durationWeeks: 4,
      status: 'ACTIVE' as const,
    }
    const workoutPlan = existingPlan
      ? await tx.workoutPlan.update({ where: { id: existingPlan.id }, data: planData })
      : await tx.workoutPlan.create({ data: planData })

    const items = [
      ['Khởi động và hít thở', 'Khởi động khớp, điều hòa nhịp thở và chuẩn bị vận động.', 10],
      ['Chuỗi tư thế nền tảng', 'Thực hiện các tư thế Yoga cơ bản, chú trọng kỹ thuật và thăng bằng.', 35],
      ['Giãn cơ và phục hồi', 'Giãn cơ toàn thân và thả lỏng sau buổi tập.', 15],
    ] as const
    for (const [index, [title, content, durationMinutes]] of items.entries()) {
      await tx.workoutPlanItem.upsert({
        where: { workoutPlanId_weekNumber_sessionNumber_itemOrder: { workoutPlanId: workoutPlan.id, weekNumber: 1, sessionNumber: 1, itemOrder: index + 1 } },
        update: { title, content, durationMinutes, intensity: 'LOW' },
        create: { workoutPlanId: workoutPlan.id, weekNumber: 1, sessionNumber: 1, itemOrder: index + 1, title, content, durationMinutes, intensity: 'LOW' },
      })
    }

    for (const enrollment of enrollments) {
      await tx.planPrivateEnrollment.upsert({
        where: { enrollmentId_workoutPlanId: { enrollmentId: enrollment.id, workoutPlanId: workoutPlan.id } },
        update: { assignedById: yogaCoach.userId, status: 'ACTIVE' },
        create: { enrollmentId: enrollment.id, workoutPlanId: workoutPlan.id, assignedById: yogaCoach.userId, status: 'ACTIVE' },
      })
    }

    return { groupClasses, classSessions, registrations, enrollments, schedules, workoutPlan }
  }, { timeout: 30_000 })

  console.log('[demo-today] Done.')
  console.log(JSON.stringify({
    date: today.toISOString().slice(0, 10),
    members: MEMBER_EMAILS,
    groupClasses: result.groupClasses.map(({ id, name }) => ({ id, name })),
    classSessions: result.classSessions.map(({ id, classId, startsAt, endsAt, status }) => ({ id, classId, startsAt, endsAt, status })),
    registrations: result.registrations.map(({ id, memberId, status }) => ({ id, memberId, status })),
    privateCourse: { id: yogaCourse.id, name: yogaCourse.name, coach: 'coach2@gmail.com' },
    enrollments: result.enrollments.map(({ id, memberId, status }) => ({ id, memberId, status })),
    schedules: result.schedules.map(({ id, enrollmentId, dayOfWeek, startTime, endTime }) => ({ id, enrollmentId, dayOfWeek, startTime, endTime })),
    workoutPlan: { id: result.workoutPlan.id, name: result.workoutPlan.name },
  }, null, 2))
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('[demo-today] Failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
