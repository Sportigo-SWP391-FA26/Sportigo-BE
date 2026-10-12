import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { markAttendanceSchema } from './attendance.schema.js'
import * as attendanceService from './attendance.service.js'
import { idParamsSchema } from './training.common.js'

export const markSessionAttendance: RequestHandler = async (
  request,
  response,
) => {
  const { id } = idParamsSchema.parse(request.params)
  const input = markAttendanceSchema.parse(request.body)
  const result = await attendanceService.markAttendance(
    getAuthUser(request),
    id,
    input,
  )
  response.json(result)
}

export const getSessionAttendance: RequestHandler = async (
  request,
  response,
) => {
  const { id } = idParamsSchema.parse(request.params)
  const result = await attendanceService.getSessionAttendance(
    getAuthUser(request),
    id,
  )
  response.json(result)
}
