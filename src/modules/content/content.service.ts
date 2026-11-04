import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { audit } from '../../lib/audit.js'
import { HttpError } from '../../lib/http-error.js'

type ContentKind = 'heroes' | 'facilities' | 'partners'

const activeRegistrationStatuses = ['CONFIRMED'] as const

async function loadPublicLanding() {
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const [heroSlides, facilities, partners, settings, activeMembers, sessionsThisWeek, activeCoaches, activeSports, groupClasses, privateCourses, coaches] = await Promise.all([
    prisma.landingHeroSlide.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { sport: { select: { id: true, name: true } } } }),
    prisma.landingFacility.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.landingPartner.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.siteSetting.findUnique({ where: { id: 1 } }),
    prisma.member.count({ where: { user: { status: 'ACTIVE' } } }),
    prisma.classSession.count({ where: { status: 'SCHEDULED', startsAt: { gte: now, lt: weekEnd } } }),
    prisma.coach.count({ where: { status: 'ACTIVE', user: { status: 'ACTIVE' } } }),
    prisma.sport.count({ where: { isActive: true } }),
    prisma.groupClass.findMany({
      where: {
        status: 'OPEN',
        registrationOpenAt: { lte: now },
        registrationCloseAt: { gt: now },
        startDate: { gt: now },
      },
      orderBy: { startDate: 'asc' }, take: 4,
      include: {
        sport: { select: { id: true, name: true, imageUrl: true } },
        coach: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
        sessions: { where: { startsAt: { gte: now }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, take: 1, include: { room: { select: { id: true, name: true } } } },
        _count: { select: { registrations: { where: { status: { in: [...activeRegistrationStatuses] } } } } },
      },
    }),
    prisma.privateCourse.findMany({
      where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, take: 4,
      include: { sport: { select: { id: true, name: true, imageUrl: true } }, coaches: { where: { isActive: true }, take: 3, include: { coach: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } } } } },
    }),
    prisma.coach.findMany({
      where: { status: 'ACTIVE', user: { status: 'ACTIVE' } }, take: 6, orderBy: { hiredAt: 'asc' },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } }, coachSports: { include: { sport: { select: { id: true, name: true } } } } },
    }),
  ])

  return {
    heroSlides, facilities, partners, settings,
    stats: { activeMembers, sessionsThisWeek, activeCoaches, activeSports },
    featured: { groupClasses, privateCourses }, coaches,
  }
}

type PublicLandingResult = Awaited<ReturnType<typeof loadPublicLanding>>
const PUBLIC_LANDING_CACHE_TTL_MS = 60_000
let publicLandingCache: { expiresAt: number; promise: Promise<PublicLandingResult> } | null = null

/**
 * Landing chỉ chứa dữ liệu công khai, thay đổi ít nhưng được đọc ở mọi lượt truy cập.
 * Cache promise vừa giảm số round-trip tới Supabase vừa gộp các request đồng thời.
 */
export function getPublicLanding(): Promise<PublicLandingResult> {
  if (publicLandingCache) {
    if (publicLandingCache.expiresAt <= Date.now()) {
      const stalePromise = publicLandingCache.promise
      publicLandingCache.expiresAt = Date.now() + PUBLIC_LANDING_CACHE_TTL_MS
      void loadPublicLanding()
        .then((result) => {
          publicLandingCache = {
            expiresAt: Date.now() + PUBLIC_LANDING_CACHE_TTL_MS,
            promise: Promise.resolve(result),
          }
        })
        .catch(() => {
          // Giữ snapshot công khai gần nhất nếu database tạm thời phản hồi chậm.
        })
      return stalePromise
    }

    return publicLandingCache.promise
  }

  const promise = loadPublicLanding().catch((error) => {
    publicLandingCache = null
    throw error
  })
  publicLandingCache = { expiresAt: Date.now() + PUBLIC_LANDING_CACHE_TTL_MS, promise }
  return promise
}

function invalidatePublicLandingCache() {
  publicLandingCache = null
}

export async function subscribeNewsletter(email: string) {
  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })
  if (existing?.status === 'SUBSCRIBED') return { subscriber: existing, alreadySubscribed: true }
  const subscriber = await prisma.newsletterSubscriber.upsert({
    where: { email },
    update: { status: 'SUBSCRIBED', subscribedAt: new Date() },
    create: { email },
  })
  return { subscriber, alreadySubscribed: false }
}

