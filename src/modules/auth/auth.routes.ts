import { Router } from 'express'
import { forgotPassword, googleLogin, login, logout, refresh, register, resendVerification, resetPassword, verifyEmail } from './auth.controller.js'

export const authRouter = Router()
authRouter.post('/login', login)
authRouter.post('/register', register)
authRouter.post('/verify-email', verifyEmail)
authRouter.post('/resend-verification', resendVerification)
authRouter.post('/forgot-password', forgotPassword)
authRouter.post('/reset-password', resetPassword)
authRouter.post('/google', googleLogin)
authRouter.post('/refresh', refresh)
authRouter.post('/logout', logout)
