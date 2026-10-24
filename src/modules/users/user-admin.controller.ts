import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { changeUserStatusSchema, listUsersSchema, userIdSchema } from './user-admin.schema.js'
import * as userAdminService from './user-admin.service.js'

// FR-09
export const listUsers: RequestHandler = async (request, response) => {
  const query = listUsersSchema.parse(request.query)
  response.json(await userAdminService.listUsers(getAuthUser(request), query))
}

// FR-06
export const changeUserStatus: RequestHandler = async (request, response) => {
  const { id } = userIdSchema.parse(request.params)
  const input = changeUserStatusSchema.parse(request.body)
  // note: lưu IP vào audit log theo yêu cầu FR-59
  response.json(await userAdminService.changeStatus(getAuthUser(request), id, input, request.ip))
}
