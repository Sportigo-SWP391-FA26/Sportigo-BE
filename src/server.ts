import { autoConfirmOverdue } from './modules/private-courses/private-attendance.service.js'
import { app } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import waitlistService from './modules/waitlist/waitlist.service.js'
import { expirePendingOrders } from './modules/finance/order-expiry.service.js'
import { getPublicLanding } from './modules/content/content.service.js'

const server = app.listen(env.PORT, () => {
  console.log(`Sport Center API listening on http://localhost:${env.PORT}`)
  // Chỉ làm ấm dữ liệu công khai. Các trang quản trị tự tải khi được mở;
  // làm ấm tất cả cùng lúc sẽ chiếm pool và làm chậm request đầu của người dùng.
  const warmup = setTimeout(() => {
    void getPublicLanding()
      .catch((error: unknown) => console.warn('Application data warm-up skipped:', error))
  }, 250)
  warmup.unref()
})

const runWaitlistExpiryWorker = () => {
  void waitlistService.expireOffers()
    .catch((error: unknown) => {
      console.error('Failed to expire waitlist offers:', error)
    })
    .then(() => expirePendingOrders())
    .then(() => autoConfirmOverdue())
    .catch((error: unknown) => {
      console.error('Failed to expire pending orders:', error)
    })
}

// Để request đầu khởi tạo kết nối trước khi tác vụ nền dùng pool Supabase.
const initialExpiryRun = setTimeout(runWaitlistExpiryWorker, 15_000)
initialExpiryRun.unref()
const waitlistExpiryWorker = setInterval(runWaitlistExpiryWorker, 60_000)
waitlistExpiryWorker.unref()

async function shutdown() {
  clearTimeout(initialExpiryRun)
  clearInterval(waitlistExpiryWorker)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
