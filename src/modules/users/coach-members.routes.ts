import { Router, type RequestHandler } from 'express'
import { authenticate, authorize, getAuthUser } from '../../middleware/auth.js'
import { listCoachMembersSchema } from './coach-members.schema.js'
import { listMyMembers } from './coach-members.service.js'

const listMembers: RequestHandler = async (request, response) => {
  response.json(await listMyMembers(getAuthUser(request), listCoachMembersSchema.parse(request.query)))
}

// FR-11: gắn tại /api/coaches/me/members (mount riêng trong routes/index.ts, không sửa coach.routes.ts của module coaches)
export const coachMembersRouter = Router()
coachMembersRouter.get('/', authenticate, authorize('COACH'), listMembers)
