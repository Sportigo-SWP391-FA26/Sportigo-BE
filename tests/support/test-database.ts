// Integration test chỉ chạy khi có TEST_DATABASE_URL (database riêng cho test).
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL)

function databaseTarget(url: string) {
  const parsed = new URL(url)
  return {
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database: parsed.pathname.slice(1).toLowerCase(),
    schema: (parsed.searchParams.get('schema') ?? 'public').toLowerCase(),
    username: decodeURIComponent(parsed.username).toLowerCase(),
  }
}

function sameDatabaseTarget(left: string, right: string) {
  const a = databaseTarget(left)
  const b = databaseTarget(right)
  return a.hostname === b.hostname
    && a.port === b.port
    && a.database === b.database
    && a.schema === b.schema
    && a.username === b.username
}

// Chặn mọi thao tác xóa dữ liệu nếu URL không phải database/schema test.
// Kiểm tra fingerprint đích thay vì so sánh chuỗi để không bị qua mặt bởi
// query parameters, password hoặc định dạng URL khác nhau.
export function assertSafeTestDatabase(
  url: string | undefined,
  options: { productionUrl?: string; nodeEnv?: string; allowRemote?: boolean } = {},
) {
  if (!url) throw new Error('Thiếu URL database test')
  if ((options.nodeEnv ?? process.env.NODE_ENV) === 'production') {
    throw new Error('Từ chối thao tác xóa database khi NODE_ENV=production')
  }

  const parsed = new URL(url)
  const target = databaseTarget(url)
  const databaseName = target.database
  const schemaName = target.schema
  const isExplicitTestTarget = /test/i.test(databaseName) || /test/i.test(schemaName)
  const productionUrl = options.productionUrl ?? process.env.PRODUCTION_DATABASE_URL
  if (productionUrl && sameDatabaseTarget(url, productionUrl)) {
    throw new Error('Database test trùng chính xác database production')
  }
  const allowRemote = options.allowRemote ?? process.env.ALLOW_REMOTE_TEST_DATABASE === 'true'
  if (/supabase/i.test(parsed.hostname) && !allowRemote) {
    throw new Error(`Từ chối chạy test trên Supabase (${parsed.hostname}) khi chưa bật ALLOW_REMOTE_TEST_DATABASE`)
  }
  if (!isExplicitTestTarget) {
    throw new Error(
      `Tên database hoặc schema test phải chứa "test" (database=${databaseName}, schema=${schemaName || 'public'})`,
    )
  }
}
