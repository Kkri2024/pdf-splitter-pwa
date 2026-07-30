import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}))

import { loadPdfForPreview } from './pdfPreview'

describe('PDF preview loading', () => {
  beforeEach(() => {
    getDocumentMock.mockReset()
  })

  it('loads PDFs with local CMaps, standard fonts and system font fallback', async () => {
    const document = { numPages: 3, destroy: vi.fn() }
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(document) })

    const bytes = new Uint8Array([1, 2, 3])
    const loaded = await loadPdfForPreview(bytes)
    const options = getDocumentMock.mock.calls[0][0]

    expect(loaded).toEqual({ document, pageCount: 3 })
    expect(options.data).toEqual(bytes)
    expect(options.data).not.toBe(bytes)
    expect(options.cMapUrl).toMatch(/\/pdfjs\/cmaps\/$/)
    expect(options.cMapPacked).toBe(true)
    expect(options.standardFontDataUrl).toMatch(/\/pdfjs\/standard_fonts\/$/)
    expect(options.useSystemFonts).toBe(true)
  })

  it('reports missing preview resources separately from damaged PDFs', async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.reject(new Error('Unable to load binary CMap at: /pdfjs/cmaps/Adobe-GB1.bcmap')),
    })

    await expect(loadPdfForPreview(new Uint8Array([1])))
      .rejects.toThrow('预览字体资源加载失败，请刷新后重试')
  })

  it('keeps password-protected PDF errors specific', async () => {
    const error = new Error('Password required')
    error.name = 'PasswordException'
    getDocumentMock.mockReturnValue({ promise: Promise.reject(error) })

    await expect(loadPdfForPreview(new Uint8Array([1])))
      .rejects.toThrow('暂不支持密码保护或加密的 PDF')
  })
})
