import 'dotenv/config'
import { execSync } from 'node:child_process'
import { assertSafeTestDatabase } from './support/test-database.js'

// Chạy một lần trước toàn bộ test: áp migration lên database test.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    console.warn(
      '\n[test] TEST_DATABASE_URL chưa được cấu hình: bỏ qua integration test.\n',
    )
    return
  }

  assertSafeTestDatabase(url)
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  })
}
