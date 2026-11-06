import type { RequestHandler } from 'express'
import { z } from 'zod'
import { getAuthUser } from '../../middleware/auth.js'
import { metricDefinitionSchema, metricDefinitionUpdateSchema } from './assessment-metric.schema.js'
import * as service from './assessment-metric.service.js'

const id = (value: string | string[] | undefined) => z.coerce.number().int().positive().parse(value)

export const list: RequestHandler = async (request, response) => {
  const user = getAuthUser(request)
  response.json(await service.listMetricDefinitions(id(request.params.sportId), user.role === 'CENTER_MANAGER'))
}
export const create: RequestHandler = async (request, response) => {
  response.status(201).json(await service.createMetricDefinition(id(request.params.sportId), metricDefinitionSchema.parse(request.body)))
}
export const update: RequestHandler = async (request, response) => {
  response.json(await service.updateMetricDefinition(id(request.params.sportId), id(request.params.id), metricDefinitionUpdateSchema.parse(request.body)))
}

