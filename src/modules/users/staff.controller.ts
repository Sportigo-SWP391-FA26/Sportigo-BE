import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { createStaffSchema, listStaffSchema, updateStaffSchema } from './staff.schema.js'
import * as staffService from './staff.service.js'
import { userIdSchema } from './user-admin.schema.js'

// FR-07
export const listStaff: RequestHandler = async (request, response) => {
  response.json(await staffService.listStaff(listStaffSchema.parse(request.query)))
}

export const createStaff: RequestHandler = async (request, response) => {
  const input = createStaffSchema.parse(request.body)
  response.status(201).json(await staffService.createStaff(getAuthUser(request), input, request.ip))
}

export const updateStaff: RequestHandler = async (request, response) => {
  const { id } = userIdSchema.parse(request.params)
  const input = updateStaffSchema.parse(request.body)
  response.json(await staffService.updateStaff(getAuthUser(request), id, input, request.ip))
}
