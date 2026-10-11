import request from 'supertest'
import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/sport_center?schema=public'
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-with-at-least-32-chars'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-with-at-least-32-chars'

const { app } = await import('../src/app.js')

describe('GET /health', () => {
  it('returns service status', async () => {
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })
})
