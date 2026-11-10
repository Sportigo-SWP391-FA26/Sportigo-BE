import type { RequestHandler } from 'express'
import { HttpError } from '../../lib/http-error.js'
import { getAuthUser } from '../../middleware/auth.js'
import { coachHasSport, findPlanState } from './workout-plan.repository.js'

/** Manager xem mọi môn; Coach chỉ truy cập giáo án thuộc chuyên môn được phân công. */
export const requirePlanSport: RequestHandler = async (request, _response, next) => {
  const user = getAuthUser(request)
  if (user.role === 'CENTER_MANAGER') return next()
  const planId = Number(request.params.id)
  if (!Number.isInteger(planId) || planId <= 0) throw new HttpError(400, 'ID giáo án không hợp lệ', 'INVALID_PLAN_ID')
  const plan = await findPlanState(planId)
  if (!plan) throw new HttpError(404, 'Không tìm thấy giáo án', 'PLAN_NOT_FOUND')
  if (!(await coachHasSport(user.id, plan.sportId))) throw new HttpError(403, 'Giáo án không thuộc môn chuyên môn của Coach', 'PLAN_SPORT_FORBIDDEN')
  next()
}
