import { PDFDocument } from 'pdf-lib'
import type { EditablePage } from './pageEditor'

export type SplitMode = 'fixed' | 'each' | 'custom'

export interface PageRange {
  start: number
  end: number
}

export type OutputPageMeta = EditablePage & {
  sourceId?: string
  sourceName?: string
}

export interface CreateSplitPlanOptions {
  pagesPerFile?: number
  rangeSpec?: string
}

export interface SplitOutput {
  name: string
  bytes: Uint8Array
  range: PageRange
  pageCount: number
  pages?: OutputPageMeta[]
}

export class PdfSplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfSplitError'
  }
}

const normalizeRangeSpec = (value: string) =>
  value
    .replace(/[，、]/g, ',')
    .replace(/[—–~～]/g, '-')
    .replace(/\s+/g, '')

export function parseRangeSpec(input: string, totalPages: number): PageRange[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new PdfSplitError('PDF 没有可分割的页面')
  }

  const normalized = normalizeRangeSpec(input)
  if (!normalized) {
    throw new PdfSplitError('请输入页码范围')
  }

  const segments = normalized.split(',')
  if (segments.some((segment) => segment === '')) {
    throw new PdfSplitError('页码范围中存在空白段，请检查连续的逗号')
  }

  return segments.map((segment) => {
    if (!/^\d+(?:-\d+)?$/.test(segment)) {
      throw new PdfSplitError(`“${segment}”格式不正确，请使用 1-3,5,8-10`)
    }

    const [startText, endText = startText] = segment.split('-')
    const start = Number(startText)
    const end = Number(endText)

    if (start < 1 || end < 1) {
      throw new PdfSplitError('页码必须从 1 开始')
    }
    if (start > end) {
      throw new PdfSplitError(`“${segment}”起始页不能大于结束页`)
    }
    if (end > totalPages) {
      throw new PdfSplitError(`“${segment}”超出文件总页数 ${totalPages}`)
    }

    return { start, end }
  })
}

export function createSplitPlan(
  mode: SplitMode,
  totalPages: number,
  options: CreateSplitPlanOptions = {},
): PageRange[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new PdfSplitError('PDF 没有可分割的页面')
  }

  if (mode === 'custom') {
    return parseRangeSpec(options.rangeSpec ?? '', totalPages)
  }

  const pagesPerFile = mode === 'each' ? 1 : options.pagesPerFile
  if (!Number.isInteger(pagesPerFile) || (pagesPerFile ?? 0) < 1) {
    throw new PdfSplitError('每份页数必须是大于 0 的整数')
  }

  const ranges: PageRange[] = []
  for (let start = 1; start <= totalPages; start += pagesPerFile!) {
    ranges.push({ start, end: Math.min(start + pagesPerFile! - 1, totalPages) })
  }
  return ranges
}

export function getPdfBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.pdf$/i, '').trim()
  return withoutExtension || 'PDF'
}

export function makeOutputName(baseName: string, range: PageRange, totalPages: number): string {
  const width = Math.max(3, String(totalPages).length)
  const start = String(range.start).padStart(width, '0')
  const end = String(range.end).padStart(width, '0')
  return range.start === range.end
    ? `${baseName}_p${start}.pdf`
    : `${baseName}_p${start}-p${end}.pdf`
}

export async function splitPdf(
  sourceBytes: Uint8Array,
  sourceName: string,
  plan: PageRange[],
  onProgress?: (completed: number, total: number) => void,
): Promise<SplitOutput[]> {
  if (plan.length === 0) {
    throw new PdfSplitError('没有可执行的分割范围')
  }

  let source: PDFDocument
  try {
    source = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('encrypt')) {
      throw new PdfSplitError('暂不支持密码保护或加密的 PDF')
    }
    throw new PdfSplitError('无法读取此 PDF，文件可能已损坏')
  }

  const totalPages = source.getPageCount()
  const baseName = getPdfBaseName(sourceName)
  const outputs: SplitOutput[] = []

  try {
    for (let index = 0; index < plan.length; index += 1) {
      const range = plan[index]
      if (range.start < 1 || range.end > totalPages || range.start > range.end) {
        throw new PdfSplitError('分割范围与 PDF 页数不匹配')
      }

      const output = await PDFDocument.create()
      const pageIndexes = Array.from(
        { length: range.end - range.start + 1 },
        (_, pageIndex) => range.start - 1 + pageIndex,
      )
      const copiedPages = await output.copyPages(source, pageIndexes)
      copiedPages.forEach((page) => output.addPage(page))

      const bytes = await output.save({ useObjectStreams: true })
      outputs.push({
        name: makeOutputName(baseName, range, totalPages),
        bytes,
        range,
        pageCount: pageIndexes.length,
      })
      onProgress?.(index + 1, plan.length)
    }
  } catch (error) {
    outputs.length = 0
    if (error instanceof PdfSplitError) throw error
    throw new PdfSplitError('处理过程中内存不足或文件结构异常，请关闭其他应用后重试')
  }

  return outputs
}
