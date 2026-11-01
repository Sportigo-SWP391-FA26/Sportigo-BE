// Integration test chỉ chạy khi có TEST_DATABASE_URL (database riêng cho test).
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL)

// Chặn mọi thao tác xóa dữ liệu nếu URL không phải database/schema test.
// Remote test cần opt-in tường minh để không thể vô tình trỏ vào Supabase public.
export function assertSafeTestDatabase(url: string | undefined) {
  if (!url) throw new Error('Thiếu URL database test')
  const parsed = new URL(url)
  const databaseName = parsed.pathname.slice(1)
  const schemaName = parsed.searchParams.get('schema') ?? ''
  const isExplicitTestTarget = /test/i.test(databaseName) || /test/i.test(schemaName)
  if (/supabase/i.test(parsed.hostname) && process.env.ALLOW_REMOTE_TEST_DATABASE !== 'true') {
    throw new Error(`Từ chối chạy test trên Supabase (${parsed.hostname}) khi chưa bật ALLOW_REMOTE_TEST_DATABASE`)
  }
  if (!isExplicitTestTarget) {
    throw new Error(
      `Tên database hoặc schema test phải chứa "test" (database=${databaseName}, schema=${schemaName || 'public'})`,
    )
  }
}
