import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { executePdfJobs } from './pdfProcessor'
import type { OutputJob } from './pageEditor'

describe('executePdfJobs', () => {
  it('preserves requested order, removes omitted pages and applies rotation', async () => {
    const source = await PDFDocument.create()
    source.addPage([100, 200])
    source.addPage([200, 300]).setRotation(degrees(90))
    source.addPage([300, 400])
    const bytes = await source.save()
    const jobs: OutputJob[] = [{
      name: 'edited.pdf',
      pages: [
        { id: 'page-3', sourcePageIndex: 2, rotation: 90 },
        { id: 'page-1', sourcePageIndex: 0, rotation: 0 },
      ],
    }]

    const [result] = await executePdfJobs(bytes, jobs)
    const output = await PDFDocument.load(result.bytes)
    expect(output.getPageCount()).toBe(2)
    expect(output.getPage(0).getSize()).toEqual({ width: 300, height: 400 })
    expect(output.getPage(0).getRotation().angle).toBe(90)
    expect(output.getPage(1).getSize()).toEqual({ width: 100, height: 200 })
  })
})
