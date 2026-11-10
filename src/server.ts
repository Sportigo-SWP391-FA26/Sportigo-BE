import { app } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import waitlistService from './modules/waitlist/waitlist.service.js'
import { getPublicLanding } from './modules/content/content.service.js'

const server = app.listen(env.PORT, () => {
  console.log(`Sport Center API listening on http://localhost:${env.PORT}`)
  // Làm ấm dữ liệu công khai, không chiếm pool bằng toàn bộ trang quản trị.
  const warmup = setTimeout(() => {
    void getPublicLanding()
      .catch((error: unknown) => console.warn('Application data warm-up skipped:', error))
  }, 250)
  warmup.unref()
})

const runWaitlistExpiryWorker = () => {
  void waitlistService.expireOffers().catch((error: unknown) => {
    console.error('Failed to expire waitlist offers:', error)
  })
}

// Cho request đầu tiên cơ hội khởi tạo kết nối trước tác vụ nền.
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
