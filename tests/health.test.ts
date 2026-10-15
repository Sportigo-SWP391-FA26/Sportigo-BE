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

  it('allows the local frontend origin used by the in-app browser', async () => {
    const response = await request(app)
      .options('/api/auth/register')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')

    expect(response.status).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:5173',
    )
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })
})