export async function listContent(kind: ContentKind) {
  if (kind === 'heroes') return prisma.landingHeroSlide.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  if (kind === 'facilities') return prisma.landingFacility.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  return prisma.landingPartner.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
}

export async function createContent(kind: ContentKind, data: Record<string, unknown>, actorId: number) {
  const record = kind === 'heroes'
    ? await prisma.landingHeroSlide.create({ data: data as Prisma.LandingHeroSlideUncheckedCreateInput })
    : kind === 'facilities'
      ? await prisma.landingFacility.create({ data: data as Prisma.LandingFacilityCreateInput })
      : await prisma.landingPartner.create({ data: data as Prisma.LandingPartnerCreateInput })
  await audit(prisma, { actorId, action: 'CREATE', entityType: `LANDING_${kind.toUpperCase()}`, entityId: record.id, newData: record })
  invalidatePublicLandingCache()
  return record
}

export async function updateContent(kind: ContentKind, id: number, data: Record<string, unknown>, actorId: number) {
  const oldData = kind === 'heroes'
    ? await prisma.landingHeroSlide.findUnique({ where: { id } })
    : kind === 'facilities'
      ? await prisma.landingFacility.findUnique({ where: { id } })
      : await prisma.landingPartner.findUnique({ where: { id } })
  if (!oldData) throw new HttpError(404, 'Không tìm thấy nội dung Landing.', 'LANDING_CONTENT_NOT_FOUND')
  const record = kind === 'heroes'
    ? await prisma.landingHeroSlide.update({ where: { id }, data: data as Prisma.LandingHeroSlideUncheckedUpdateInput })
    : kind === 'facilities'
      ? await prisma.landingFacility.update({ where: { id }, data: data as Prisma.LandingFacilityUpdateInput })
      : await prisma.landingPartner.update({ where: { id }, data: data as Prisma.LandingPartnerUpdateInput })
  await audit(prisma, { actorId, action: 'UPDATE', entityType: `LANDING_${kind.toUpperCase()}`, entityId: id, oldData, newData: record })
  invalidatePublicLandingCache()
  return record
}

export async function deleteContent(kind: ContentKind, id: number, actorId: number) {
  const record = await updateContent(kind, id, { isActive: false }, actorId)
  await audit(prisma, { actorId, action: 'ARCHIVE', entityType: `LANDING_${kind.toUpperCase()}`, entityId: id, oldData: record, newData: { ...record, isActive: false } })
  return record
}

export async function getSettings() {
  return prisma.siteSetting.findUnique({ where: { id: 1 } })
}

export async function updateSettings(data: Prisma.SiteSettingUpdateInput, actorId: number) {
  const oldData = await getSettings()
  const record = await prisma.siteSetting.upsert({
    where: { id: 1 }, update: data,
    create: { id: 1, hotline: String(data.hotline), openingHours: String(data.openingHours), location: String(data.location), brandDescription: String(data.brandDescription), authPromotionTitle: data.authPromotionTitle as string | null | undefined, authPromotionDescription: data.authPromotionDescription as string | null | undefined },
  })
  await audit(prisma, { actorId, action: oldData ? 'UPDATE' : 'CREATE', entityType: 'SITE_SETTING', entityId: 1, oldData, newData: record })
  invalidatePublicLandingCache()
  return record
}

