import type {
  ClassStatus,
  CourseStatus,
  EnrollmentStatus,
  PlanStatus,
  RegistrationStatus,
  SessionStatus,
} from '@prisma/client'
import { prisma } from '../../src/lib/prisma.js'
import { createAccessToken } from '../../src/modules/auth/token.service.js'
import { assertSafeTestDatabase } from '../support/test-database.js'

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

let sequence = 0
function uniqueKey() {
  sequence += 1
  return `${Date.now().toString(36)}${sequence}`
}

// Xóa sạch database test (giữ bảng _prisma_migrations). Có chặn an toàn.
export async function resetDatabase() {
  assertSafeTestDatabase(process.env.DATABASE_URL)
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  )
}

type RoleName = 'CENTER_MANAGER' | 'COACH' | 'MEMBER' | 'RECEPTIONIST'
type TestUser = { id: number; role: RoleName; auth: string }

async function createUser(role: RoleName): Promise<TestUser> {
  const key = uniqueKey()
  const roleRow = await prisma.role.upsert({
    where: { name: role },
    update: {},
    create: { name: role },
  })
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${key}@test.local`,
      displayName: `${role} ${key}`,
      passwordHash: 'not-used-in-tests',
      roleId: roleRow.id,
    },
  })
  const token = createAccessToken({ userId: user.id, role })
  return { id: user.id, role, auth: `Bearer ${token}` }
}

export async function createCoach() {
  const user = await createUser('COACH')
  await prisma.coach.create({
    data: { userId: user.id, coachCode: `COA-${user.id}` },
  })
  return user
}

export async function createMember() {
  const user = await createUser('MEMBER')
  await prisma.member.create({
    data: { userId: user.id, memberCode: `MEM-${user.id}` },
  })
  return user
}

export const createManager = () => createUser('CENTER_MANAGER')
export const createReceptionist = () => createUser('RECEPTIONIST')

export function createSport(isActive = true) {
  return prisma.sport.create({
    data: { name: `Môn ${uniqueKey()}`, isActive },
  })
}

export function createRoom() {
  return prisma.room.create({
    data: { code: `R-${uniqueKey()}`, name: 'Phòng test', capacity: 30 },
  })
}

export function createGroupClass(data: {
  sportId: number
  coachId: number
  status?: ClassStatus
}) {
  const now = Date.now()
  return prisma.groupClass.create({
    data: {
      sportId: data.sportId,
      coachId: data.coachId,
      status: data.status ?? 'IN_PROGRESS',
      name: `Lớp ${uniqueKey()}`,
      capacity: 20,
      tuitionFee: 1_000_000,
      registrationOpenAt: new Date(now - 30 * DAY),
      registrationCloseAt: new Date(now - 10 * DAY),
      startDate: new Date(now - 7 * DAY),
      endDate: new Date(now + 60 * DAY),
    },
  })
}

export function createSession(data: {
  classId: number
  roomId: number
  startsAt: number
  endsAt: number
  status?: SessionStatus
}) {
  return prisma.classSession.create({
    data: {
      classId: data.classId,
      roomId: data.roomId,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      status: data.status ?? 'SCHEDULED',
    },
  })
}

export function createRegistration(data: {
  memberId: number
  classId: number
  status?: RegistrationStatus
}) {
  return prisma.classRegistration.create({
    data: {
      memberId: data.memberId,
      classId: data.classId,
      status: data.status ?? 'CONFIRMED',
      price: 1_000_000,
    },
  })
}

export function createPrivateCourse(data: {
  sportId: number
  status?: CourseStatus
}) {
  return prisma.privateCourse.create({
    data: {
      sportId: data.sportId,
      status: data.status ?? 'ACTIVE',
      name: `Khóa 1-1 ${uniqueKey()}`,
      totalSessions: 12,
      sessionDurationMinutes: 60,
      validityDays: 90,
      price: 6_000_000,
    },
  })
}

export function createEnrollment(data: {
  memberId: number
  coachId: number
  privateCourseId: number
  status?: EnrollmentStatus
}) {
  const now = Date.now()
  return prisma.privateCourseEnrollment.create({
    data: {
      memberId: data.memberId,
      coachId: data.coachId,
      privateCourseId: data.privateCourseId,
      status: data.status ?? 'ACTIVE',
      purchasedSessions: 12,
      remainingSessions: 12,
      purchasedPrice: 6_000_000,
      startDate: new Date(now - 7 * DAY),
      expiryDate: new Date(now + 83 * DAY),
    },
  })
}

export function createWorkoutPlan(data: {
  sportId: number
  createdById: number
  status?: PlanStatus
  itemCount?: number
}) {
  const itemCount = data.itemCount ?? 2
  return prisma.workoutPlan.create({
    data: {
      sportId: data.sportId,
      createdById: data.createdById,
      status: data.status ?? 'ACTIVE',
      name: `Giáo án ${uniqueKey()}`,
      level: 'BEGINNER',
      durationWeeks: 4,
      items: {
        create: Array.from({ length: itemCount }, (_, index) => ({
          weekNumber: 1,
          sessionNumber: 1,
          itemOrder: index + 1,
          title: `Bài ${index + 1}`,
          content: 'Nội dung bài tập',
        })),
      },
    },
  })
}

// Một lớp nhóm đang diễn ra với đủ loại buổi học và đăng ký để test điểm danh.
export async function createClassScenario() {
  const sport = await createSport()
  const coach = await createCoach()
  const otherCoach = await createCoach()
  const manager = await createManager()
  const room = await createRoom()
  const groupClass = await createGroupClass({
    sportId: sport.id,
    coachId: coach.id,
  })
  const otherClass = await createGroupClass({
    sportId: sport.id,
    coachId: otherCoach.id,
  })

  const now = Date.now()
  const session = (startsAt: number, status?: SessionStatus) =>
    createSession({
      classId: groupClass.id,
      roomId: room.id,
      startsAt,
      endsAt: startsAt + 90 * 60 * 1000,
      status,
    })
  const sessions = {
    ongoing: await session(now - HOUR),
    future: await session(now + DAY),
    expired: await session(now - 3 * DAY),
    cancelled: await session(now - HOUR, 'CANCELLED'),
    otherClass: await createSession({
      classId: otherClass.id,
      roomId: room.id,
      startsAt: now - HOUR,
      endsAt: now + HOUR,
    }),
  }

  const members = []
  const registrations = []
  for (let index = 0; index < 4; index += 1) {
    const member = await createMember()
    members.push(member)
    registrations.push(
      await createRegistration({ memberId: member.id, classId: groupClass.id }),
    )
  }

  const pendingMember = await createMember()
  const pendingRegistration = await createRegistration({
    memberId: pendingMember.id,
    classId: groupClass.id,
    status: 'PENDING_PAYMENT',
  })
  const outsider = await createMember()
  const outsiderRegistration = await createRegistration({
    memberId: outsider.id,
    classId: otherClass.id,
  })

  return {
    sport,
    coach,
    otherCoach,
    manager,
    room,
    groupClass,
    otherClass,
    sessions,
    members,
    registrations,
    pendingMember,
    pendingRegistration,
    outsider,
    outsiderRegistration,
  }
}
