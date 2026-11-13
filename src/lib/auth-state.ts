import { HttpError } from './http-error.js'
import { prisma } from './prisma.js'

// Trạng thái tài khoản được đọc lại ở mỗi request có xác thực để tài khoản vừa bị
// khóa/xóa/đổi role không dùng tiếp access token còn hạn. Cache rất ngắn chỉ để
// gom các request dồn dập của cùng một người; thao tác khóa/xóa gọi invalidate ngay.
const TTL_MS = 5_000

type AuthState = { active: boolean; role: string | null }
const cache = new Map<number, { value: AuthState; expiresAt: number }>()

async function loadAuthState(userId: number): Promise<AuthState> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true, role: { select: { name: true } } },
  })
  const value = {
    active: Boolean(user && user.status === 'ACTIVE' && !user.deletedAt),
    role: user?.role.name ?? null,
  }
  cache.set(userId, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

/** BR-05: token còn hạn nhưng tài khoản đã khóa, xóa hoặc đổi role thì không được dùng tiếp. */
export async function assertActiveSession(userId: number, tokenRole: string) {
  const state = await loadAuthState(userId)
  if (!state.active) throw new HttpError(401, 'Tài khoản đã bị khóa hoặc ngừng hoạt động', 'ACCOUNT_INACTIVE')
  if (state.role !== tokenRole) throw new HttpError(401, 'Phiên đăng nhập không còn hợp lệ', 'UNAUTHENTICATED')
}

export function invalidateAuthState(userId?: number) {
  if (userId === undefined) cache.clear()
  else cache.delete(userId)
}
