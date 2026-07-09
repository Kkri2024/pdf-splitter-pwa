import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { executePdfJobs } from './pdfProcessor'
import { executeMergeJob, type MergeSourceDocument } from './pdfMerger'
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

describe('executeMergeJob', () => {
  async function makeSource(name: string, sizes: Array<[number, number]>): Promise<MergeSourceDocument> {
    const document = await PDFDocument.create()
    sizes.forEach((size) => document.addPage(size))
    return { id: name, name: `${name}.pdf`, bytes: await document.save() }
  }

  it('merges pages from multiple PDFs in requested order', async () => {
    const first = await makeSource('first', [[100, 200], [110, 210]])
    const second = await makeSource('second', [[300, 400], [310, 410]])

    const [result] = await executeMergeJob([first, second], {
      name: 'merged_selected.pdf',
      pages: [
        { id: 'second-2', sourceId: second.id, sourceName: second.name, sourcePageIndex: 1, rotation: 0 },
        { id: 'first-1', sourceId: first.id, sourceName: first.name, sourcePageIndex: 0, rotation: 0 },
        { id: 'second-1', sourceId: second.id, sourceName: second.name, sourcePageIndex: 0, rotation: 0 },
      ],
    })

    const output = await PDFDocument.load(result.bytes)
    expect(output.getPages().map((page) => page.getSize())).toEqual([
      { width: 310, height: 410 },
      { width: 100, height: 200 },
      { width: 300, height: 400 },
    ])
    expect(result.pageCount).toBe(3)
    expect(result.pages?.map((page) => page.id)).toEqual(['second-2', 'first-1', 'second-1'])
  })

  it('applies selected page rotation while merging', async () => {
    const source = await makeSource('source', [[100, 200]])
    const [result] = await executeMergeJob([source], {
      name: 'rotated.pdf',
      pages: [{ id: 'source-1', sourceId: source.id, sourceName: source.name, sourcePageIndex: 0, rotation: 90 }],
    })

    const output = await PDFDocument.load(result.bytes)
    expect(output.getPage(0).getRotation().angle).toBe(90)
  })

  it('requires at least one selected page', async () => {
    const source = await makeSource('source', [[100, 200]])
    await expect(executeMergeJob([source], { name: 'empty.pdf', pages: [] })).rejects.toThrow('请至少选择一页')
  })
})
