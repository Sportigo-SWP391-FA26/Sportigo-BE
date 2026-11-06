import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { createStaffSchema, listStaffSchema, updateStaffSchema } from './staff.schema.js'
import * as staffService from './staff.service.js'
// note: FR-65 dùng chung router nhân sự (đã giới hạn Center Manager)
import { staffPerformanceQuerySchema } from './staff-performance.schema.js'
import * as staffPerformanceService from './staff-performance.service.js'
import { userIdSchema } from './user-admin.schema.js'

// FR-07
export const listStaff: RequestHandler = async (request, response) => {
  response.json(await staffService.listStaff(listStaffSchema.parse(request.query)))
}

export const createStaff: RequestHandler = async (request, response) => {
  const input = createStaffSchema.parse(request.body)
  response.status(201).json(await staffService.createStaff(getAuthUser(request), input, request.ip))
}

// FR-65: hiệu suất nhân sự theo khoảng thời gian (?from=YYYY-MM-DD&to=YYYY-MM-DD)
export const getStaffPerformance: RequestHandler = async (request, response) => {
  response.json(await staffPerformanceService.getStaffPerformance(staffPerformanceQuerySchema.parse(request.query)))
}

export const updateStaff: RequestHandler = async (request, response) => {
  const { id } = userIdSchema.parse(request.params)
  const input = updateStaffSchema.parse(request.body)
  response.json(await staffService.updateStaff(getAuthUser(request), id, input, request.ip))
}
