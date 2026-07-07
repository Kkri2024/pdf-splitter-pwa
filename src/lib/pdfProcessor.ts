import { degrees, PDFDocument } from 'pdf-lib'
import type { OutputJob } from './pageEditor'
import type { SplitOutput } from './pdfSplitter'

export async function executePdfJobs(
  sourceBytes: Uint8Array,
  jobs: OutputJob[],
  onProgress?: (completed: number, total: number) => void,
): Promise<SplitOutput[]> {
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const outputs: SplitOutput[] = []
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]
    const output = await PDFDocument.create()
    const copiedPages = await output.copyPages(source, job.pages.map((page) => page.sourcePageIndex))
    copiedPages.forEach((page, pageIndex) => {
      const current = page.getRotation().angle
      page.setRotation(degrees((current + job.pages[pageIndex].rotation) % 360))
      output.addPage(page)
    })
    const bytes = await output.save({ useObjectStreams: true })
    outputs.push({
      name: job.name,
      bytes,
      range: job.range ?? { start: 1, end: job.pages.length },
      pageCount: job.pages.length,
      pages: job.pages,
    })
    onProgress?.(index + 1, jobs.length)
  }
  return outputs
}
