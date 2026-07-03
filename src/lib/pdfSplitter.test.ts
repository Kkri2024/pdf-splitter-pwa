import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import {
  createSplitPlan,
  getPdfBaseName,
  makeOutputName,
  parseRangeSpec,
  PdfSplitError,
  splitPdf,
} from './pdfSplitter'

describe('parseRangeSpec', () => {
  it('parses ranges, single pages, spaces and Chinese separators', () => {
    expect(parseRangeSpec(' 1-3， 5、8～10 ', 10)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 8, end: 10 },
    ])
  })

  it.each([
    ['', '请输入页码范围'],
    ['1,,3', '存在空白段'],
    ['0-2', '必须从 1 开始'],
    ['5-2', '起始页不能大于结束页'],
    ['1-11', '超出文件总页数'],
    ['abc', '格式不正确'],
  ])('rejects invalid specification %s', (value, message) => {
    expect(() => parseRangeSpec(value, 10)).toThrow(message)
  })
})

describe('createSplitPlan', () => {
  it('creates fixed groups and keeps the final remainder', () => {
    expect(createSplitPlan('fixed', 12, { pagesPerFile: 5 })).toEqual([
      { start: 1, end: 5 },
      { start: 6, end: 10 },
      { start: 11, end: 12 },
    ])
  })

  it('creates one output per page', () => {
    expect(createSplitPlan('each', 3)).toEqual([
      { start: 1, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 3 },
    ])
  })

  it('uses custom page groups in entered order', () => {
    expect(createSplitPlan('custom', 8, { rangeSpec: '7-8,1,3-4' })).toEqual([
      { start: 7, end: 8 },
      { start: 1, end: 1 },
      { start: 3, end: 4 },
    ])
  })

  it('rejects non-positive or fractional fixed sizes', () => {
    expect(() => createSplitPlan('fixed', 5, { pagesPerFile: 0 })).toThrow(PdfSplitError)
    expect(() => createSplitPlan('fixed', 5, { pagesPerFile: 1.5 })).toThrow(PdfSplitError)
  })
})

describe('file naming', () => {
  it('removes a PDF extension without damaging Chinese names', () => {
    expect(getPdfBaseName('中文资料.PDF')).toBe('中文资料')
    expect(getPdfBaseName('.pdf')).toBe('PDF')
  })

  it('pads page numbers consistently', () => {
    expect(makeOutputName('报告', { start: 1, end: 1 }, 9)).toBe('报告_p001.pdf')
    expect(makeOutputName('报告', { start: 8, end: 10 }, 1200)).toBe('报告_p0008-p0010.pdf')
  })
})

describe('splitPdf', () => {
  async function makeSourcePdf(pageCount: number): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    for (let index = 0; index < pageCount; index += 1) {
      document.addPage([300 + index, 500 + index])
    }
    return document.save()
  }

  it('preserves page count, order and reports progress', async () => {
    const bytes = await makeSourcePdf(5)
    const progress = vi.fn()
    const outputs = await splitPdf(
      bytes,
      '很长的中文文件名称.pdf',
      [{ start: 2, end: 4 }, { start: 1, end: 1 }],
      progress,
    )

    expect(outputs.map((output) => output.name)).toEqual([
      '很长的中文文件名称_p002-p004.pdf',
      '很长的中文文件名称_p001.pdf',
    ])
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2)
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2)

    const first = await PDFDocument.load(outputs[0].bytes)
    expect(first.getPageCount()).toBe(3)
    expect(first.getPages().map((page) => page.getWidth())).toEqual([301, 302, 303])

    const second = await PDFDocument.load(outputs[1].bytes)
    expect(second.getPageCount()).toBe(1)
    expect(second.getPage(0).getWidth()).toBe(300)
  })

  it('rejects ranges outside the document', async () => {
    const bytes = await makeSourcePdf(2)
    await expect(splitPdf(bytes, 'test.pdf', [{ start: 1, end: 3 }])).rejects.toThrow('不匹配')
  })
})
