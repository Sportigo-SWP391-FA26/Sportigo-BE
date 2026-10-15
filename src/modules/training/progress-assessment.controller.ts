import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import {
  createAssessmentSchema,
  listAssessmentsQuerySchema,
} from './progress-assessment.schema.js'
import * as assessmentService from './progress-assessment.service.js'

export const createAssessment: RequestHandler = async (request, response) => {
  const input = createAssessmentSchema.parse(request.body)
  const assessment = await assessmentService.createAssessment(
    getAuthUser(request),
    input,
  )
  response.status(201).json(assessment)
}

export const listAssessments: RequestHandler = async (request, response) => {
  const query = listAssessmentsQuerySchema.parse(request.query)
  const result = await assessmentService.listAssessments(
    getAuthUser(request),
    query,
  )
  response.json(result)
}
