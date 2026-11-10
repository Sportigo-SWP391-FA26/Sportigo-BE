import { describe, expect, it } from 'vitest'
import { assertClassRegistrationCancellable } from '../../src/modules/bookings/cancellation-policy.js'

describe('FR-28 class cancellation cutoff', () => {
  const now = new Date('2026-10-23T12:00:00.000Z')
  const atHours = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000)

  it('refunds in full at or before the 48-hour cutoff', () => {
    expect(assertClassRegistrationCancellable(atHours(48), 'MEMBER', now, 48)).toBe(1)
    expect(assertClassRegistrationCancellable(atHours(49), 'MEMBER', now, 48)).toBe(1)
  })

  it('refunds half within 48 hours before the first session for Member and Receptionist', () => {
    expect(assertClassRegistrationCancellable(atHours(47.99), 'MEMBER', now, 48)).toBe(0.5)
    expect(assertClassRegistrationCancellable(atHours(1), 'RECEPTIONIST', now, 48)).toBe(0.5)
  })

  it('rejects cancellation at or after the start for every role', () => {
    expect(() => assertClassRegistrationCancellable(now, 'RECEPTIONIST', now, 48))
      .toThrow(expect.objectContaining({ code: 'CLASS_ALREADY_STARTED' }))
    expect(() => assertClassRegistrationCancellable(atHours(-1), 'MEMBER', now, 48))
      .toThrow(expect.objectContaining({ code: 'CLASS_ALREADY_STARTED' }))
  })
})
