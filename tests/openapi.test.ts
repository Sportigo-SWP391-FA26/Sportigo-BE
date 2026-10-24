import { describe, expect, it } from 'vitest'
import { openApiDocument } from '../src/openapi.js'

describe('OpenAPI document', () => {
  it('documents the merged Flow 2 routes alongside finance and training', () => {
    const paths = openApiDocument.paths as Record<string, unknown>
    const expected = [
      '/sports',
      '/rooms',
      '/coaches/{id}/availability',
      '/group-classes',
      '/group-classes/{id}/sessions/recurring',
      '/class-sessions/{id}/change',
      '/bookings/classes',
      '/bookings/classes/{id}/register',
      '/bookings/registrations/{id}/cancel',
      '/group-classes/{id}/waitlist',
      '/private-courses',
      '/private-courses/{id}/enroll',
      '/private-courses/enrollments/{id}',
      '/sessions/{sessionId}/attendance',
      '/reports/attendance',
      '/orders/{id}/payments/vnpay',
      '/workout-plans',
    ]

    expect(expected.filter((path) => !paths[path])).toEqual([])
  })

  it('does not expose the removed duplicate wallet-payment endpoint', () => {
    expect(openApiDocument.paths).not.toHaveProperty('/orders/{id}/pay')
  })
})
