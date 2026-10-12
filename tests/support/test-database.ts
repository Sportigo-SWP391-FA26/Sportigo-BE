// Integration test chỉ chạy khi có TEST_DATABASE_URL (database riêng cho test).
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL)

// Chặn mọi thao tác xóa dữ liệu nếu URL không phải database test trên máy local.
export function assertSafeTestDatabase(url: string | undefined) {
  if (!url) throw new Error('Thiếu URL database test')
  const { hostname, pathname } = new URL(url)
  if (/supabase/i.test(hostname)) {
    throw new Error(`Từ chối chạy test trên Supabase (${hostname})`)
  }
  if (!/test/i.test(pathname)) {
    throw new Error(
      `Tên database test phải chứa "test" (đang là ${pathname.slice(1)})`,
    )
  }
}
