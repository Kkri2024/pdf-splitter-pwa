import { describe, expect, it, vi } from 'vitest'
import { copyPdfToClipboard } from './download'
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
