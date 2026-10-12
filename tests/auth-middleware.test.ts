import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../src/middleware/error-handler.js'
import { authenticate, authorize } from '../src/middleware/auth.js'
import { createAccessToken } from '../src/modules/auth/token.service.js'

const app = express()
app.get(
  '/coach-only',
  authenticate,
  authorize('COACH'),
  (request, response) => {
    response.json(request.user)
  },
)
app.use(errorHandler)

const bearer = (token: string) => `Bearer ${token}`

describe('Middleware authenticate/authorize (FR-04 tạm, BR-06)', () => {
  it('BR-06: thiếu token trả 401', async () => {
    const response = await request(app).get('/coach-only')

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('UNAUTHENTICATED')
  })

  it('BR-06: token ký bằng secret khác trả 401', async () => {
    const forged = jwt.sign(
      { role: 'COACH' },
      'another-secret-with-32-characters!!',
      {
        subject: '1',
      },
    )
    const response = await request(app)
      .get('/coach-only')
      .set('Authorization', bearer(forged))

    expect(response.status).toBe(401)
  })

  it('BR-06: sai role trả 403 với thông báo của BR-06', async () => {
    const token = createAccessToken({ userId: 7, role: 'MEMBER' })
    const response = await request(app)
      .get('/coach-only')
      .set('Authorization', bearer(token))

    expect(response.status).toBe(403)
    expect(response.body.message).toBe(
      'Bạn không có quyền thực hiện thao tác này.',
    )
  })

  it('đúng role thì gắn request.user từ token', async () => {
    const token = createAccessToken({ userId: 7, role: 'COACH' })
    const response = await request(app)
      .get('/coach-only')
      .set('Authorization', bearer(token))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 7, role: 'COACH' })
  })
})
