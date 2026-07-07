import type { Thumbnail } from './pdfPreview'
import type { PageRange, SplitMode, SplitOutput } from './pdfSplitter'

export interface PreviewGroup {
  index: number
  range: PageRange
  thumbnails: Thumbnail[]
}

export function createPreviewGroups(
  thumbnails: Thumbnail[],
  totalPages: number,
  mode: SplitMode,
  chunkSize: number,
  plan: PageRange[] = [],
): PreviewGroup[] {
  if (totalPages < 1) return []
  if (mode === 'each') {
    return [{ index: 0, range: { start: 1, end: totalPages }, thumbnails }]
  }

  if (mode === 'custom') {
    return plan.map((range, index) => ({
      index,
      range,
      thumbnails: thumbnails.filter(
        (thumbnail) => thumbnail.pageNumber >= range.start && thumbnail.pageNumber <= range.end,
      ),
    }))
  }

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    return [{ index: 0, range: { start: 1, end: totalPages }, thumbnails }]
  }

  const groups: PreviewGroup[] = []
  const fixedPlan = plan.length > 0
    ? plan
    : Array.from({ length: Math.ceil(totalPages / chunkSize) }, (_, index) => ({
        start: index * chunkSize + 1,
        end: Math.min((index + 1) * chunkSize, totalPages),
      }))

  fixedPlan.forEach((range, index) => {
    groups.push({
      index,
      range,
      thumbnails: thumbnails.filter(
        (thumbnail) => thumbnail.pageNumber >= range.start && thumbnail.pageNumber <= range.end,
      ),
    })
  })
  return groups
}

export function isRemainderOutput(
  outputs: SplitOutput[],
  index: number,
  mode: SplitMode,
  chunkSize: number,
): boolean {
  if (mode !== 'fixed' || outputs.length < 2 || index !== outputs.length - 1) return false
  if (!Number.isInteger(chunkSize) || chunkSize < 1) return false
  return outputs[index].pageCount < chunkSize
}

export function getAdjacentPreviewPage(
  currentPage: number,
  direction: -1 | 1,
  range: PageRange,
): number {
  const nextPage = currentPage + direction
  return nextPage >= range.start && nextPage <= range.end ? nextPage : currentPage
}
