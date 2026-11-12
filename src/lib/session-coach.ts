import type { Prisma } from '@prisma/client'

// FR-66: quy ước "coach dạy thực tế" của một buổi lớp nhóm.
// note: ClassSession.coachId NULL nghĩa là buổi theo coach hiện tại của lớp; có giá trị là coach đã chốt hoặc người dạy thay

type SessionWithCoach = { coachId: number | null; groupClass: { coachId: number } | null }

// note: coach dạy thực tế = coach ghi trên buổi, không có thì lấy coach của lớp
export function effectiveCoachId(session: SessionWithCoach): number | null {
  return session.coachId ?? session.groupClass?.coachId ?? null
}

// note: điều kiện Prisma "buổi do coach này dạy" – dùng thay cho groupClass: { coachId } ở các truy vấn lịch/xung đột
export function taughtByCoachWhere(coachId: number): Prisma.ClassSessionWhereInput {
  return { OR: [{ coachId }, { coachId: null, groupClass: { coachId } }] }
}
