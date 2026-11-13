import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findUser } = vi.hoisted(() => ({ findUser: vi.fn() }))
vi.mock('../src/lib/prisma.js', () => ({ prisma: { user: { findUnique: findUser } } }))
import { errorHandler } from '../src/middleware/error-handler.js'
import { authenticate, authorize } from '../src/middleware/auth.js'
import { createAccessToken } from '../src/modules/auth/token.service.js'
import { invalidateAuthState } from '../src/lib/auth-state.js'

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
  beforeEach(() => {
    invalidateAuthState()
    findUser.mockReset()
    findUser.mockResolvedValue({ status: 'ACTIVE', deletedAt: null, role: { name: 'COACH' } })
  })

  it('BR-05: tài khoản đã khóa hoặc xóa thì token còn hạn cũng bị từ chối ngay', async () => {
    findUser.mockResolvedValue({ status: 'LOCKED', deletedAt: null, role: { name: 'COACH' } })
    const response = await request(app).get('/coach-only').set('Authorization', bearer(createAccessToken({ userId: 7, role: 'COACH' })))
    expect(response.status).toBe(401)
    expect(response.body.code).toBe('ACCOUNT_INACTIVE')
  })

  it('token mang role cũ sau khi role đổi thì bị từ chối', async () => {
    findUser.mockResolvedValue({ status: 'ACTIVE', deletedAt: null, role: { name: 'MEMBER' } })
    const response = await request(app).get('/coach-only').set('Authorization', bearer(createAccessToken({ userId: 7, role: 'COACH' })))
    expect(response.status).toBe(401)
  })

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
    findUser.mockResolvedValue({ status: 'ACTIVE', deletedAt: null, role: { name: 'MEMBER' } })
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
