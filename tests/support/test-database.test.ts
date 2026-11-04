import { describe, expect, it } from 'vitest'
import { assertSafeTestDatabase } from './test-database.js'

const production = 'postgresql://postgres:secret@db.example.com:5432/sportigo?schema=public'

describe('database destructive-operation guard', () => {
  it('rejects every destructive database operation in production mode', () => {
    expect(() => assertSafeTestDatabase(
      'postgresql://postgres:secret@localhost:5432/sportigo_test?schema=public',
      { nodeEnv: 'production' },
    )).toThrow(/NODE_ENV=production/)
  })

  it('rejects production even when connection parameters are formatted differently', () => {
    expect(() => assertSafeTestDatabase(
      'postgresql://postgres:other-password@db.example.com:5432/sportigo?schema=public&connection_limit=1',
      { productionUrl: production, nodeEnv: 'test' },
    )).toThrow(/trùng chính xác database production/)
  })

  it('rejects a database without an explicit test database or schema name', () => {
    expect(() => assertSafeTestDatabase(
      'postgresql://postgres:secret@localhost:5432/sportigo?schema=public',
      { nodeEnv: 'test' },
    )).toThrow(/phải chứa "test"/)
  })

  it('allows an explicitly isolated test schema', () => {
    expect(() => assertSafeTestDatabase(
      'postgresql://postgres:secret@db.example.com:5432/sportigo?schema=sportigo_test',
      { productionUrl: production, nodeEnv: 'test' },
    )).not.toThrow()
  })

  it('requires an explicit opt-in for a remote Supabase test schema', () => {
    const remote = 'postgresql://postgres:secret@pooler.supabase.com:5432/postgres?schema=sportigo_test'
    expect(() => assertSafeTestDatabase(remote, { nodeEnv: 'test', allowRemote: false }))
      .toThrow(/Từ chối chạy test trên Supabase/)
    expect(() => assertSafeTestDatabase(remote, { nodeEnv: 'test', allowRemote: true }))
      .not.toThrow()
  })
})
