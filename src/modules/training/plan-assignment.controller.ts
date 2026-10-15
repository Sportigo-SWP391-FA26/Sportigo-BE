import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { assignPlanSchema } from './plan-assignment.schema.js'
import * as assignmentService from './plan-assignment.service.js'
import { idParamsSchema } from './training.common.js'

export const assignPlan: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  const input = assignPlanSchema.parse(request.body)
  const assignment = await assignmentService.assignPlan(
    getAuthUser(request),
    id,
    input,
  )
  response.status(201).json(assignment)
}

export const listAssignments: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  const assignments = await assignmentService.listAssignments(
    getAuthUser(request),
    id,
  )
  response.json(assignments)
}
