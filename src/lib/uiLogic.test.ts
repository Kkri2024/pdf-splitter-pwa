import { describe, expect, it } from 'vitest'
import { createPreviewGroups, getAdjacentPreviewPage, isRemainderOutput } from './uiLogic'
import type { SplitOutput } from './pdfSplitter'

const thumbnails = Array.from({ length: 12 }, (_, index) => ({
  pageNumber: index + 1,
  url: `blob:${index + 1}`,
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
    expect(createPreviewGroups(thumbnails, 12, 'custom', 5)).toHaveLength(1)
    expect(createPreviewGroups(thumbnails, 12, 'fixed', 0)).toHaveLength(1)
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
