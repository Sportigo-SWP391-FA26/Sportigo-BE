import type { Prisma } from '@prisma/client'
import type { AuthUser } from '../../middleware/auth.js'
import { searchCoachMembers, type CoachMemberRow } from './coach-members.repository.js'
import type { ListCoachMembersQuery } from './coach-members.schema.js'
import { assignedEnrollment, assignedRegistration } from './member-profile.repository.js'
import { KeyedReadCache } from '../../lib/read-cache.js'
import { prisma } from '../../lib/prisma.js'
import { taughtByCoachWhere } from '../../lib/session-coach.js' // note: FR-66

const toDateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

function toCoachMember(row: CoachMemberRow) {
  const member = row.member
  const latest = member?.assessments[0]
  const enrollments = member?.privateEnrollments ?? []
  return {
    id: row.id,
    displayName: row.displayName,
    memberCode: member?.memberCode ?? null,
    trainingGoal: member?.trainingGoal ?? null,
    gender: member?.gender ?? null,
    dateOfBirth: toDateOnly(member?.dateOfBirth ?? null),
    classes: (member?.registrations ?? []).map(({ groupClass }) => ({
      id: groupClass.id,
      name: groupClass.name,
      sport: groupClass.sport.name,
      status: groupClass.status,
    })),
    privateCourses: enrollments.map((enrollment) => ({
      enrollmentId: enrollment.id,
      name: enrollment.privateCourse.name,
      sport: enrollment.privateCourse.sport.name,
      status: enrollment.status,
      remainingSessions: enrollment.remainingSessions,
      expiryDate: toDateOnly(enrollment.expiryDate),
    })),
    // note: schema chưa có cột "mục tiêu" riêng → mục tiêu = giáo án đang gán + đề xuất của lần đánh giá gần nhất
    goals: {
      statedGoal: member?.trainingGoal ?? null,
      workoutPlans: enrollments.flatMap((enrollment) => enrollment.plans.map(({ workoutPlan }) => workoutPlan)),
      latestAssessment: latest
        ? {
            assessmentDate: toDateOnly(latest.assessmentDate),
            score: latest.score === null ? null : Number(latest.score.toString()),
            recommendation: latest.recommendation,
            nextAssessmentDate: toDateOnly(latest.nextAssessmentDate),
          }
        : null,
    },
  }
}

type CoachMemberList = {
  items: ReturnType<typeof toCoachMember>[]
  page: number
  pageSize: number
  total: number
}
const coachMemberCache = new KeyedReadCache<CoachMemberList>(15_000)

// FR-11
export async function listMyMembers(actor: AuthUser, query: ListCoachMembersQuery) {
  const cacheKey = JSON.stringify([actor.id, query])
  return coachMemberCache.get(cacheKey, async () => {
  const coachId = actor.id
  const byClass: Prisma.MemberWhereInput = { registrations: { some: assignedRegistration(coachId) } }
  const byPrivate: Prisma.MemberWhereInput = { privateEnrollments: { some: assignedEnrollment(coachId) } }
  const member: Prisma.MemberWhereInput =
    query.type === 'CLASS' ? byClass : query.type === 'PRIVATE' ? byPrivate : { OR: [byClass, byPrivate] }

  const where: Prisma.UserWhereInput = {
    role: { name: 'MEMBER' },
    // note: chỉ Member có lớp/khóa với Coach này → không lộ học viên ngoài phạm vi
    member,
    ...(query.q
      ? {
          OR: [
            { displayName: { contains: query.q, mode: 'insensitive' } },
            { member: { memberCode: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const [rows, total] = await searchCoachMembers(coachId, where, (query.page - 1) * query.pageSize, query.pageSize)
  return { items: rows.map(toCoachMember), page: query.page, pageSize: query.pageSize, total }
  })
}

export async function listMySessions(actor: AuthUser, range: { from: Date; to: Date }) {
  const sessions = await prisma.classSession.findMany({
    where: {
      // note: FR-66 gồm cả buổi coach được giao dạy thay, bỏ buổi đã giao cho người khác
      ...taughtByCoachWhere(actor.id),
      groupClass: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
      startsAt: { gte: range.from, lte: range.to },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      room: { select: { code: true, name: true } },
      _count: { select: { attendances: true } },
      replacedCoachId: true, // note: FR-66 có giá trị = buổi này coach đang dạy thay
      groupClass: {
        select: {
          id: true,
          name: true,
          sport: { select: { id: true, name: true } },
          _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } },
        },
      },
    },
  })

  const now = new Date()
  return sessions.map(({ groupClass, _count, replacedCoachId, ...session }) => ({
    ...session,
    isSubstitute: replacedCoachId !== null, // note: FR-66 FE hiện nhãn "Dạy thay"
    class: { id: groupClass.id, name: groupClass.name, sport: groupClass.sport },
    confirmedCount: groupClass._count.registrations,
    markedCount: _count.attendances,
    isLocked: now < session.startsAt || session.status === 'CANCELLED',
  }))
}
