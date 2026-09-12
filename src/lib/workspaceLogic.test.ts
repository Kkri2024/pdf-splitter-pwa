import { describe, expect, it, vi } from 'vitest'
import { removeOwnedEntries, toggleSourcePages, orderPagesBySources } from './workspaceLogic'
import type { MergePage } from './pdfMerger'
const pages = (sourceId: string): MergePage[] => [0, 1].map(sourcePageIndex => ({ id: `${sourceId}-page-${sourcePageIndex + 1}`, sourceId, sourceName: sourceId, sourcePageIndex, rotation: 0 }))

describe('workspace ownership', () => {
  it('releases only split resources and leaves merge resources usable', () => {
    const entries = new Map([['page-1', 'split'], ['a-page-1', 'merge']])
    const dispose = vi.fn()
    removeOwnedEntries(entries, 'split', dispose)
    expect([...entries]).toEqual([['a-page-1', 'merge']])
    expect(dispose.mock.calls).toEqual([['split']])
    removeOwnedEntries(entries, 'merge', dispose)
    expect(entries.size).toBe(0)
  })
})
describe('merge selection and ordering', () => {
  it('adds only missing pages at the end without moving existing pages', () => {
    const a = pages('a'), b = pages('b')
    const result = toggleSourcePages([b[1], a[1], b[0]], a)
    expect(result.map(page => page.id)).toEqual([b[1].id, a[1].id, b[0].id, a[0].id])
    expect(toggleSourcePages(result, a)).toEqual([b[1], b[0]])
  })
  it('sorts selected pages by file order without adding unselected pages', () => {
    const a = pages('a'), b = pages('b')
    expect(orderPagesBySources([a[0], ...b], ['b', 'a'])).toEqual([...b, a[0]])
  })
})
