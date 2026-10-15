import { Router } from 'express'
import { authRouter } from '../modules/auth/auth.routes.js'
import { trainingRouter } from '../modules/training/training.routes.js'

export const apiRouter = Router()
apiRouter.use('/auth', authRouter)
apiRouter.use(trainingRouter)
