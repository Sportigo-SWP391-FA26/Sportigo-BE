// Giá trị mặc định để import src/ không lỗi khi máy chưa có file .env.
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/sport_center_test?schema=public'
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-32-chars'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-at-least-32-chars'
process.env.VNPAY_TMN_CODE ??= 'TESTSPORTIGO'
process.env.VNPAY_HASH_SECRET ??= 'test-vnpay-hash-secret-for-sportigo-sandbox'
