import { z } from 'zod'

export const listNotificationsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    // note: query string luôn là chuỗi nên tự đổi "true"/"false"; z.coerce.boolean sẽ coi "false" là true
    unread: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict()

export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>

export const notificationIdSchema = z.object({ id: z.coerce.number().int().positive() })
