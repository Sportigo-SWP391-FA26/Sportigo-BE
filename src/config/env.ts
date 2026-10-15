import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z
    .string()
    .min(1)
    .default('http://localhost:5173,http://127.0.0.1:5173'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().default('Sportigo <onboarding@resend.dev>'),
  ATTENDANCE_EDIT_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  GMAIL_WEBHOOK_URL: z.string().url().optional(),
  GMAIL_WEBHOOK_SECRET: z.string().min(32).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
})

export const env = schema.parse(process.env)
