import { authPaths } from './modules/auth/auth.openapi.js'
import { financePaths } from './modules/finance/finance.openapi.js'
import { trainingPaths } from './modules/training/training.openapi.js'
import { usersPaths } from './modules/users/users.openapi.js'
import { flow2Paths } from './modules/bookings/flow2.openapi.js'

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Sport Center API',
    version: '0.2.0',
    description: 'REST API cho hệ thống quản lý trung tâm thể thao.',
  },
  servers: [
    { url: 'http://localhost:3000/api', description: 'Local development' },
    { url: 'https://sportigo-api-lcpy.onrender.com/api', description: 'Render production' },
  ],
  tags: [
    { name: 'Login', description: 'Đăng nhập thường và đăng nhập Google' },
    { name: 'Registration', description: 'Đăng ký tài khoản Member' },
    { name: 'Email Verification', description: 'Xác minh email bằng OTP' },
    { name: 'Password Recovery', description: 'Quên và đặt lại mật khẩu' },
    { name: 'Session', description: 'Làm mới phiên và đăng xuất' },
    { name: 'Profile', description: 'Hồ sơ cá nhân' },
    { name: 'Orders' }, { name: 'Payments' },
    { name: 'Wallet' }, { name: 'Promotions' }, { name: 'Refunds' },
    { name: 'Invoices' }, { name: 'Reports' }, { name: 'Audit' },
    { name: 'Sports' }, { name: 'Rooms' }, { name: 'Coaches' },
    { name: 'Group Classes' }, { name: 'Class Sessions' },
    { name: 'Bookings' }, { name: 'Waitlist' },
    { name: 'Private Courses' }, { name: 'Private Enrollments' },
    { name: 'Attendance' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  paths: {
    ...authPaths,
    ...usersPaths,
    ...flow2Paths,
    ...financePaths,
    ...trainingPaths,
  },
} as const
