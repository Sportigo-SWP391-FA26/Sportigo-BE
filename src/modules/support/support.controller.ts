import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import {
  createSupportRequestSchema,
  listQueueSchema,
  listSupportRequestsSchema,
  sendMessageSchema,
  staffMessageSchema,
  supportRequestIdSchema,
  updateSupportRequestSchema,
} from './support.schema.js'
import * as staffService from './support-staff.service.js'
import * as supportService from './support.service.js'

// note: cùng đường dẫn cho Member (FR-55) và nhân viên (FR-56); route đã authorize, ở đây chỉ rẽ nhánh theo role
const isMember = (role: string) => role === 'MEMBER'

// FR-55
export const createSupportRequest: RequestHandler = async (request, response) => {
  const input = createSupportRequestSchema.parse(request.body)
  response.status(201).json(await supportService.createSupportRequest(getAuthUser(request), input))
}

export const listSupportRequests: RequestHandler = async (request, response) => {
  const actor = getAuthUser(request)
  if (isMember(actor.role)) {
    response.json(await supportService.listMySupportRequests(actor, listSupportRequestsSchema.parse(request.query)))
    return
  }
  // FR-56: hàng đợi của nhân viên
  response.json(await staffService.listQueue(actor, listQueueSchema.parse(request.query)))
}

export const getSupportRequest: RequestHandler = async (request, response) => {
  const actor = getAuthUser(request)
  const { id } = supportRequestIdSchema.parse(request.params)
  response.json(isMember(actor.role) ? await supportService.getSupportRequest(actor, id) : await staffService.getForStaff(actor, id))
}

export const sendMessage: RequestHandler = async (request, response) => {
  const actor = getAuthUser(request)
  const { id } = supportRequestIdSchema.parse(request.params)
  const result = isMember(actor.role)
    ? await supportService.sendMemberMessage(actor, id, sendMessageSchema.parse(request.body))
    : await staffService.sendStaffMessage(actor, id, staffMessageSchema.parse(request.body))
  response.status(201).json(result)
}

export const cancelSupportRequest: RequestHandler = async (request, response) => {
  const { id } = supportRequestIdSchema.parse(request.params)
  response.json(await supportService.cancelSupportRequest(getAuthUser(request), id))
}

// FR-56
export const updateSupportRequest: RequestHandler = async (request, response) => {
  const { id } = supportRequestIdSchema.parse(request.params)
  const input = updateSupportRequestSchema.parse(request.body)
  response.json(await staffService.updateRequest(getAuthUser(request), id, input, request.ip))
}
