import { app } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import waitlistService from './modules/waitlist/waitlist.service.js'
import { getManagerDashboard, getPublicLanding } from './modules/content/content.service.js'
import sportService from './modules/sports/sport.service.js'
import roomService from './modules/rooms/room.service.js'
import groupClassService from './modules/group-classes/group-class.service.js'
import privateCourseService from './modules/private-courses/private.service.js'
import { listUsers } from './modules/users/user-admin.service.js'
import { listStaff } from './modules/users/staff.service.js'

const server = app.listen(env.PORT, () => {
  console.log(`Sport Center API listening on http://localhost:${env.PORT}`)
  // Làm ấm theo từng tầng thay vì dồn mọi truy vấn vào pool cùng lúc. Khi
  // public data xong mới tải dashboard rồi danh sách quản trị mặc định.
  // Nhờ vậy lần mở trang đầu tiên nhanh nhưng login không bị tranh connection.
  const warmup = setTimeout(() => {
    void Promise.allSettled([
      getPublicLanding(),
      sportService.getAllSports(),
      roomService.getAllRooms(),
      groupClassService.getAllGroupClasses(),
      privateCourseService.listActiveCourses(),
    ])
      .then(() => getManagerDashboard())
      .then(() => Promise.allSettled([
        listUsers({ id: 0, role: 'CENTER_MANAGER' }, { page: 1, pageSize: 20 }),
        listStaff({ page: 1, pageSize: 20 }),
      ]))
      .catch((error: unknown) => console.warn('Application data warm-up skipped:', error))
  }, 250)
  warmup.unref()
})

const waitlistExpiryWorker = setInterval(() => {
  void waitlistService.expireOffers().catch((error: unknown) => {
    console.error('Failed to expire waitlist offers:', error)
  })
}, 60_000)
waitlistExpiryWorker.unref()

async function shutdown() {
  clearInterval(waitlistExpiryWorker)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
