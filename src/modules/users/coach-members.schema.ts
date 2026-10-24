import { z } from 'zod'

// FR-11
export const listCoachMembersSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    // note: CLASS = học viên lớp nhóm, PRIVATE = học viên khóa 1-1; bỏ trống = cả hai
    type: z.enum(['CLASS', 'PRIVATE']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()

export type ListCoachMembersQuery = z.infer<typeof listCoachMembersSchema>
