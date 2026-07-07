import { describe, expect, it } from 'vitest'
import {
  createEditedExportJob,
  createOutputJobs,
  createPageEditState,
  pageEditReducer,
  rangesToSelectedIds,
  selectedIdsToRangeSpec,
} from './pageEditor'

describe('page editing', () => {
  it('rotates, deletes, reorders and restores without changing source indexes', () => {
    let state = createPageEditState(4)
    state = pageEditReducer(state, { type: 'set-selection', ids: ['page-2', 'page-3'] })
    state = pageEditReducer(state, { type: 'rotate', direction: 1 })
    expect(state.present.pages.map((page) => page.rotation)).toEqual([0, 90, 90, 0])
    state = pageEditReducer(state, { type: 'delete-selected' })
    expect(state.present.pages.map((page) => page.sourcePageIndex)).toEqual([0, 3])
    state = pageEditReducer(state, { type: 'move-to', id: 'page-4', position: 1 })
    expect(state.present.pages.map((page) => page.sourcePageIndex)).toEqual([3, 0])
    state = pageEditReducer(state, { type: 'restore' })
    expect(state.present.pages.map((page) => page.sourcePageIndex)).toEqual([0, 1, 2, 3])
  })

  it('supports undo, redo and a 50-step history cap', () => {
    let state = createPageEditState(2)
    state = pageEditReducer(state, { type: 'set-selection', ids: ['page-1'] })
    for (let index = 0; index < 55; index += 1) state = pageEditReducer(state, { type: 'rotate', direction: 1 })
    expect(state.past).toHaveLength(50)
    const rotation = state.present.pages[0].rotation
    state = pageEditReducer(state, { type: 'undo' })
    expect(state.present.pages[0].rotation).not.toBe(rotation)
    state = pageEditReducer(state, { type: 'redo' })
    expect(state.present.pages[0].rotation).toBe(rotation)
  })

  it('refuses to delete every remaining page', () => {
    let state = createPageEditState(1)
    state = pageEditReducer(state, { type: 'select-all' })
    expect(pageEditReducer(state, { type: 'delete-selected' })).toBe(state)
  })
})

describe('visual selection and output jobs', () => {
  const pages = createPageEditState(8).present.pages

  it('converts between ranges and selected page ids', () => {
    const ids = rangesToSelectedIds([{ start: 1, end: 3 }, { start: 5, end: 5 }], pages)
    expect(ids).toEqual(['page-1', 'page-2', 'page-3', 'page-5'])
    expect(selectedIdsToRangeSpec(ids, pages)).toBe('1-3,5')
  })

  it('creates segmented and merged custom outputs', () => {
    const segmented = createOutputJobs('custom', pages, '资料.pdf', { rangeSpec: '1-3,5', selectionOutputMode: 'segments' })
    expect(segmented.map((job) => job.pages.length)).toEqual([3, 1])
    const merged = createOutputJobs('custom', pages, '资料.pdf', { rangeSpec: '1-3,5', selectionOutputMode: 'merged' })
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('资料_selected.pdf')
    expect(merged[0].pages.map((page) => page.sourcePageIndex)).toEqual([0, 1, 2, 4])
  })

  it('uses edited order for fixed, each and complete export jobs', () => {
    const reordered = [pages[3], pages[0], pages[2]]
    expect(createOutputJobs('fixed', reordered, 'a.pdf', { pagesPerFile: 2 }).map((job) => job.pages.map((page) => page.sourcePageIndex))).toEqual([[3, 0], [2]])
    expect(createOutputJobs('each', reordered, 'a.pdf').map((job) => job.pages[0].sourcePageIndex)).toEqual([3, 0, 2])
    expect(createEditedExportJob(reordered, 'a.pdf').name).toBe('a_edited.pdf')
  })

  it('builds large document jobs without creating page copies', () => {
    const largePages = createPageEditState(1_000).present.pages
    const jobs = createOutputJobs('fixed', largePages, 'large.pdf', { pagesPerFile: 100 })
    expect(jobs).toHaveLength(10)
    expect(jobs.flatMap((job) => job.pages)).toHaveLength(1_000)
    expect(jobs[9].pages[99]).toBe(largePages[999])
  })
})
