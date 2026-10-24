
import { Router } from 'express'

import { authRouter } from '../modules/auth/auth.routes.js'
import { trainingRouter } from '../modules/training/training.routes.js'
import { financeRouter } from '../modules/finance/finance.routes.js'

import sportRoutes from '../modules/sports/sport.routes.js'
import roomRoutes from '../modules/rooms/room.routes.js'
import coachRoutes from '../modules/coaches/coach.routes.js'
import groupClassRoutes from '../modules/group-classes/group-class.routes.js'
import sessionRoutes from '../modules/class-sessions/session.routes.js'
import bookingRoutes from '../modules/bookings/booking.routes.js'
import waitlistRoutes from '../modules/waitlist/waitlist.routes.js'
import privateRoutes from '../modules/private-courses/private.routes.js'
import attendanceRoutes from '../modules/attendance/attendance.routes.js'
import reportRoutes from '../modules/reports/report.routes.js'

export const apiRouter = Router()

// Authentication
apiRouter.use('/auth', authRouter)

// Training and finance
apiRouter.use(trainingRouter)
apiRouter.use(financeRouter)

// Sports center management
apiRouter.use('/sports', sportRoutes)
apiRouter.use('/rooms', roomRoutes)
apiRouter.use('/coaches', coachRoutes)

// Group classes and bookings
apiRouter.use('/group-classes', groupClassRoutes)
apiRouter.use('/class-sessions', sessionRoutes)
apiRouter.use('/bookings', bookingRoutes)
apiRouter.use('/group-classes', waitlistRoutes)

// Private courses
apiRouter.use('/private-courses', privateRoutes)

// Other features
apiRouter.use('/', attendanceRoutes)
apiRouter.use('/', reportRoutes)
