import { Router } from 'express'
import {
  attendanceRouter,
  classSessionAttendanceRouter,
} from './attendance.routes.js'

// Mỗi route tự gắn authenticate/authorize, không dùng middleware cấp router
// để không chặn nhầm route của module khác dùng chung tiền tố.
export const trainingRouter = Router()
trainingRouter.use('/class-sessions', classSessionAttendanceRouter)
trainingRouter.use('/attendance', attendanceRouter)
