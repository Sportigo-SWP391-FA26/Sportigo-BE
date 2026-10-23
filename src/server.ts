import { app } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import waitlistService from './modules/waitlist/waitlist.service.js'

const server = app.listen(env.PORT, () => {
  console.log(`Sport Center API listening on http://localhost:${env.PORT}`)
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
