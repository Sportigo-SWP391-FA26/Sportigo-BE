import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import * as service from './coach-availability.service.js'
import { changeListSchema, changeRequestSchema, draftSchema, idParamSchema, monthParamSchema, reviewSchema, submissionListSchema } from './coach-availability.schema.js'

export const getMyCalendar: RequestHandler = async (req, res) => {
  const { month } = monthParamSchema.parse(req.query)
  res.json(await service.getMyCalendar(getAuthUser(req).id, month))
}

export const saveMyDraft: RequestHandler = async (req, res) => {
  const { month } = monthParamSchema.parse(req.params)
  const { selections } = draftSchema.parse(req.body)
  res.json(await service.saveDraft(getAuthUser(req).id, month, selections))
}

export const submitMyAvailability: RequestHandler = async (req, res) => {
  const { month } = monthParamSchema.parse(req.params)
  res.json(await service.submit(getAuthUser(req).id, month))
}

export const createMyChangeRequest: RequestHandler = async (req, res) => {
  const input = changeRequestSchema.parse(req.body)
  res.status(201).json(await service.createChangeRequest(getAuthUser(req).id, input))
}

export const listMyChangeRequests: RequestHandler = async (req, res) => {
  res.json(await service.listMyChangeRequests(getAuthUser(req).id))
}

export const listSubmissions: RequestHandler = async (req, res) => {
  res.json(await service.listSubmissions(submissionListSchema.parse(req.query)))
}

export const getSubmission: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  res.json(await service.getSubmission(id))
}

export const reviewSubmission: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  res.json(await service.reviewSubmission(id, getAuthUser(req).id, reviewSchema.parse(req.body)))
}

export const listChangeRequests: RequestHandler = async (req, res) => {
  res.json(await service.listChangeRequests(changeListSchema.parse(req.query)))
}

export const reviewChangeRequest: RequestHandler = async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  res.json(await service.reviewChangeRequest(id, getAuthUser(req).id, reviewSchema.parse(req.body)))
}

