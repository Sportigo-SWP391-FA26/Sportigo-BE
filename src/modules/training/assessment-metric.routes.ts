import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import * as controller from './assessment-metric.controller.js'

export const assessmentMetricRouter = Router({ mergeParams: true })
assessmentMetricRouter.get('/', authenticate, authorize('COACH', 'CENTER_MANAGER'), controller.list)
assessmentMetricRouter.post('/', authenticate, authorize('CENTER_MANAGER'), controller.create)
assessmentMetricRouter.patch('/:id', authenticate, authorize('CENTER_MANAGER'), controller.update)

