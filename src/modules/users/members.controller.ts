import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import * as memberProfileService from './member-profile.service.js'
import { createMemberSchema } from './members.schema.js'
import * as membersService from './members.service.js'
import { userIdSchema } from './user-admin.schema.js'

// FR-08
export const createMember: RequestHandler = async (request, response) => {
  const input = createMemberSchema.parse(request.body)
  response.status(201).json(await membersService.createMember(getAuthUser(request), input, request.ip))
}

// FR-10
export const getMemberProfile: RequestHandler = async (request, response, next) => {
  // note: "/members/me/..." thuộc module finance/training; id không phải số thì nhường cho route sau
  if (!/^\d+$/.test(String(request.params.id))) {
    next()
    return
  }
  const { id } = userIdSchema.parse(request.params)
  response.json(await memberProfileService.getMemberProfile(getAuthUser(request), id))
}
