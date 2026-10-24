import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { listUsersSchema } from './user-admin.schema.js'
import * as userAdminService from './user-admin.service.js'

// FR-09
export const listUsers: RequestHandler = async (request, response) => {
  const query = listUsersSchema.parse(request.query)
  response.json(await userAdminService.listUsers(getAuthUser(request), query))
}
