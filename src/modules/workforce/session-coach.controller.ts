import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { absenceSchema, listSessionCoachesSchema, sessionIdParamSchema, substituteSchema } from './session-coach.schema.js'
import * as sessionCoachService from './session-coach.service.js'

// FR-66: controller chỉ đọc request, kiểm tra bằng Zod rồi gọi service
export const listSessionCoaches: RequestHandler = async (request, response) => {
  response.json(await sessionCoachService.listSessionCoaches(listSessionCoachesSchema.parse(request.query)))
}

export const listCandidates: RequestHandler = async (request, response) => {
  const { sessionId } = sessionIdParamSchema.parse(request.params)
  response.json(await sessionCoachService.listSubstituteCandidates(sessionId))
}

export const assignSubstitute: RequestHandler = async (request, response) => {
  const { sessionId } = sessionIdParamSchema.parse(request.params)
  const input = substituteSchema.parse(request.body)
  response.json(await sessionCoachService.assignSubstitute(getAuthUser(request), sessionId, input))
}

export const markAbsent: RequestHandler = async (request, response) => {
  const { sessionId } = sessionIdParamSchema.parse(request.params)
  const { reason } = absenceSchema.parse(request.body)
  response.json(await sessionCoachService.markCoachAbsent(getAuthUser(request), sessionId, reason))
}

export const resetCoach: RequestHandler = async (request, response) => {
  const { sessionId } = sessionIdParamSchema.parse(request.params)
  response.json(await sessionCoachService.resetSessionCoach(getAuthUser(request), sessionId))
}
