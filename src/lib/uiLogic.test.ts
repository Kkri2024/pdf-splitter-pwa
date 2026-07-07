import { describe, expect, it } from 'vitest'
import { createPreviewGroups, getAdjacentPreviewPage, isRemainderOutput } from './uiLogic'
import type { SplitOutput } from './pdfSplitter'

const thumbnails = Array.from({ length: 12 }, (_, index) => ({
  pageNumber: index + 1,
  url: `blob:${index + 1}`,
  width: 595,
  height: 842,
}))

function output(pageCount: number): SplitOutput {
  return {
    name: `${pageCount}.pdf`,
    bytes: new Uint8Array(),
    range: { start: 1, end: pageCount },
    pageCount,
  }
}

describe('preview grouping', () => {
  it('groups fixed mode by the live chunk size', () => {
    expect(createPreviewGroups(thumbnails, 12, 'fixed', 5).map((group) => group.range))
      .toEqual([{ start: 1, end: 5 }, { start: 6, end: 10 }, { start: 11, end: 12 }])
    expect(createPreviewGroups(thumbnails, 12, 'fixed', 3)).toHaveLength(4)
  })

  it('keeps exact divisions and a single large group correct', () => {
    expect(createPreviewGroups(thumbnails.slice(0, 10), 10, 'fixed', 5)).toHaveLength(2)
    expect(createPreviewGroups(thumbnails.slice(0, 3), 3, 'fixed', 5)).toHaveLength(1)
  })

  it('does not group other modes or invalid input', () => {
    expect(createPreviewGroups(thumbnails, 12, 'each', 1)).toHaveLength(1)
    expect(createPreviewGroups(thumbnails, 12, 'custom', 5)).toHaveLength(0)
    expect(createPreviewGroups(thumbnails, 12, 'fixed', 0)).toHaveLength(1)
  })

  it('shows only custom ranges in their entered order', () => {
    const plan = [
      { start: 8, end: 10 },
      { start: 1, end: 3 },
      { start: 5, end: 5 },
    ]
    const groups = createPreviewGroups(thumbnails, 12, 'custom', 5, plan)

    expect(groups.map((group) => group.range)).toEqual(plan)
    expect(groups.map((group) => group.thumbnails.map((thumbnail) => thumbnail.pageNumber)))
      .toEqual([[8, 9, 10], [1, 2, 3], [5]])
  })

  it('repeats overlapping custom pages in each output group', () => {
    const groups = createPreviewGroups(thumbnails, 12, 'custom', 5, [
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ])
    expect(groups[0].thumbnails.map((thumbnail) => thumbnail.pageNumber)).toEqual([1, 2, 3])
    expect(groups[1].thumbnails.map((thumbnail) => thumbnail.pageNumber)).toEqual([3, 4])
  })
})

describe('result presentation', () => {
  it('marks only a short final fixed output as remainder', () => {
    const outputs = [output(5), output(5), output(2)]
    expect(isRemainderOutput(outputs, 2, 'fixed', 5)).toBe(true)
    expect(isRemainderOutput(outputs, 1, 'fixed', 5)).toBe(false)
    expect(isRemainderOutput([output(2)], 0, 'fixed', 5)).toBe(false)
    expect(isRemainderOutput(outputs, 2, 'custom', 5)).toBe(false)
  })
})

describe('bounded preview navigation', () => {
  it('moves only inside the selected output range', () => {
    const range = { start: 6, end: 10 }
    expect(getAdjacentPreviewPage(6, -1, range)).toBe(6)
    expect(getAdjacentPreviewPage(6, 1, range)).toBe(7)
    expect(getAdjacentPreviewPage(10, 1, range)).toBe(10)
  })
})
