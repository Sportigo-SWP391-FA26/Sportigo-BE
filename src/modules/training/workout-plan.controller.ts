import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { idParamsSchema } from './training.common.js'
import {
  changePlanStatusSchema,
  createPlanSchema,
  listPlansQuerySchema,
  updatePlanSchema,
} from './workout-plan.schema.js'
import * as planService from './workout-plan.service.js'

export const listPlans: RequestHandler = async (request, response) => {
  const query = listPlansQuerySchema.parse(request.query)
  response.json(await planService.listPlans(query))
}

export const getPlan: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  response.json(await planService.getPlan(id))
}

export const createPlan: RequestHandler = async (request, response) => {
  const input = createPlanSchema.parse(request.body)
  const plan = await planService.createPlan(getAuthUser(request), input)
  response.status(201).json(plan)
}

export const updatePlan: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  const input = updatePlanSchema.parse(request.body)
  response.json(await planService.updatePlan(id, input))
}

export const changePlanStatus: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  const input = changePlanStatusSchema.parse(request.body)
  response.json(await planService.changePlanStatus(id, input))
}

export const deletePlan: RequestHandler = async (request, response) => {
  const { id } = idParamsSchema.parse(request.params)
  response.json(await planService.deactivatePlan(id))
}
