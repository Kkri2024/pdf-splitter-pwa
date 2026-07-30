import type { Thumbnail } from './pdfPreview'
import type { PageRange, SplitMode, SplitOutput } from './pdfSplitter'

export type WorkspaceMode = 'split' | 'merge'
export type ResultExportFormat = 'pdf' | 'jpeg' | 'png'

export interface WorkspaceIntro {
  title: string
  description: string
}

export interface PreviewGroup {
  index: number
  range: PageRange
  thumbnails: Thumbnail[]
}

export function getWorkspaceIntro(mode: WorkspaceMode): WorkspaceIntro {
  return mode === 'merge'
    ? {
        title: '合并 PDF，顺序清清楚楚',
        description: '添加多个文件，选取页面并调整顺序，生成一份新的 PDF。',
      }
    : {
        title: '拆分 PDF，清楚又利落',
        description: '选择一个文件，按固定页数、逐页或自定义范围生成新的 PDF。',
      }
}

export function getBulkDownloadLabel(
  format: ResultExportFormat,
  outputCount: number,
  outputPageCount: number,
): string {
  const formatLabel = format === 'pdf' ? 'PDF' : format === 'jpeg' ? 'JPG' : 'PNG'
  if (outputCount === 1) {
    if (format === 'pdf' || outputPageCount === 1) return `下载 ${formatLabel}`
    return `下载 ${formatLabel}（ZIP）`
  }
  return format === 'pdf'
    ? '下载全部 PDF（ZIP）'
    : `导出全部 ${formatLabel}（ZIP）`
}

export function shouldDownloadOutputDirectly(outputCount: number): boolean {
  return outputCount === 1
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
