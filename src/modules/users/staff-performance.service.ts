import {
  countAssessmentsByCoach,
  countMembersCreatedByReceptionist,
  countOpenSupportByReceptionist,
  countPrivateSessionsByCoach,
  findCurrentTrainees,
  findHeldClassSessions,
  findResolvedSupportRequests,
  findStaffForPerformance,
  sumCashCollectedByReceptionist,
} from './staff-performance.repository.js'
import { toDateColumnRange, toInstantRange, type StaffPerformanceQuery } from './staff-performance.schema.js'

// note: làm tròn 1 chữ số thập phân cho số giờ trung bình; 4 chữ số cho tỷ lệ (FE tự đổi sang %)
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits
// note: tăng biến đếm trong Map, dùng chung cho mọi chỉ số đếm theo nhân sự
const bump = (map: Map<number, number>, key: number | null | undefined, by = 1) => {
  if (key !== null && key !== undefined) map.set(key, (map.get(key) ?? 0) + by)
}
// note: kết quả groupBy của Prisma → Map<id nhân sự, số lượng>
const countMap = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, number | null>)[], key: K) =>
  new Map(rows.filter((row) => row[key] !== null).map((row) => [row[key] as number, row._count._all]))

// FR-65: hiệu suất nhân sự trong khoảng thời gian; chỉ đọc dữ liệu có sẵn, không thêm bảng
export async function getStaffPerformance(query: StaffPerformanceQuery, now = new Date()) {
  const range = toInstantRange(query)
  const staff = await findStaffForPerformance()
  const coaches = staff.filter((user) => user.role.name === 'COACH')
  const receptionists = staff.filter((user) => user.role.name === 'RECEPTIONIST')
  const coachIds = coaches.map((user) => user.id)
  const receptionistIds = receptionists.map((user) => user.id)

  // note: chạy song song các truy vấn độc lập để trang không phải chờ lần lượt từng câu
  const [sessions, privateRows, assessmentRows, [registrations, enrollments], resolved, openRows, cashRows, memberRows] =
    await Promise.all([
      coachIds.length ? findHeldClassSessions(coachIds, range, now) : [],
      coachIds.length ? countPrivateSessionsByCoach(coachIds, range) : [],
      coachIds.length ? countAssessmentsByCoach(coachIds, toDateColumnRange(query)) : [],
      coachIds.length ? findCurrentTrainees(coachIds) : [[], []],
      receptionistIds.length ? findResolvedSupportRequests(receptionistIds, range) : [],
      receptionistIds.length ? countOpenSupportByReceptionist(receptionistIds) : [],
      receptionistIds.length ? sumCashCollectedByReceptionist(receptionistIds, range) : [],
      receptionistIds.length ? countMembersCreatedByReceptionist(receptionistIds, range) : [],
    ] as const)

  // ---------- Coach ----------
  const held = new Map<number, number>()
  const marked = new Map<number, number>()
  const attendanceTotal = new Map<number, number>()
  const attendancePresent = new Map<number, number>()
  for (const session of sessions) {
    const coachId = session.groupClass.coachId
    bump(held, coachId)
    // note: buổi có ít nhất 1 bản ghi điểm danh = Coach đã điểm danh buổi đó
    if (session.attendances.length > 0) bump(marked, coachId)
    bump(attendanceTotal, coachId, session.attendances.length)
    // note: đi muộn vẫn tính là có tham gia, giống báo cáo điểm danh của nhóm
    bump(attendancePresent, coachId, session.attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length)
  }
  const privateSessions = countMap(privateRows, 'markedById')
  const assessments = countMap(assessmentRows, 'coachId')
  // note: một học viên có thể học nhiều lớp của cùng Coach → đếm theo Set để không trùng
  const trainees = new Map<number, Set<number>>()
  const addTrainee = (coachId: number, memberId: number) => {
    if (!trainees.has(coachId)) trainees.set(coachId, new Set())
    trainees.get(coachId)!.add(memberId)
  }
  registrations.forEach((row) => addTrainee(row.groupClass.coachId, row.memberId))
  enrollments.forEach((row) => addTrainee(row.coachId, row.memberId))

  const coachItems = coaches.map((user) => {
    const total = attendanceTotal.get(user.id) ?? 0
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      staffCode: user.coach?.coachCode ?? null,
      accountStatus: user.status,
      coachStatus: user.coach?.status ?? null,
      groupSessionsHeld: held.get(user.id) ?? 0,
      groupSessionsMarked: marked.get(user.id) ?? 0,
      privateSessions: privateSessions.get(user.id) ?? 0,
      // note: null khi chưa có bản ghi điểm danh nào, để FE hiện "—" thay vì 0% gây hiểu nhầm
      attendanceRate: total > 0 ? round((attendancePresent.get(user.id) ?? 0) / total, 4) : null,
      assessments: assessments.get(user.id) ?? 0,
      activeTrainees: trainees.get(user.id)?.size ?? 0,
    }
  })

  // ---------- Lễ tân ----------
  const resolvedCount = new Map<number, number>()
  const resolutionHours = new Map<number, number>()
  for (const request of resolved) {
    // note: tính công cho người phụ trách cuối cùng của yêu cầu
    const receptionistId = request.assignments[0]?.assignedToId
    if (!receptionistId || !receptionistIds.includes(receptionistId) || !request.resolvedAt) continue
    bump(resolvedCount, receptionistId)
    bump(resolutionHours, receptionistId, (request.resolvedAt.getTime() - request.createdAt.getTime()) / 3_600_000)
  }
  const openSupport = countMap(openRows, 'assignedToId')
  const members = countMap(memberRows, 'actorId')
  const cash = new Map(
    cashRows
      .filter((row) => row.collectedById !== null)
      // note: Decimal của Prisma → số, để FE định dạng tiền VND
      .map((row) => [row.collectedById as number, { amount: Number(row._sum.amount?.toString() ?? 0), count: row._count._all }]),
  )

  const receptionistItems = receptionists.map((user) => {
    const solved = resolvedCount.get(user.id) ?? 0
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      staffCode: user.receptionist?.staffCode ?? null,
      accountStatus: user.status,
      supportResolved: solved,
      supportInProgress: openSupport.get(user.id) ?? 0,
      avgResolutionHours: solved > 0 ? round((resolutionHours.get(user.id) ?? 0) / solved, 1) : null,
      cashCollected: cash.get(user.id)?.amount ?? 0,
      cashPayments: cash.get(user.id)?.count ?? 0,
      membersCreated: members.get(user.id) ?? 0,
    }
  })

  // note: tổng cả trung tâm cho các ô số liệu đầu trang
  const sum = <T>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0)
  return {
    from: query.from,
    to: query.to,
    totals: {
      groupSessionsHeld: sum(coachItems, (c) => c.groupSessionsHeld),
      privateSessions: sum(coachItems, (c) => c.privateSessions),
      supportResolved: sum(receptionistItems, (r) => r.supportResolved),
      cashCollected: sum(receptionistItems, (r) => r.cashCollected),
      membersCreated: sum(receptionistItems, (r) => r.membersCreated),
    },
    coaches: coachItems,
    receptionists: receptionistItems,
  }
}
