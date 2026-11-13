import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { authenticate, authorize, getAuthUser } from '../../middleware/auth.js'
import { listAbsences, requestAbsence, reviewAbsence, scheduleMakeup } from './coach-absence.service.js'
import { listPrivateAbsences, listPrivateAbsenceSessions, requestPrivateAbsence, reviewPrivateAbsence, schedulePrivateMakeup } from './private-coach-absence.service.js'

const id = z.coerce.number().int().positive()
const reason = z.string().trim().min(3).max(300)
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value))
export const coachAbsenceRouter = Router()
coachAbsenceRouter.use(authenticate)

const list: RequestHandler = async (req, res) => {
  const { status } = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).parse(req.query)
  res.json(await listAbsences(getAuthUser(req), status))
}
const request: RequestHandler = async (req, res) => {
  const body = z.object({ sessionId: id, reason }).strict().parse(req.body)
  res.status(201).json(await requestAbsence(getAuthUser(req), body.sessionId, body.reason))
}
const review: RequestHandler = async (req, res) => {
  const body = z.object({ approve: z.boolean(), reason: reason.optional() }).strict().refine((value) => value.approve || !!value.reason).parse(req.body)
  res.json(await reviewAbsence(getAuthUser(req), id.parse(req.params.id), body.approve, body.reason))
}
const makeup: RequestHandler = async (req, res) => {
  const body = z.object({ coachId: id, roomId: id, startsAt: instant, endsAt: instant }).strict().parse(req.body)
  res.status(201).json(await scheduleMakeup(getAuthUser(req), id.parse(req.params.id), body))
}

coachAbsenceRouter.get('/me', authorize('COACH'), list)
coachAbsenceRouter.post('/me', authorize('COACH'), request)
coachAbsenceRouter.get('/', authorize('CENTER_MANAGER'), list)
coachAbsenceRouter.post('/:id/review', authorize('CENTER_MANAGER'), review)
coachAbsenceRouter.post('/:id/makeup', authorize('CENTER_MANAGER'), makeup)

coachAbsenceRouter.get('/private/me/sessions', authorize('COACH'), async (req, res) => { res.json(await listPrivateAbsenceSessions(getAuthUser(req))) })
coachAbsenceRouter.get('/private/me', authorize('COACH'), async (req, res) => { res.json(await listPrivateAbsences(getAuthUser(req))) })
coachAbsenceRouter.post('/private/me', authorize('COACH'), async (req, res) => {
  const body = z.object({ scheduleId: id, sessionDate: z.iso.date(), reason }).strict().parse(req.body)
  res.status(201).json(await requestPrivateAbsence(getAuthUser(req), body.scheduleId, body.sessionDate, body.reason))
})
coachAbsenceRouter.get('/private', authorize('CENTER_MANAGER'), async (req, res) => { res.json(await listPrivateAbsences(getAuthUser(req))) })
coachAbsenceRouter.post('/private/:id/review', authorize('CENTER_MANAGER'), async (req, res) => {
  const body = z.object({ approve: z.boolean(), reason: reason.optional() }).strict().refine((value) => value.approve || !!value.reason).parse(req.body)
  res.json(await reviewPrivateAbsence(getAuthUser(req), id.parse(req.params.id), body.approve, body.reason))
})
coachAbsenceRouter.post('/private/:id/makeup', authorize('CENTER_MANAGER'), async (req, res) => {
  const body = z.object({ coachId: id, roomId: id, startsAt: instant, endsAt: instant }).strict().parse(req.body)
  res.status(201).json(await schedulePrivateMakeup(getAuthUser(req), id.parse(req.params.id), body))
})
