import { describe, expect, test } from 'vitest'
import { isOriginAllowed } from '../src/app.js'

describe('CORS origin matching', () => {
  const patterns = ['http://localhost:5173', 'https://sportigo-fe.vercel.app', 'https://*.vercel.app']

  test('allows exact local and production origins', () => {
    expect(isOriginAllowed('http://localhost:5173', patterns)).toBe(true)
    expect(isOriginAllowed('https://sportigo-fe.vercel.app', patterns)).toBe(true)
  })

  test('allows HTTPS Vercel preview subdomains', () => {
    expect(isOriginAllowed('https://sportigo-abc-team.vercel.app', patterns)).toBe(true)
  })

  test('rejects lookalike domains and insecure preview origins', () => {
    expect(isOriginAllowed('https://vercel.app.evil.example', patterns)).toBe(false)
    expect(isOriginAllowed('http://sportigo-abc-team.vercel.app', patterns)).toBe(false)
  })
})
