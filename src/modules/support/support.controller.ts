import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { createSupportRequestSchema, listSupportRequestsSchema, sendMessageSchema, supportRequestIdSchema } from './support.schema.js'
import * as supportService from './support.service.js'

// FR-55
export const createSupportRequest: RequestHandler = async (request, response) => {
  const input = createSupportRequestSchema.parse(request.body)
  response.status(201).json(await supportService.createSupportRequest(getAuthUser(request), input))
}

export const listSupportRequests: RequestHandler = async (request, response) => {
  const query = listSupportRequestsSchema.parse(request.query)
  response.json(await supportService.listMySupportRequests(getAuthUser(request), query))
}

export const getSupportRequest: RequestHandler = async (request, response) => {
  const { id } = supportRequestIdSchema.parse(request.params)
  response.json(await supportService.getSupportRequest(getAuthUser(request), id))
}

export const sendMessage: RequestHandler = async (request, response) => {
  const { id } = supportRequestIdSchema.parse(request.params)
  const input = sendMessageSchema.parse(request.body)
  response.status(201).json(await supportService.sendMemberMessage(getAuthUser(request), id, input))
}

export const cancelSupportRequest: RequestHandler = async (request, response) => {
  const { id } = supportRequestIdSchema.parse(request.params)
  response.json(await supportService.cancelSupportRequest(getAuthUser(request), id))
}
