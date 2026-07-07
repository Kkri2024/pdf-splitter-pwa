import { describe, expect, it } from 'vitest'
import { getThumbnailConcurrency, trimThumbnailUrls } from './thumbnailCache'

describe('thumbnail performance limits', () => {
  it('uses one renderer for touch and two for desktop', () => {
    expect(getThumbnailConcurrency(true)).toBe(1)
    expect(getThumbnailConcurrency(false)).toBe(2)
  })

  it('keeps only the latest 48 thumbnail URLs', () => {
    const cache = new Map(Array.from({ length: 52 }, (_, index) => [`page-${index + 1}`, `blob:${index + 1}`]))
    const evicted = trimThumbnailUrls(cache)
    expect(cache.size).toBe(48)
    expect(evicted.map(([id]) => id)).toEqual(['page-1', 'page-2', 'page-3', 'page-4'])
  })
})
