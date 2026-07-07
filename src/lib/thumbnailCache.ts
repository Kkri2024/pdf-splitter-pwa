export function getThumbnailConcurrency(coarsePointer: boolean): number {
  return coarsePointer ? 1 : 2
}

export function trimThumbnailUrls(cache: Map<string, string>, limit = 48): Array<[string, string]> {
  const evicted: Array<[string, string]> = []
  while (cache.size > limit) {
    const oldest = cache.entries().next().value as [string, string] | undefined
    if (!oldest) break
    cache.delete(oldest[0])
    evicted.push(oldest)
  }
  return evicted
}
