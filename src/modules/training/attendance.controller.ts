import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import { toAttendanceWorkbook } from './attendance.export.js'
import {
  exportAttendanceQuerySchema,
  listAttendanceQuerySchema,
  markAttendanceSchema,
} from './attendance.schema.js'
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

export const listAttendance: RequestHandler = async (request, response) => {
  const query = listAttendanceQuerySchema.parse(request.query)
  const result = await attendanceService.listAttendanceHistory(
    getAuthUser(request),
    query,
  )
  response.json(result)
}

export const exportAttendance: RequestHandler = async (request, response) => {
  const query = exportAttendanceQuerySchema.parse(request.query)
  const items = await attendanceService.exportAttendanceHistory(
    getAuthUser(request),
    query,
  )
  const file = await toAttendanceWorkbook(items)
  const today = new Date().toISOString().slice(0, 10)
  response
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .attachment(`sportigo-diem-danh-${today}.xlsx`)
    .send(file)
}
