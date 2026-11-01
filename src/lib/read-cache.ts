type CacheEntry<T> = {
  expiresAt: number
  promise: Promise<T>
  refreshing?: Promise<void>
}

/** Cache đọc ngắn hạn có stale-while-revalidate để UI không chờ Supabase ở mỗi lần mở trang. */
export class ReadCache<T> {
  private entry: CacheEntry<T> | null = null

  constructor(private readonly loader: () => Promise<T>, private readonly ttlMs = 30_000) {}

  get(): Promise<T> {
    if (!this.entry) return this.refresh()
    if (this.entry.expiresAt > Date.now()) return this.entry.promise

    // Giữ snapshot cũ cho tất cả request trong lúc làm mới nền. Trước đây
    // refresh() thay entry bằng promise mới nên request thứ hai vẫn phải chờ
    // Supabase, làm UI chậm thất thường dù đã có cache.
    this.entry.expiresAt = Date.now() + this.ttlMs
    if (!this.entry.refreshing) {
      const current = this.entry
      current.refreshing = this.loader()
        .then((value) => {
          this.entry = {
            expiresAt: Date.now() + this.ttlMs,
            promise: Promise.resolve(value),
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.entry === current) current.refreshing = undefined
        })
    }
    return this.entry.promise
  }

  invalidate() {
    this.entry = null
  }

  private refresh() {
    const promise = this.loader().catch((error) => {
      this.entry = null
      throw error
    })
    this.entry = { expiresAt: Date.now() + this.ttlMs, promise }
    return promise
  }
}

export class KeyedReadCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  constructor(private readonly ttlMs = 30_000) {}

  get(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key)
    if (!entry) return this.refresh(key, loader)
    if (entry.expiresAt > Date.now()) return entry.promise

    entry.expiresAt = Date.now() + this.ttlMs
    if (!entry.refreshing) {
      entry.refreshing = loader()
        .then((value) => {
          this.entries.set(key, {
            expiresAt: Date.now() + this.ttlMs,
            promise: Promise.resolve(value),
          })
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.entries.get(key) === entry) entry.refreshing = undefined
        })
    }
    return entry.promise
  }

  invalidate() {
    this.entries.clear()
  }

  private refresh(key: string, loader: () => Promise<T>) {
    const promise = loader().catch((error) => {
      this.entries.delete(key)
      throw error
    })
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, promise })
    return promise
  }
}
