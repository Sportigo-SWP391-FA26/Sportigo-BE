import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { openApiDocument } from './openapi.js'
import { apiRouter } from './routes/index.js'

export const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'sport-center-be' })
})

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
app.use('/api', apiRouter)
app.use(errorHandler)
