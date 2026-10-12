import type { RequestHandler } from 'express'
import { getAuthUser } from '../../middleware/auth.js'
import * as memberTrainingService from './member-training.service.js'

export const getMyTraining: RequestHandler = async (request, response) => {
  response.json(await memberTrainingService.getMyTraining(getAuthUser(request)))
}