async function loadMemberHome(userId: number) {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 7)
  const [member, registrations, recommendations, privateRecommendations, notifications, payments] = await Promise.all([
    prisma.member.findUnique({
      where: { userId },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    }),
    prisma.classRegistration.findMany({
      where: { memberId: userId, status: 'CONFIRMED', groupClass: { sessions: { some: { startsAt: { gte: now }, status: 'SCHEDULED' } } } },
      include: { groupClass: { include: { sport: true, coach: { include: { user: true } }, sessions: { where: { startsAt: { gte: now, lt: end }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, include: { room: true } } } } },
      orderBy: { registeredAt: 'desc' },
    }),
    prisma.groupClass.findMany({
      where: {
        status: 'OPEN',
        registrationOpenAt: { lte: now },
        registrationCloseAt: { gt: now },
        startDate: { gt: now },
        registrations: { none: { memberId: userId } },
      },
      take: 9, orderBy: { startDate: 'asc' },
      include: { sport: true, coach: { include: { user: true } }, sessions: { where: { startsAt: { gte: now }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, take: 1, include: { room: true } }, _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } } },
    }),
    prisma.privateCourse.findMany({
      where: {
        status: 'ACTIVE',
        coaches: { some: { isActive: true, coach: { status: 'ACTIVE', user: { status: 'ACTIVE' } } } },
        enrollments: { none: { memberId: userId, status: { in: ['PENDING_PAYMENT', 'ACTIVE'] } } },
      },
      take: 6,
      orderBy: { updatedAt: 'desc' },
      include: {
        sport: { select: { id: true, name: true, imageUrl: true } },
        coaches: {
          where: { isActive: true, coach: { status: 'ACTIVE', user: { status: 'ACTIVE' } } },
          take: 3,
          include: { coach: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } } },
        },
      },
    }),
    prisma.notification.findMany({ where: { userId }, take: 5, orderBy: { createdAt: 'desc' } }),
    prisma.payment.findMany({ where: { order: { memberId: userId }, status: 'SUCCESS' }, take: 5, orderBy: { paidAt: 'desc' }, include: { order: { select: { orderNumber: true } } } }),
  ])
  if (!member) throw new HttpError(404, 'Không tìm thấy hồ sơ hội viên.', 'MEMBER_NOT_FOUND')

  const upcomingSessions = registrations.flatMap((registration) => registration.groupClass.sessions.map((session) => ({
    registrationId: registration.id, classId: registration.classId, className: registration.groupClass.name,
    sport: registration.groupClass.sport, coach: registration.groupClass.coach.user,
    sessionId: session.id, startsAt: session.startsAt, endsAt: session.endsAt, room: session.room,
  }))).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const activities = [
    ...notifications.map((item) => ({ id: `notification-${item.id}`, type: 'NOTIFICATION', title: item.title, description: item.content, occurredAt: item.createdAt })),
    ...payments.map((item) => ({ id: `payment-${item.id}`, type: 'PAYMENT', title: 'Thanh toán thành công', description: `Đơn hàng ${item.order.orderNumber}`, occurredAt: item.paidAt ?? item.createdAt })),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 5)

  return { profile: member.user, nextSession: upcomingSessions[0] ?? null, weekSchedule: upcomingSessions, recommendations, privateRecommendations, activities }
}

type MemberHomeResult = Awaited<ReturnType<typeof loadMemberHome>>
const memberHomeCache = new Map<number, { expiresAt: number; promise: Promise<MemberHomeResult> }>()

/**
 * Trang chủ chỉ tổng hợp dữ liệu đọc. Cache ngắn hạn đồng thời gộp các request
 * trùng nhau từ navbar/navigation, giảm độ trễ Supabase mà vẫn giữ lịch mới.
 */
export function getMemberHome(userId: number): Promise<MemberHomeResult> {
  const cached = memberHomeCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = loadMemberHome(userId).catch((error) => {
    memberHomeCache.delete(userId)
    throw error
  })
  memberHomeCache.set(userId, { expiresAt: Date.now() + 30_000, promise })
  return promise
}

