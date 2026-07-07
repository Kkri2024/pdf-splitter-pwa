import { describe, expect, it, vi } from 'vitest'
import { copyPdfToClipboard, downloadPdf, sharePdf } from './download'
import type { SplitOutput } from './pdfSplitter'

const output: SplitOutput = {
  name: '资料_p001.pdf',
  bytes: new Uint8Array([1, 2, 3]),
  range: { start: 1, end: 1 },
  pageCount: 1,
}

class TestClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

describe('copyPdfToClipboard', () => {
  it('copies the PDF file when binary clipboard writing is supported', async () => {
    const clipboard = { write: vi.fn().mockResolvedValue(undefined) } as unknown as Clipboard
    await expect(copyPdfToClipboard(output, clipboard, TestClipboardItem as unknown as typeof ClipboardItem))
      .resolves.toBe('copied-file')
    expect(clipboard.write).toHaveBeenCalledOnce()
  })

  it('falls back to the file name when PDF MIME is rejected', async () => {
    const clipboard = {
      write: vi.fn().mockRejectedValue(new Error('unsupported MIME')),
      writeText: vi.fn().mockResolvedValue(undefined),
    } as unknown as Clipboard
    await expect(copyPdfToClipboard(output, clipboard, TestClipboardItem as unknown as typeof ClipboardItem))
      .resolves.toBe('copied-name')
    expect(clipboard.writeText).toHaveBeenCalledWith(output.name)
  })

  it('uses text fallback when ClipboardItem is unavailable', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) } as unknown as Clipboard
    await expect(copyPdfToClipboard(output, clipboard, undefined)).resolves.toBe('copied-name')
  })

  it('reports failure when both clipboard paths fail', async () => {
    const clipboard = {
      write: vi.fn().mockRejectedValue(new Error('blocked')),
      writeText: vi.fn().mockRejectedValue(new Error('blocked')),
    } as unknown as Clipboard
    await expect(copyPdfToClipboard(output, clipboard, TestClipboardItem as unknown as typeof ClipboardItem))
      .resolves.toBe('failed')
  })
})

describe('single PDF actions', () => {
  it('downloads one output directly', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    downloadPdf(output)

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it('shares a PDF through the system share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const canShare = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { share, canShare })

    await expect(sharePdf(output)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('reports a cancelled system share', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    vi.stubGlobal('navigator', { share, canShare: () => true })

    await expect(sharePdf(output)).resolves.toBe('cancelled')
    vi.unstubAllGlobals()
  })

  it('reports unsupported sharing without starting a download', async () => {
    vi.stubGlobal('navigator', {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await expect(sharePdf(output)).resolves.toBe('unsupported')
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
