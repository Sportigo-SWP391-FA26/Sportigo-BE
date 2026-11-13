
import { Router } from 'express'

import { authRouter } from '../modules/auth/auth.routes.js'
import { trainingRouter } from '../modules/training/training.routes.js'
import { financeRouter } from '../modules/finance/finance.routes.js'
import { usersRouter } from '../modules/users/users.routes.js'
import { staffRouter } from '../modules/users/staff.routes.js'
import { membersRouter } from '../modules/users/members.routes.js'
import { coachMembersRouter, coachSessionsRouter } from '../modules/users/coach-members.routes.js'
import { notificationsRouter } from '../modules/notifications/notifications.routes.js'
import { supportRouter } from '../modules/support/support.routes.js'
import { sessionCoachRouter } from '../modules/workforce/session-coach.routes.js'
import { staffShiftRouter } from '../modules/workforce/staff-shift.routes.js'
import { coachAbsenceRouter } from '../modules/workforce/coach-absence.routes.js'

import sportRoutes from '../modules/sports/sport.routes.js'
import roomRoutes from '../modules/rooms/room.routes.js'
import coachRoutes from '../modules/coaches/coach.routes.js'
import groupClassRoutes from '../modules/group-classes/group-class.routes.js'
import sessionRoutes from '../modules/class-sessions/session.routes.js'
import bookingRoutes from '../modules/bookings/booking.routes.js'
import waitlistRoutes, { waitlistReadRouter } from '../modules/waitlist/waitlist.routes.js'
import privateRoutes from '../modules/private-courses/private.routes.js'
import attendanceRoutes from '../modules/attendance/attendance.routes.js'
import reportRoutes from '../modules/reports/report.routes.js'
import { homeDataRouter, landingContentRouter, publicContentRouter } from '../modules/content/content.routes.js'
import { uploadRouter } from '../modules/uploads/upload.routes.js'
import { availabilityChangeRequestRouter, availabilitySubmissionRouter, coachAvailabilitySelfRouter } from '../modules/coach-availability/coach-availability.routes.js'
import { assessmentMetricRouter } from '../modules/training/assessment-metric.routes.js'
import { membershipRouter } from '../modules/memberships/membership.routes.js'
import { coachAssessmentRouter } from '../modules/training/progress-assessment.routes.js'

import { centerSettingsRouter } from '../modules/center-settings/center-settings.routes.js'

export const apiRouter = Router()

// Authentication
apiRouter.use('/auth', authRouter)
apiRouter.use('/public', publicContentRouter)
apiRouter.use('/landing-content', landingContentRouter)
apiRouter.use('/center-settings', centerSettingsRouter)
apiRouter.use(homeDataRouter)

// Profile (FR-05, FR-62)
apiRouter.use('/users', usersRouter)

// Staff management (FR-07)
apiRouter.use('/staff', staffRouter)
apiRouter.use('/uploads', uploadRouter)

// Phải đứng trước '/members' để POST /members/:id/memberships không bị router hội viên chặn
apiRouter.use(membershipRouter)

// Member management (FR-08)
apiRouter.use('/members', membersRouter)

// Coach's members (FR-11); phải đứng trước '/coaches' để "me" không bị coi là id coach
apiRouter.use('/coaches/me/members', coachMembersRouter)
apiRouter.use('/coaches/me/sessions', coachSessionsRouter)
apiRouter.use('/coaches/me', coachAssessmentRouter)
apiRouter.use('/coaches/me', coachAvailabilitySelfRouter)
apiRouter.use('/coach-availability-submissions', availabilitySubmissionRouter)
apiRouter.use('/coach-availability-change-requests', availabilityChangeRequestRouter)

// note: FR-66 coach dạy thực tế từng buổi, FR-67 ca làm và chấm công lễ tân
apiRouter.use('/session-coaches', sessionCoachRouter)
apiRouter.use('/staff-shifts', staffShiftRouter)
apiRouter.use('/coach-absences', coachAbsenceRouter)

// Notifications (FR-54)
apiRouter.use('/notifications', notificationsRouter)

// Support requests (FR-55, FR-56)
apiRouter.use('/support-requests', supportRouter)

// Training and finance
apiRouter.use(trainingRouter)
apiRouter.use(financeRouter)

// Sports center management
apiRouter.use('/sports', sportRoutes)
apiRouter.use('/sports/:sportId/assessment-metrics', assessmentMetricRouter)
apiRouter.use('/rooms', roomRoutes)
apiRouter.use('/coaches', coachRoutes)

// Group classes and bookings
apiRouter.use('/group-classes', groupClassRoutes)
apiRouter.use('/class-sessions', sessionRoutes)
apiRouter.use('/bookings', bookingRoutes)
apiRouter.use('/group-classes', waitlistRoutes)
apiRouter.use('/waitlist', waitlistReadRouter)

// Private courses
apiRouter.use('/private-courses', privateRoutes)

// Other features
apiRouter.use('/', attendanceRoutes)
apiRouter.use('/', reportRoutes)
