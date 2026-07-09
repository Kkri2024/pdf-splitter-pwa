import { degrees, PDFDocument } from 'pdf-lib'
import { PdfSplitError, type SplitOutput, type OutputPageMeta } from './pdfSplitter'
import type { PageRotation } from './pageEditor'

export interface MergeSourceDocument {
  id: string
  name: string
  bytes: Uint8Array
}

export interface MergePage extends OutputPageMeta {
  sourceId: string
  sourceName: string
  sourcePageIndex: number
  rotation: PageRotation
}

export interface MergeJob {
  name: string
  pages: MergePage[]
}

export async function executeMergeJob(
  sources: MergeSourceDocument[],
  job: MergeJob,
  onProgress?: (completed: number, total: number) => void,
): Promise<SplitOutput[]> {
  if (sources.length === 0) throw new PdfSplitError('请先添加 PDF 文件')
  if (job.pages.length === 0) throw new PdfSplitError('请至少选择一页用于合并')

  const loadedSources = new Map<string, PDFDocument>()
  try {
    for (const source of sources) {
      loadedSources.set(source.id, await PDFDocument.load(source.bytes, { updateMetadata: false }))
    }

    const output = await PDFDocument.create()
    for (let index = 0; index < job.pages.length; index += 1) {
      const page = job.pages[index]
      const source = loadedSources.get(page.sourceId)
      if (!source) throw new PdfSplitError(`找不到来源文件：${page.sourceName}`)
      if (page.sourcePageIndex < 0 || page.sourcePageIndex >= source.getPageCount()) {
        throw new PdfSplitError(`“${page.sourceName}”的页面范围不匹配`)
      }

      const [copiedPage] = await output.copyPages(source, [page.sourcePageIndex])
      const current = copiedPage.getRotation().angle
      copiedPage.setRotation(degrees((current + page.rotation) % 360))
      output.addPage(copiedPage)
      onProgress?.(index + 1, job.pages.length)
    }

    const bytes = await output.save({ useObjectStreams: true })
    return [{
      name: job.name,
      bytes,
      range: { start: 1, end: job.pages.length },
      pageCount: job.pages.length,
      pages: job.pages,
    }]
  } catch (error) {
    if (error instanceof PdfSplitError) throw error
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('encrypt')) {
      throw new PdfSplitError('暂不支持密码保护或加密的 PDF')
    }
    throw new PdfSplitError('合并过程中内存不足或文件结构异常，请减少页数后重试')
  }
}
