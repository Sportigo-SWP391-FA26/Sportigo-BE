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
    // Integration test dùng chung một database test nên chạy tuần tự từng file
    fileParallelism: false,
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
  },
})
