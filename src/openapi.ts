import { authPaths } from './modules/auth/auth.openapi.js'
import { financePaths } from './modules/finance/finance.openapi.js'
import { trainingPaths } from './modules/training/training.openapi.js'
import { usersPaths } from './modules/users/users.openapi.js'
import { userAdminPaths } from './modules/users/user-admin.openapi.js'
import { notificationsPaths } from './modules/notifications/notifications.openapi.js'
import { flow2Paths } from './modules/bookings/flow2.openapi.js'
import { supportPaths } from './modules/support/support.openapi.js'
import { contentPaths } from './modules/content/content.openapi.js'
import { uploadPaths } from './modules/uploads/upload.openapi.js'
import { coachAvailabilityPaths } from './modules/coach-availability/coach-availability.openapi.js'
import { membershipPaths } from './modules/memberships/membership.openapi.js'
import { workforcePaths } from './modules/workforce/workforce.openapi.js' // note: FR-66/67

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
    { name: 'Notifications', description: 'Thông báo của người dùng' },
    { name: 'User Management', description: 'Quản trị người dùng, nhân sự, hội viên' },
    { name: 'Support', description: 'Yêu cầu hỗ trợ của hội viên' },
    { name: 'Orders' }, { name: 'Payments' },
    { name: 'Wallet' }, { name: 'Promotions' }, { name: 'Refunds' },
    { name: 'Invoices' }, { name: 'Reports' }, { name: 'Audit' },
    { name: 'Sports' }, { name: 'Rooms' }, { name: 'Coaches' },
    { name: 'Group Classes' }, { name: 'Class Sessions' },
    { name: 'Bookings' }, { name: 'Waitlist' },
    { name: 'Private Courses' }, { name: 'Private Enrollments' },
    { name: 'Attendance' },
    { name: 'Public Content' }, { name: 'Landing Management' }, { name: 'Member Home' },
    { name: 'Uploads', description: 'Tải ảnh lên Cloudinary' },
    { name: 'Coach Availability', description: 'Coach đăng ký thời gian có thể nhận lớp' },
    { name: 'Coach Availability Review', description: 'Center Manager duyệt availability và yêu cầu đổi ca' },
    { name: 'Session Coach', description: 'Coach dạy thực tế từng buổi: dạy thay, coach vắng (FR-66)' },
    { name: 'Staff Shifts', description: 'Ca làm và chấm công lễ tân (FR-67)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  paths: {
    ...authPaths,
    ...usersPaths,
    ...userAdminPaths,
    ...notificationsPaths,
    ...supportPaths,
    ...flow2Paths,
    ...financePaths,
    ...trainingPaths,
    ...contentPaths,
    ...uploadPaths,
    ...coachAvailabilityPaths,
    ...membershipPaths,
    ...workforcePaths,
  },
} as const
