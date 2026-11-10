import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { authenticate, authorize, getAuthUser } from '../../middleware/auth.js'
import { AVAILABILITY_RULES } from '../coach-availability/coach-availability.constants.js'
import * as service from './center-settings.service.js'

// Trần = số ca tối đa một Coach có thể chọn trong tuần
const updateSchema = z.object({
  minimumShifts: z.number().int().min(1).max(AVAILABILITY_RULES.maximumPerDay * 7),
})

const get: RequestHandler = async (_request, response) => response.json({ success: true, data: await service.getCenterSettings() })
const update: RequestHandler = async (request, response) => response.json({ success: true, data: await service.updateCenterSettings(updateSchema.parse(request.body), getAuthUser(request).id) })

export const centerSettingsRouter = Router()
centerSettingsRouter.use(authenticate, authorize('CENTER_MANAGER'))
centerSettingsRouter.get('/', get)
centerSettingsRouter.put('/', update)
