import { Router } from 'express'
import { authRouter } from '../modules/auth/auth.routes.js'
import { trainingRouter } from '../modules/training/training.routes.js'
import { financeRouter } from '../modules/finance/finance.routes.js'
import { usersRouter } from '../modules/users/users.routes.js'

export const apiRouter = Router()
apiRouter.use('/auth', authRouter)
apiRouter.use('/users', usersRouter)
apiRouter.use(trainingRouter)
apiRouter.use(financeRouter)
