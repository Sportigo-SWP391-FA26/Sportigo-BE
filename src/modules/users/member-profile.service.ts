import { HttpError } from '../../lib/http-error.js'
import type { AuthUser } from '../../middleware/auth.js'
import { findMemberProfile, findRecentOrders, isMemberAssignedToCoach, type MemberProfileRow } from './member-profile.repository.js'

const toDateOnly = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)
// note: Decimal của Prisma trả về dạng object; đổi sang số cho FE
const toNumber = (value: { toString(): string } | null) => (value === null ? null : Number(value.toString()))

const notFound = () => new HttpError(404, 'Không tìm thấy hội viên', 'MEMBER_NOT_FOUND')

type Member = NonNullable<MemberProfileRow['member']>

function attendanceSummary(attendances: { status: string }[]) {
  const summary = { present: 0, late: 0, absent: 0, excused: 0, total: attendances.length }
  for (const { status } of attendances) {
    if (status === 'PRESENT') summary.present++
    else if (status === 'LATE') summary.late++
    else if (status === 'ABSENT') summary.absent++
    else if (status === 'EXCUSED') summary.excused++
  }
  return summary
}

function toClassRegistrations(member: Member) {
  return member.registrations.map((registration) => ({
    id: registration.id,
    status: registration.status,
    registeredAt: registration.registeredAt,
    class: {
      id: registration.groupClass.id,
      name: registration.groupClass.name,
      sport: registration.groupClass.sport.name,
      status: registration.groupClass.status,
      startDate: toDateOnly(registration.groupClass.startDate),
      endDate: toDateOnly(registration.groupClass.endDate),
      coach: registration.groupClass.coach.user,
    },
    attendance: attendanceSummary(registration.attendances),
  }))
}

function toPrivateEnrollments(member: Member) {
  return member.privateEnrollments.map((enrollment) => ({
    id: enrollment.id,
    status: enrollment.status,
    course: { id: enrollment.privateCourse.id, name: enrollment.privateCourse.name, sport: enrollment.privateCourse.sport.name },
    coach: enrollment.coach.user,
    purchasedSessions: enrollment.purchasedSessions,
    remainingSessions: enrollment.remainingSessions,
    // note: số buổi đã học = đã mua - còn lại
    usedSessions: enrollment.purchasedSessions - enrollment.remainingSessions,
    startDate: toDateOnly(enrollment.startDate),
    expiryDate: toDateOnly(enrollment.expiryDate),
  }))
}

function toAssessments(member: Member) {
  return member.assessments.map((assessment) => ({
    id: assessment.id,
    assessmentDate: toDateOnly(assessment.assessmentDate),
    score: toNumber(assessment.score),
    coachComment: assessment.coachComment,
    recommendation: assessment.recommendation,
    nextAssessmentDate: toDateOnly(assessment.nextAssessmentDate),
    coach: assessment.coach.user,
  }))
}

// FR-10
export async function getMemberProfile(actor: AuthUser, memberId: number) {
  const isCoach = actor.role === 'COACH'
  // note: Coach chỉ xem học viên được phân công; không phải thì 404 để không lộ hội viên tồn tại
  if (isCoach && !(await isMemberAssignedToCoach(memberId, actor.id))) throw notFound()

  const row = await findMemberProfile(memberId, isCoach ? actor.id : undefined)
  if (!row?.member) throw notFound()
  const member = row.member

  // note: Coach không cần liên hệ cá nhân và lịch sử thanh toán của hội viên
  const orders = isCoach ? null : await findRecentOrders(memberId)

  return {
    id: row.id,
    displayName: row.displayName,
    email: isCoach ? null : row.email,
    phone: isCoach ? null : row.phone,
    status: row.status,
    emailVerified: row.emailVerifiedAt !== null,
    memberCode: member.memberCode,
    dateOfBirth: toDateOnly(member.dateOfBirth),
    gender: member.gender,
    emergencyContact: member.emergencyContact,
    joinedAt: member.joinedAt,
    classRegistrations: toClassRegistrations(member),
    privateEnrollments: toPrivateEnrollments(member),
    assessments: toAssessments(member),
    payments:
      orders?.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        finalAmount: toNumber(order.finalAmount),
        paidAt: order.paidAt,
        createdAt: order.createdAt,
      })) ?? null,
    // note: FE dùng để biết phần nào bị giới hạn theo quyền
    scope: isCoach ? 'COACH' : 'STAFF',
  }
}
