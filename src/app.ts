import cors from 'cors'
import compression from 'compression'
import express from 'express'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { openApiDocument } from './openapi.js'
import { apiRouter } from './routes/index.js'

export const app = express()

const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export function isOriginAllowed(origin: string, patterns = allowedOrigins) {
  return patterns.some((pattern) => {
    if (pattern === origin) return true
    if (!pattern.startsWith('https://*.')) return false

    const suffix = pattern.slice('https://*'.length)
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.hostname.endsWith(suffix) && url.hostname !== suffix.slice(1)
    } catch {
      return false
    }
  })
}

app.use(helmet())
// Nén JSON/OpenAPI ở cả BE local và Render. Ảnh Cloudinary không đi qua BE nên
// không bị nén lại hoặc tăng tải CPU không cần thiết.
app.use(compression())
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isOriginAllowed(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'sport-center-be' })
})

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))
app.use('/api', apiRouter)
app.use(errorHandler)
