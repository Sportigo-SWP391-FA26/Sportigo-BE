import { PrismaClient } from '@prisma/client'

function resolveDatabaseUrl() {
  const isTest = process.env.VITEST === 'true'
  const sourceUrl = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL

  if (!sourceUrl) {
    throw new Error('Vitest requires TEST_DATABASE_URL; refusing to use the runtime database')
  }

  // Một số .env cũ có dấu nháy thừa trước query string. Chuẩn hóa tại
  // chính Prisma để CLI, test và runtime đều dùng cùng một URL hợp lệ.
  const parsed = new URL(sourceUrl.replace(/"(?=&)/g, ''))
  const database = parsed.pathname.slice(1)
  const schema = parsed.searchParams.get('schema') ?? 'public'
  if (isTest && !/test/i.test(database) && !/test/i.test(schema)) {
    throw new Error(
      `Unsafe Vitest database target (database=${database}, schema=${schema}); expected a test database/schema`,
    )
  }

  // Render/local là tiến trình sống lâu, vì vậy session pooler 5432 tái sử dụng
  // connection hiệu quả hơn transaction pooler 6543. Đo thực tế trên Supabase
  // của dự án: query ấm giảm từ ~1.3s xuống ~0.26s. Integration tests also use
  // interactive transactions and row locks, which require the same stable
  // session semantics; the isolated TEST_DATABASE_URL remains the safety wall.
  const isSupabasePooler = parsed.hostname.endsWith('.pooler.supabase.com')
  const useTransactionPool = process.env.DB_POOL_MODE === 'transaction'
  if (isSupabasePooler && parsed.port === '6543' && !useTransactionPool) {
    parsed.port = '5432'
    parsed.searchParams.delete('pgbouncer')
  } else if (parsed.port === '6543') {
    parsed.searchParams.set('pgbouncer', 'true')
  }
  parsed.searchParams.set(
    'connection_limit',
    isTest ? (process.env.TEST_DB_CONNECTION_LIMIT ?? '4') : (process.env.DB_CONNECTION_LIMIT ?? '8'),
  )
  parsed.searchParams.set('pool_timeout', process.env.DB_POOL_TIMEOUT ?? '10')
  return parsed.toString()
}

export const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
  transactionOptions: {
    // Supabase can add several seconds of network latency to multi-step flows.
    // Keep one bounded timeout for booking/payment transactions instead of the
    // Prisma default (5s), which can expire halfway through a valid workflow.
    maxWait: 5_000,
    timeout: 30_000,
  },
})
