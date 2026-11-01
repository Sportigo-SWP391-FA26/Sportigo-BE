import { Router, type RequestHandler } from 'express'
import { authenticate, authorize, getAuthUser } from '../../middleware/auth.js'
import { listCoachMembersSchema } from './coach-members.schema.js'
import { listMyMembers, listMySessions } from './coach-members.service.js'
import { z } from 'zod'

const listMembers: RequestHandler = async (request, response) => {
  response.json(await listMyMembers(getAuthUser(request), listCoachMembersSchema.parse(request.query)))
}

// FR-11: gắn tại /api/coaches/me/members (mount riêng trong routes/index.ts, không sửa coach.routes.ts của module coaches)
export const coachMembersRouter = Router()
coachMembersRouter.get('/', authenticate, authorize('COACH'), listMembers)

const rangeSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine(
  ({ from, to }) => from <= to,
  { message: 'Khoảng thời gian không hợp lệ' },
)
export const coachSessionsRouter = Router()
coachSessionsRouter.get('/', authenticate, authorize('COACH'), async (request, response) => {
  response.json(await listMySessions(getAuthUser(request), rangeSchema.parse(request.query)))
})
