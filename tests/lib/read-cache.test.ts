import { describe, expect, it, vi } from 'vitest'
import { KeyedReadCache, ReadCache } from '../../src/lib/read-cache.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('read cache', () => {
  it('keeps serving stale data while a refresh is in flight', async () => {
    vi.useFakeTimers()
    const next = deferred<string>()
    const loader = vi.fn()
      .mockResolvedValueOnce('snapshot')
      .mockReturnValueOnce(next.promise)
    const cache = new ReadCache(loader, 1_000)

    await expect(cache.get()).resolves.toBe('snapshot')
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(cache.get()).resolves.toBe('snapshot')
    await expect(cache.get()).resolves.toBe('snapshot')
    expect(loader).toHaveBeenCalledTimes(2)

    next.resolve('fresh')
    await vi.runAllTicks()
    await expect(cache.get()).resolves.toBe('fresh')
    vi.useRealTimers()
  })

  it('deduplicates refreshes per keyed entry', async () => {
    vi.useFakeTimers()
    const next = deferred<number>()
    const loader = vi.fn()
      .mockResolvedValueOnce(1)
      .mockReturnValueOnce(next.promise)
    const cache = new KeyedReadCache<number>(1_000)

    await expect(cache.get('member:1', loader)).resolves.toBe(1)
    await vi.advanceTimersByTimeAsync(1_001)
    await Promise.all([
      cache.get('member:1', loader),
      cache.get('member:1', loader),
      cache.get('member:1', loader),
    ])
    expect(loader).toHaveBeenCalledTimes(2)

    next.resolve(2)
    await vi.runAllTicks()
    await expect(cache.get('member:1', loader)).resolves.toBe(2)
    vi.useRealTimers()
  })
})
