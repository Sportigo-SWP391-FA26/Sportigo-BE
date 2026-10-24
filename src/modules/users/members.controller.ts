import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { createMemberSchema } from './members.schema.js'
import * as membersService from './members.service.js'

// FR-08
export const createMember: RequestHandler = async (request, response) => {
  const input = createMemberSchema.parse(request.body)
  response.status(201).json(await membersService.createMember(getAuthUser(request), input, request.ip))
}
