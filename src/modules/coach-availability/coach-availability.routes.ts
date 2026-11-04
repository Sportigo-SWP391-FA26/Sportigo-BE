import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.js'
import * as controller from './coach-availability.controller.js'

export const coachAvailabilitySelfRouter = Router()
coachAvailabilitySelfRouter.use(authenticate, authorize('COACH'))
coachAvailabilitySelfRouter.get('/availability-calendar', controller.getMyCalendar)
coachAvailabilitySelfRouter.put('/availability-submissions/:month/draft', controller.saveMyDraft)
coachAvailabilitySelfRouter.post('/availability-submissions/:month/submit', controller.submitMyAvailability)
coachAvailabilitySelfRouter.post('/availability-change-requests', controller.createMyChangeRequest)
coachAvailabilitySelfRouter.get('/availability-change-requests', controller.listMyChangeRequests)

export const availabilitySubmissionRouter = Router()
availabilitySubmissionRouter.use(authenticate, authorize('CENTER_MANAGER'))
availabilitySubmissionRouter.get('/', controller.listSubmissions)
availabilitySubmissionRouter.get('/:id', controller.getSubmission)
availabilitySubmissionRouter.post('/:id/review', controller.reviewSubmission)

export const availabilityChangeRequestRouter = Router()
availabilityChangeRequestRouter.use(authenticate, authorize('CENTER_MANAGER'))
availabilityChangeRequestRouter.get('/', controller.listChangeRequests)
availabilityChangeRequestRouter.post('/:id/review', controller.reviewChangeRequest)

