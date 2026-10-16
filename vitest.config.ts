import 'dotenv/config'
import { defineConfig } from 'vitest/config'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    coverage: { reporter: ['text', 'html'] },
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // Database integration tests can use a remote isolated PostgreSQL instance.
    // Keep the fast local default when integration tests are not enabled.
    testTimeout: testDatabaseUrl ? 30_000 : 5_000,
    // Integration test dùng chung một database test nên chạy tuần tự từng file
    fileParallelism: false,
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
  },
})
