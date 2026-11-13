import type { RequestHandler } from 'express'
import { z } from 'zod'
import { getAuthUser } from '../../middleware/auth.js'
import * as service from './private-attendance.service.js'

const idSchema = z.coerce.number().int().positive()
const disputeSchema = z.object({ reason: z.string().trim().min(5).max(500) })
const resolveSchema = z.object({ decision: z.enum(['CONFIRM', 'REJECT']), note: z.string().trim().min(5).max(500) })

export const listPending: RequestHandler = async (request, response) => {
  response.json(await service.listPendingForMember(getAuthUser(request).id))
}

export const confirm: RequestHandler = async (request, response) => {
  response.json(await service.confirmByMember(getAuthUser(request).id, idSchema.parse(request.params.attendanceId)))
}

export const dispute: RequestHandler = async (request, response) => {
  const { reason } = disputeSchema.parse(request.body)
  response.json(await service.disputeByMember(getAuthUser(request).id, idSchema.parse(request.params.attendanceId), reason))
}

export const listDisputes: RequestHandler = async (_request, response) => {
  response.json(await service.listDisputes())
}

export const resolve: RequestHandler = async (request, response) => {
  const { decision, note } = resolveSchema.parse(request.body)
  response.json(await service.resolveDispute(getAuthUser(request).id, idSchema.parse(request.params.attendanceId), decision, note))
}
