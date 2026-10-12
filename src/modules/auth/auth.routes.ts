import { Router } from 'express'
import { login, logout, refresh, register, resendVerification, verifyEmail } from './auth.controller.js'

export const authRouter = Router()
authRouter.post('/login', login)
authRouter.post('/register', register)
authRouter.post('/verify-email', verifyEmail)
authRouter.post('/resend-verification', resendVerification)
authRouter.post('/refresh', refresh)
authRouter.post('/logout', logout)
