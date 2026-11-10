import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import * as service from './membership.service.js'
import { checkInListSchema, checkInSchema, createPlanSchema, idSchema, purchaseSchema, updatePlanSchema } from './membership.schema.js'

export const listPublicPlans: RequestHandler = async (_request, response) => {
  response.json(await service.listPublicPlans())
}

export const listManagedPlans: RequestHandler = async (_request, response) => {
  response.json(await service.listManagedPlans())
}

export const createPlan: RequestHandler = async (request, response) => {
  response.status(201).json(await service.createPlan(createPlanSchema.parse(request.body), getAuthUser(request).id))
}

export const updatePlan: RequestHandler = async (request, response) => {
  response.json(await service.updatePlan(idSchema.parse(request.params.id), updatePlanSchema.parse(request.body), getAuthUser(request).id))
}

export const deletePlan: RequestHandler = async (request, response) => {
  await service.deleteDraftPlan(idSchema.parse(request.params.id), getAuthUser(request).id)
  response.status(204).end()
}

export const purchase: RequestHandler = async (request, response) => {
  const { planId } = purchaseSchema.parse(request.body)
  response.status(201).json(await service.purchase(getAuthUser(request).id, planId))
}

export const purchaseForMember: RequestHandler = async (request, response) => {
  const { planId } = purchaseSchema.parse(request.body)
  response.status(201).json(await service.purchase(idSchema.parse(request.params.id), planId))
}

export const getMyMembership: RequestHandler = async (request, response) => {
  response.json(await service.getMyMembership(getAuthUser(request).id))
}

export const checkIn: RequestHandler = async (request, response) => {
  const result = await service.checkIn(getAuthUser(request).id, checkInSchema.parse(request.body))
  response.status(result.alreadyCheckedIn ? 200 : 201).json(result)
}

export const listCheckIns: RequestHandler = async (request, response) => {
  response.json(await service.listCheckIns(checkInListSchema.parse(request.query)))
}

export const listMyCheckIns: RequestHandler = async (request, response) => {
  response.json(await service.listCheckIns(checkInListSchema.parse(request.query), getAuthUser(request).id))
}