async function loadManagerDashboard() {
  const now = new Date()
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const [
    activeMembers,
    newMembersThisMonth,
    classesToday,
    roomsInUse,
    totalRooms,
    roomsInMaintenance,
    revenue,
    previousRevenue,
    paymentsForTrend,
    registrationsForTrend,
    pendingRefunds,
    openSupportRequests,
    pendingOrders,
    classStatusRows,
    upcomingSessions,
  ] = await Promise.all([
    prisma.member.count({ where: { user: { status: 'ACTIVE' } } }),
    prisma.member.count({ where: { joinedAt: { gte: monthStart, lt: nextMonthStart } } }),
    prisma.classSession.count({ where: { startsAt: { gte: dayStart, lt: dayEnd }, status: 'SCHEDULED' } }),
    prisma.room.count({ where: { classSessions: { some: { startsAt: { lte: now }, endsAt: { gt: now }, status: 'SCHEDULED' } } } }),
    prisma.room.count({ where: { status: { not: 'INACTIVE' } } }),
    prisma.room.count({ where: { status: 'MAINTENANCE' } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: monthStart, lt: nextMonthStart } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: previousMonthStart, lt: monthStart } }, _sum: { amount: true } }),
    prisma.payment.findMany({ where: { status: 'SUCCESS', paidAt: { gte: trendStart, lt: nextMonthStart } }, select: { amount: true, paidAt: true } }),
    prisma.classRegistration.findMany({ where: { registeredAt: { gte: trendStart, lt: nextMonthStart } }, select: { registeredAt: true } }),
    prisma.refundRequest.count({ where: { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'] } } }),
    prisma.supportRequest.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } }),
    prisma.serviceOrder.count({ where: { status: 'PENDING_PAYMENT' } }),
    prisma.groupClass.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.classSession.findMany({
      where: { startsAt: { gte: now }, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        room: { select: { id: true, name: true } },
        groupClass: {
          select: {
            id: true,
            name: true,
            sport: { select: { id: true, name: true } },
            coach: { select: { user: { select: { id: true, displayName: true } } } },
          },
        },
      },
    }),
  ])

  const trend = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
    return { key: `${date.getFullYear()}-${date.getMonth()}`, month: `Thg ${date.getMonth() + 1}`, revenue: 0, registrations: 0 }
  })
  const trendByKey = new Map(trend.map((item) => [item.key, item]))
  paymentsForTrend.forEach((payment) => {
    if (!payment.paidAt) return
    const bucket = trendByKey.get(`${payment.paidAt.getFullYear()}-${payment.paidAt.getMonth()}`)
    if (bucket) bucket.revenue += Number(payment.amount)
  })
  registrationsForTrend.forEach((registration) => {
    const bucket = trendByKey.get(`${registration.registeredAt.getFullYear()}-${registration.registeredAt.getMonth()}`)
    if (bucket) bucket.registrations += 1
  })
  const classStatus = classStatusRows.reduce<Record<string, number>>((result, row) => {
    result[row.status] = row._count._all
    return result
  }, {})

  return {
    activeMembers,
    newMembersThisMonth,
    classesToday,
    roomsInUse,
    totalRooms,
    roomsInMaintenance,
    monthlyRevenue: revenue._sum.amount ?? new Prisma.Decimal(0),
    previousMonthRevenue: previousRevenue._sum.amount ?? new Prisma.Decimal(0),
    pendingRefunds,
    openSupportRequests,
    pendingOrders,
    classStatus,
    trend: trend.map((item) => ({ month: item.month, revenue: item.revenue, registrations: item.registrations })),
    upcomingSessions: upcomingSessions.map((session) => ({
      id: session.id,
      classId: session.groupClass.id,
      className: session.groupClass.name,
      sport: session.groupClass.sport,
      coach: session.groupClass.coach.user,
      room: session.room,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    })),
  }
}

type ManagerDashboardResult = Awaited<ReturnType<typeof loadManagerDashboard>>
let managerDashboardCache: {
  expiresAt: number
  promise: Promise<ManagerDashboardResult>
} | null = null

/**
 * Dashboard là dữ liệu tổng hợp đọc-only và cần nhiều phép đếm độc lập.
 * Cache ngắn hạn đồng thời gộp các request trùng nhau từ route prefetch,
 * StrictMode và việc quay lại dashboard, tránh chạy lại toàn bộ truy vấn.
 */
export function getManagerDashboard(): Promise<ManagerDashboardResult> {
  if (managerDashboardCache) {
    if (managerDashboardCache.expiresAt <= Date.now()) {
      const stalePromise = managerDashboardCache.promise
      managerDashboardCache.expiresAt = Date.now() + 30_000
      void loadManagerDashboard()
        .then((result) => {
          managerDashboardCache = {
            expiresAt: Date.now() + 30_000,
            promise: Promise.resolve(result),
          }
        })
        .catch(() => {
          // Giữ snapshot gần nhất khi Supabase tạm thời chậm hoặc mất kết nối.
        })
      return stalePromise
    }

    return managerDashboardCache.promise
  }

  const promise = loadManagerDashboard().catch((error) => {
    managerDashboardCache = null
    throw error
  })
  managerDashboardCache = { expiresAt: Date.now() + 30_000, promise }
  return promise
}
