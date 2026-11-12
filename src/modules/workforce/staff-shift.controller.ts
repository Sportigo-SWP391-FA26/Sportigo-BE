import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import {
  adjustmentRequestSchema,
  approveAdjustmentSchema,
  cancelShiftSchema,
  createShiftSchema,
  idParamSchema,
  listAdjustmentsSchema,
  listShiftsSchema,
  myShiftsSchema,
  rejectAdjustmentSchema,
  updateShiftSchema,
} from './staff-shift.schema.js'
import * as shiftService from './staff-shift.service.js'

// FR-67: controller ca làm / chấm công
export const listShifts: RequestHandler = async (request, response) => {
  response.json(await shiftService.listShifts(listShiftsSchema.parse(request.query)))
}

export const createShift: RequestHandler = async (request, response) => {
  const input = createShiftSchema.parse(request.body)
  response.status(201).json(await shiftService.createShift(getAuthUser(request), input))
}

export const updateShift: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  response.json(await shiftService.updateShift(getAuthUser(request), id, updateShiftSchema.parse(request.body)))
}

export const cancelShift: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  const { reason } = cancelShiftSchema.parse(request.body)
  response.json(await shiftService.cancelShift(getAuthUser(request), id, reason))
}

export const listMyShifts: RequestHandler = async (request, response) => {
  response.json(await shiftService.listMyShifts(getAuthUser(request), myShiftsSchema.parse(request.query)))
}

export const clockIn: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  response.json(await shiftService.clockIn(getAuthUser(request), id))
}

export const clockOut: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  response.json(await shiftService.clockOut(getAuthUser(request), id))
}

export const requestAdjustment: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  const input = adjustmentRequestSchema.parse(request.body)
  response.status(201).json(await shiftService.requestAdjustment(getAuthUser(request), id, input))
}

export const listAdjustments: RequestHandler = async (request, response) => {
  const { status } = listAdjustmentsSchema.parse(request.query)
  response.json(await shiftService.listAdjustments(status))
}

export const approveAdjustment: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  const { note } = approveAdjustmentSchema.parse(request.body ?? {})
  response.json(await shiftService.approveAdjustment(getAuthUser(request), id, note))
}

export const rejectAdjustment: RequestHandler = async (request, response) => {
  const { id } = idParamSchema.parse(request.params)
  const { note } = rejectAdjustmentSchema.parse(request.body)
  response.json(await shiftService.rejectAdjustment(getAuthUser(request), id, note))
}
