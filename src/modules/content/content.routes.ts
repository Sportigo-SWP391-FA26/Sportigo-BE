import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import * as controller from './content.controller.js'

export const publicContentRouter = Router()
publicContentRouter.get('/landing', controller.publicLanding)
publicContentRouter.post('/newsletter', controller.newsletter)

export const landingContentRouter = Router()
landingContentRouter.use(authenticate, authorize('CENTER_MANAGER'))
landingContentRouter.get('/settings', controller.getSettings)
landingContentRouter.put('/settings', controller.updateSettings)
landingContentRouter.get('/:kind', controller.list)
landingContentRouter.post('/:kind', controller.create)
landingContentRouter.patch('/:kind/:id', controller.update)
landingContentRouter.delete('/:kind/:id', controller.remove)

export const homeDataRouter = Router()
homeDataRouter.get('/members/me/home', authenticate, authorize('MEMBER'), controller.memberHome)
homeDataRouter.get('/reports/dashboard', authenticate, authorize('CENTER_MANAGER'), controller.managerDashboard)
