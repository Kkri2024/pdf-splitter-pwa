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
): PreviewGroup[] {
  if (totalPages < 1) return []
  if (mode !== 'fixed' || !Number.isInteger(chunkSize) || chunkSize < 1) {
    return [{ index: 0, range: { start: 1, end: totalPages }, thumbnails }]
  }

  const groups: PreviewGroup[] = []
  for (let start = 1, index = 0; start <= totalPages; start += chunkSize, index += 1) {
    const range = { start, end: Math.min(start + chunkSize - 1, totalPages) }
    groups.push({
      index,
      range,
      thumbnails: thumbnails.filter(
        (thumbnail) => thumbnail.pageNumber >= range.start && thumbnail.pageNumber <= range.end,
      ),
    })
  }
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
