import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const PASSWORD = '12345678'
const PREFIX = 'FLOWTEST'

const daysFromNow = (days: number, hour = 0, minute = 0) => {
  const value = new Date()
  value.setDate(value.getDate() + days)
  value.setHours(hour, minute, 0, 0)
  return value
}

const time = (hour: number, minute = 0) =>
  new Date(Date.UTC(1970, 0, 1, hour, minute, 0))

async function ensureUser(input: {
  email: string
  displayName: string
  roleName: string
  phone: string
}) {
  const role = await prisma.role.upsert({
    where: { name: input.roleName },
    update: { isActive: true },
    create: { name: input.roleName, isActive: true },
  })
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      displayName: input.displayName,
      phone: input.phone,
      roleId: role.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      passwordHash,
    },
    create: {
      email: input.email,
      displayName: input.displayName,
      phone: input.phone,
      passwordHash,
      roleId: role.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  })
}

async function main() {
  console.log('[flow-seed] Creating idempotent Sportigo flow fixtures...')

  const manager = await ensureUser({
    email: 'flowtest.manager@gmail.com',
    displayName: 'Quản lý Sportigo Test',
    roleName: 'CENTER_MANAGER',
    phone: '0901000001',
  })
  const receptionist = await ensureUser({
    email: 'flowtest.receptionist@gmail.com',
    displayName: 'Lễ tân Sportigo Test',
    roleName: 'RECEPTIONIST',
    phone: '0901000002',
  })
  await prisma.receptionist.upsert({
    where: { userId: receptionist.id },
    update: { staffCode: `${PREFIX}-REC-01`, hiredAt: daysFromNow(-180) },
    create: { userId: receptionist.id, staffCode: `${PREFIX}-REC-01`, hiredAt: daysFromNow(-180) },
  })

  const sportInputs = [
    ['Bơi lội', 'Kỹ thuật bơi, sức bền và an toàn dưới nước', '/images/landing/hero/swimming.webp'],
    ['Gym', 'Sức mạnh, thể lực và cải thiện vóc dáng', '/images/landing/hero/gym.webp'],
    ['Yoga', 'Linh hoạt, thăng bằng và phục hồi', '/images/landing/hero/yoga.webp'],
    ['Cầu lông', 'Kỹ thuật cầu, phản xạ và chiến thuật', '/images/landing/hero/badminton.webp'],
  ] as const
  const sports = []
  for (const [name, description, imageUrl] of sportInputs) {
    sports.push(await prisma.sport.upsert({
      where: { name },
      update: { description, imageUrl, isActive: true },
      create: { name, description, imageUrl, isActive: true },
    }))
  }

  const roomInputs = [
    ['FLOW-POOL', 'Hồ bơi trong nhà', 24, 'Tầng 1'],
    ['FLOW-GYM', 'Studio sức mạnh', 20, 'Tầng 2'],
    ['FLOW-YOGA', 'Studio Yoga', 18, 'Tầng 3'],
    ['FLOW-COURT', 'Sân cầu lông A', 16, 'Tầng 1'],
  ] as const
  const rooms = []
  for (const [code, name, capacity, location] of roomInputs) {
    rooms.push(await prisma.room.upsert({
      where: { code },
      update: { name, capacity, location, status: 'AVAILABLE' },
      create: { code, name, capacity, location, status: 'AVAILABLE' },
    }))
  }

  const coachProfiles = [
    {
      email: 'flowtest.coach.swim@gmail.com', phone: '0901000011', name: 'Nguyễn Minh Hải', code: `${PREFIX}-COACH-01`,
      bio: 'HLV bơi lội 8 năm kinh nghiệm, chuyên kỹ thuật cơ bản, sửa lỗi động tác và phát triển sức bền.', sportIndexes: [0], avatarUrl: '/images/landing/coaches/minh-tran.webp',
    },
    {
      email: 'flowtest.coach.fitness@gmail.com', phone: '0901000012', name: 'Trần Thu An', code: `${PREFIX}-COACH-02`,
      bio: 'HLV thể lực và Yoga, chuyên sức mạnh nền tảng, mobility và phục hồi vận động.', sportIndexes: [1, 2], avatarUrl: '/images/landing/coaches/an-pham.webp',
    },
    {
      email: 'flowtest.coach.badminton@gmail.com', phone: '0901000013', name: 'Lê Quốc Nam', code: `${PREFIX}-COACH-03`,
      bio: 'HLV cầu lông thi đấu, chuyên footwork, phản xạ, kỹ thuật đánh cầu và chiến thuật đôi.', sportIndexes: [3], avatarUrl: '/images/landing/coaches/huy-le.webp',
    },
    {
      email: 'flowtest.coach.aquatics@gmail.com', phone: '0901000014', name: 'Linh Nguyễn', code: `${PREFIX}-COACH-04`,
      bio: 'HLV bơi và an toàn dưới nước, chuyên kỹ thuật đường dài, nhịp thở và cải thiện sức bền.', sportIndexes: [0], avatarUrl: '/images/landing/coaches/linh-nguyen.webp',
    },
    {
      email: 'flowtest.coach.functional@gmail.com', phone: '0901000015', name: 'Mai Võ', code: `${PREFIX}-COACH-05`,
      bio: 'HLV functional fitness, chuyên vận động toàn thân, sức mạnh nền tảng và điều chỉnh tư thế.', sportIndexes: [1], avatarUrl: '/images/landing/coaches/mai-vo.webp',
    },
    {
      email: 'flowtest.coach.mobility@gmail.com', phone: '0901000016', name: 'Quốc Bùi', code: `${PREFIX}-COACH-06`,
      bio: 'HLV Yoga và mobility, tập trung phục hồi, linh hoạt khớp và cân bằng vận động.', sportIndexes: [2], avatarUrl: '/images/landing/coaches/quoc-bui.webp',
    },
  ]
  const coaches = []
  for (const [index, profile] of coachProfiles.entries()) {
    const user = await ensureUser({ email: profile.email, displayName: profile.name, roleName: 'COACH', phone: profile.phone })
    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: profile.avatarUrl } })
    const coach = await prisma.coach.upsert({
      where: { userId: user.id },
      update: { coachCode: profile.code, bio: profile.bio, status: 'ACTIVE', hiredAt: daysFromNow(-365 - index * 90) },
      create: { userId: user.id, coachCode: profile.code, bio: profile.bio, status: 'ACTIVE', hiredAt: daysFromNow(-365 - index * 90) },
    })
    for (const sportIndex of profile.sportIndexes) {
      await prisma.coachSport.upsert({
        where: { coachId_sportId: { coachId: coach.userId, sportId: sports[sportIndex].id } },
        update: {},
        create: { coachId: coach.userId, sportId: sports[sportIndex].id },
      })
    }
    for (const dayOfWeek of [2, 4, 6]) {
      const existing = await prisma.coachAvailability.findFirst({ where: { coachId: coach.userId, dayOfWeek, startTime: time(6) } })
      const data = { coachId: coach.userId, dayOfWeek, startTime: time(6), endTime: time(21), effectiveFrom: daysFromNow(-30), effectiveTo: daysFromNow(180), status: 'AVAILABLE' as const }
      if (existing) await prisma.coachAvailability.update({ where: { id: existing.id }, data })
      else await prisma.coachAvailability.create({ data })
    }
    coaches.push(coach)
  }

  const heroContent = [
    ['Bơi lội trong nhà', 'Hồ bơi tiêu chuẩn với không gian luyện tập quanh năm.', '/images/landing/hero/swimming.webp', 0],
    ['Gym hiện đại', 'Thiết bị tập luyện hiện đại cho sức mạnh và thể lực.', '/images/landing/hero/gym.webp', 1],
    ['Yoga cân bằng', 'Studio yên tĩnh dành cho linh hoạt và phục hồi.', '/images/landing/hero/yoga.webp', 2],
    ['Cầu lông trong nhà', 'Mặt sân chuyên dụng và hệ thống ánh sáng tiêu chuẩn.', '/images/landing/hero/badminton.webp', 3],
  ] as const
  for (const [title, subtitle, imageUrl, sportIndex] of heroContent) {
    const existing = await prisma.landingHeroSlide.findFirst({ where: { title } })
    const data = { title, subtitle, imageUrl, sportId: sports[sportIndex].id, sortOrder: sportIndex + 1, isActive: true }
    if (existing) await prisma.landingHeroSlide.update({ where: { id: existing.id }, data })
    else await prisma.landingHeroSlide.create({ data })
  }

  const facilityContent = [
    ['Hồ bơi trong nhà', 'Bể bơi nước ấm phục vụ luyện tập kỹ thuật và sức bền.', '/images/landing/hero/swimming.webp'],
    ['Studio sức mạnh', 'Không gian Gym với thiết bị luyện tập hiện đại.', '/images/landing/hero/gym.webp'],
    ['Studio Yoga', 'Không gian cân bằng, mobility và phục hồi vận động.', '/images/landing/hero/yoga.webp'],
    ['Sân cầu lông A', 'Mặt sân chuyên dụng, trần cao và ánh sáng tiêu chuẩn.', '/images/landing/hero/badminton.webp'],
  ] as const
  for (const [name, description, imageUrl] of facilityContent) {
    const existing = await prisma.landingFacility.findFirst({ where: { name } })
    const data = { name, description, imageUrl, sortOrder: facilityContent.findIndex((item) => item[0] === name) + 1, isActive: true }
    if (existing) await prisma.landingFacility.update({ where: { id: existing.id }, data })
    else await prisma.landingFacility.create({ data })
  }

  const partnerContent = [
    ['Nike', '/brands/nike.svg'], ['Adidas', '/brands/adidas.svg'], ['Puma', '/brands/puma.svg'],
    ['Under Armour', '/brands/underarmour.svg'], ['ASICS', '/brands/asics.svg'],
    ['New Balance', '/brands/newbalance.svg'], ['Reebok', '/brands/reebok.svg'],
  ] as const
  for (const [name, logoUrl] of partnerContent) {
    const existing = await prisma.landingPartner.findFirst({ where: { name } })
    const data = { name, logoUrl, sortOrder: partnerContent.findIndex((item) => item[0] === name) + 1, isActive: true }
    if (existing) await prisma.landingPartner.update({ where: { id: existing.id }, data })
    else await prisma.landingPartner.create({ data })
  }

  await prisma.siteSetting.upsert({
    where: { id: 1 },
    update: {
      hotline: '1900 6868', openingHours: '05:30–22:30', location: 'TP.HCM',
      brandDescription: 'Tổ hợp thể thao đa môn, nơi mỗi buổi tập là một bước tiến đến phiên bản tốt hơn của bạn.',
      authPromotionTitle: 'Đỉnh cao thể thao & phục hồi chuyên nghiệp',
      authPromotionDescription: 'Tập luyện đúng phương pháp cùng đội ngũ Coach Sportigo.',
    },
    create: {
      id: 1, hotline: '1900 6868', openingHours: '05:30–22:30', location: 'TP.HCM',
      brandDescription: 'Tổ hợp thể thao đa môn, nơi mỗi buổi tập là một bước tiến đến phiên bản tốt hơn của bạn.',
      authPromotionTitle: 'Đỉnh cao thể thao & phục hồi chuyên nghiệp',
      authPromotionDescription: 'Tập luyện đúng phương pháp cùng đội ngũ Coach Sportigo.',
    },
  })

  const memberProfiles = [
    ['flowtest.member1@gmail.com', 'Phạm Gia Huy', '0901000021', `${PREFIX}-MEM-01`, 'Tăng sức bền và cải thiện kỹ thuật'],
    ['flowtest.member2@gmail.com', 'Võ Ngọc Linh', '0901000022', `${PREFIX}-MEM-02`, 'Cải thiện vóc dáng và sức mạnh'],
    ['flowtest.member3@gmail.com', 'Đặng Anh Khoa', '0901000023', `${PREFIX}-MEM-03`, 'Tập luyện đều đặn và giảm căng thẳng'],
    ['flowtest.member4@gmail.com', 'Bùi Mai Anh', '0901000024', `${PREFIX}-MEM-04`, 'Nâng cao kỹ thuật thi đấu'],
  ] as const
  const members = []
  for (const [index, [email, displayName, phone, memberCode, trainingGoal]] of memberProfiles.entries()) {
    const user = await ensureUser({ email, displayName, roleName: 'MEMBER', phone })
    members.push(await prisma.member.upsert({
      where: { userId: user.id },
      update: { memberCode, trainingGoal, gender: index % 2 ? 'FEMALE' : 'MALE', emergencyContact: `Người thân - 09110000${index + 1}` },
      create: { userId: user.id, memberCode, trainingGoal, gender: index % 2 ? 'FEMALE' : 'MALE', emergencyContact: `Người thân - 09110000${index + 1}`, dateOfBirth: new Date(Date.UTC(1998 + index, index, 10)) },
    }))
  }

  const classInputs = [
    { name: `${PREFIX} Bơi căn bản`, sport: 0, coach: 0, room: 0, fee: 1200000, capacity: 12, hour: 18, sessionStartOffset: -14 },
    { name: `${PREFIX} Strength Foundation`, sport: 1, coach: 1, room: 1, fee: 1500000, capacity: 14, hour: 19, sessionStartOffset: 10 },
    { name: `${PREFIX} Yoga phục hồi`, sport: 2, coach: 1, room: 2, fee: 1000000, capacity: 16, hour: 7, sessionStartOffset: 10 },
    { name: `${PREFIX} Cầu lông nâng cao`, sport: 3, coach: 2, room: 3, fee: 1400000, capacity: 10, hour: 18, sessionStartOffset: 10 },
  ]
  const classes = []
  for (const input of classInputs) {
    const data = {
      sportId: sports[input.sport].id, coachId: coaches[input.coach].userId, name: input.name,
      description: `Lớp kiểm thử đầy đủ cho ${sports[input.sport].name}, gồm hướng dẫn kỹ thuật và theo dõi tiến độ.`,
      capacity: input.capacity, tuitionFee: input.fee, registrationOpenAt: daysFromNow(-7), registrationCloseAt: daysFromNow(7),
      startDate: daysFromNow(input.sessionStartOffset), endDate: daysFromNow(input.sessionStartOffset + 42), status: 'OPEN' as const,
    }
    const existing = await prisma.groupClass.findFirst({ where: { name: input.name } })
    const groupClass = existing
      ? await prisma.groupClass.update({ where: { id: existing.id }, data })
      : await prisma.groupClass.create({ data })
    await prisma.classSession.deleteMany({ where: { classId: groupClass.id } })
    for (let week = 0; week < 6; week += 1) {
      const firstSession = daysFromNow(input.sessionStartOffset + week * 7, input.hour)
      const secondDayOffset = firstSession.getDay() >= 5 ? -3 : 3
      for (const [sessionIndex, dayOffset] of [0, secondDayOffset].entries()) {
        const startsAt = daysFromNow(input.sessionStartOffset + week * 7 + dayOffset, input.hour)
        await prisma.classSession.create({ data: { classId: groupClass.id, roomId: rooms[input.room].id, startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000), status: startsAt < new Date() ? 'COMPLETED' : 'SCHEDULED', note: `Slot ${week * 2 + sessionIndex + 1}` } })
      }
    }
    classes.push(groupClass)
  }

  const registrations = []
  for (let index = 0; index < classes.length; index += 1) {
    registrations.push(await prisma.classRegistration.upsert({
      where: { memberId_classId: { memberId: members[index].userId, classId: classes[index].id } },
      update: { status: 'CONFIRMED', price: classes[index].tuitionFee, cancelledAt: null },
      create: { memberId: members[index].userId, classId: classes[index].id, status: 'CONFIRMED', price: classes[index].tuitionFee },
    }))
  }

  const courseInputs = [
    { name: `${PREFIX} Bơi 1-1 12 buổi`, sport: 0, coach: 0, sessions: 12, duration: 60, validity: 120, price: 7200000 },
    { name: `${PREFIX} Gym 1-1 16 buổi`, sport: 1, coach: 1, sessions: 16, duration: 75, validity: 150, price: 9600000 },
    { name: `${PREFIX} Yoga 1-1 10 buổi`, sport: 2, coach: 1, sessions: 10, duration: 60, validity: 100, price: 5500000 },
    { name: `${PREFIX} Cầu lông 1-1 12 buổi`, sport: 3, coach: 2, sessions: 12, duration: 90, validity: 120, price: 8400000 },
  ]
  const courses = []
  const enrollments = []
  for (const [index, input] of courseInputs.entries()) {
    const data = { sportId: sports[input.sport].id, name: input.name, description: `Khóa cá nhân nhiều buổi với lịch cố định hàng tuần, mục tiêu và giáo án rõ ràng.`, totalSessions: input.sessions, sessionDurationMinutes: input.duration, validityDays: input.validity, price: input.price, status: 'ACTIVE' as const }
    const existing = await prisma.privateCourse.findFirst({ where: { name: input.name } })
    const course = existing ? await prisma.privateCourse.update({ where: { id: existing.id }, data }) : await prisma.privateCourse.create({ data })
    await prisma.coachPrivateCourse.upsert({ where: { coachId_privateCourseId: { coachId: coaches[input.coach].userId, privateCourseId: course.id } }, update: { isActive: true }, create: { coachId: coaches[input.coach].userId, privateCourseId: course.id, isActive: true } })
    const enrollmentData = { memberId: members[index].userId, privateCourseId: course.id, coachId: coaches[input.coach].userId, purchasedSessions: input.sessions, remainingSessions: input.sessions, purchasedPrice: input.price, startDate: daysFromNow(7), expiryDate: daysFromNow(input.validity), status: 'ACTIVE' as const }
    const existingEnrollment = await prisma.privateCourseEnrollment.findFirst({ where: { memberId: members[index].userId, privateCourseId: course.id, coachId: coaches[input.coach].userId } })
    const enrollment = existingEnrollment ? await prisma.privateCourseEnrollment.update({ where: { id: existingEnrollment.id }, data: enrollmentData }) : await prisma.privateCourseEnrollment.create({ data: enrollmentData })
    await prisma.privateCourseSchedule.deleteMany({ where: { enrollmentId: enrollment.id } })
    for (const dayOfWeek of [2, 6]) {
      await prisma.privateCourseSchedule.create({ data: { enrollmentId: enrollment.id, roomId: rooms[input.sport].id, dayOfWeek, startTime: time(15), endTime: time(15, input.duration), effectiveFrom: daysFromNow(7), effectiveTo: daysFromNow(input.validity), status: 'ACTIVE' } })
    }
    courses.push(course)
    enrollments.push(enrollment)
  }

  for (const [index, sport] of sports.entries()) {
    const name = `${PREFIX} Giáo án ${sport.name} 6 tuần`
    const data = { sportId: sport.id, createdById: coaches[classInputs[index].coach].userId, name, level: index % 2 ? 'INTERMEDIATE' : 'BEGINNER', description: `Giáo án kiểm thử theo môn ${sport.name}, tăng dần khối lượng trong 6 tuần.`, durationWeeks: 6, status: 'ACTIVE' as const }
    const existing = await prisma.workoutPlan.findFirst({ where: { name } })
    const plan = existing ? await prisma.workoutPlan.update({ where: { id: existing.id }, data }) : await prisma.workoutPlan.create({ data })
    await prisma.workoutPlanItem.deleteMany({ where: { workoutPlanId: plan.id } })
    for (let week = 1; week <= 6; week += 1) {
      for (let session = 1; session <= 2; session += 1) {
        await prisma.workoutPlanItem.create({ data: { workoutPlanId: plan.id, weekNumber: week, sessionNumber: session, itemOrder: 1, title: `${sport.name} - Tuần ${week} buổi ${session}`, content: `Khởi động, kỹ thuật trọng tâm và bài tập thể lực tuần ${week}.`, durationMinutes: 60, sets: 3, repetitions: 12, intensity: week <= 2 ? 'LOW' : week <= 4 ? 'MEDIUM' : 'HIGH', note: 'Điều chỉnh theo thể trạng hội viên.' } })
      }
    }
    await prisma.planPrivateEnrollment.upsert({ where: { enrollmentId_workoutPlanId: { enrollmentId: enrollments[index].id, workoutPlanId: plan.id } }, update: { assignedById: data.createdById, status: 'ACTIVE' }, create: { enrollmentId: enrollments[index].id, workoutPlanId: plan.id, assignedById: data.createdById, status: 'ACTIVE' } })
    const assessment = await prisma.progressAssessment.findFirst({ where: { memberId: members[index].userId, privateEnrollmentId: enrollments[index].id } })
    const assessmentData = { memberId: members[index].userId, coachId: data.createdById, privateEnrollmentId: enrollments[index].id, assessmentDate: daysFromNow(-1), score: 78 + index * 4, metrics: { endurance: 75 + index * 3, technique: 72 + index * 4, attendance: 90 }, coachComment: 'Tiến độ tốt, kỹ thuật ổn định và tuân thủ lịch tập.', recommendation: 'Duy trì hai buổi mỗi tuần và tăng dần cường độ.', nextAssessmentDate: daysFromNow(28) }
    if (assessment) await prisma.progressAssessment.update({ where: { id: assessment.id }, data: assessmentData })
    else await prisma.progressAssessment.create({ data: assessmentData })
  }

  // Một bản ghi điểm danh đã hoàn thành để các trang lịch sử/progress có dữ liệu thật.
  const firstSession = await prisma.classSession.findFirstOrThrow({ where: { classId: classes[0].id }, orderBy: { startsAt: 'asc' } })
  await prisma.sessionAttendance.upsert({
    where: { registrationId_classSessionId: { registrationId: registrations[0].id, classSessionId: firstSession.id } },
    update: { status: 'PRESENT', markedById: coaches[0].userId, checkedAt: new Date(), note: 'Dữ liệu kiểm thử Flow 4' },
    create: { registrationId: registrations[0].id, classSessionId: firstSession.id, status: 'PRESENT', markedById: coaches[0].userId, checkedAt: new Date(), note: 'Dữ liệu kiểm thử Flow 4' },
  })

  console.log('[flow-seed] Done.')
  console.log('[flow-seed] Password for every fixture account: 12345678')
  console.log('[flow-seed] Accounts: flowtest.manager, flowtest.receptionist, flowtest.coach.*, flowtest.member*@gmail.com')
  console.log(`[flow-seed] Manager actor id: ${manager.id}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('[flow-seed] Failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
