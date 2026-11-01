let clear: () => void = () => undefined

export function registerMemberTrainingCacheInvalidator(invalidator: () => void) {
  clear = invalidator
}

export function invalidateMemberTrainingCache() {
  clear()
}
