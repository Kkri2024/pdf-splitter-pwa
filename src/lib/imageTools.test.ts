import { describe, expect, it, vi, afterEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { fitImageSize, imagePdfLayout, imagesToPdf, convertToolImage, type PdfImageSettings } from './imageTools'
import type { StitchImage } from './imageStitch'
vi.mock('./imageStitch', async importOriginal => ({ ...await importOriginal<typeof import('./imageStitch')>(), loadStitchImage: vi.fn(async () => ({ src: '', naturalWidth: 800, naturalHeight: 1200 })) }))
const settings: PdfImageSettings = { paper: 'a4', orientation: 'portrait', margin: 10, encoding: 'png' }
const image: StitchImage = { id: 'one', name: 'test.png', width: 800, height: 1200, url: 'blob:one', thumbnail: 'blob:thumb', bytes: 1000, rotation: 0, crop: { top: 0, bottom: 0, left: 0, right: 0 } }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('image tool output geometry', () => {
  it('keeps small images unchanged and bounds large images without changing aspect ratio', () => {
    expect(fitImageSize(400, 200, 2400)).toEqual({ width: 400, height: 200 })
    expect(fitImageSize(12000, 6000, 2400)).toEqual({ width: 2400, height: 1200 })
    const size = fitImageSize(8000, 8000, 8192)
    expect(size.width * size.height).toBeLessThanOrEqual(16000000)
    expect(() => fitImageSize(10, 10, NaN)).toThrow()
  })
  it('centers the complete image within A4 margins and switches page orientation', () => {
    const layout = imagePdfLayout(1200, 800, settings)
    expect(layout.width / layout.height).toBeCloseTo(1.5)
    expect(layout.x).toBeCloseTo(10 * 72 / 25.4)
    expect(layout.y).toBeGreaterThan(10 * 72 / 25.4)
    const landscape = imagePdfLayout(1200, 800, { ...settings, orientation: 'landscape' })
    expect(landscape.pageWidth).toBeGreaterThan(landscape.pageHeight)
  })
  it('uses original image size with physical margins and rejects excessively long pages', () => {
    const layout = imagePdfLayout(800, 1200, { ...settings, paper: 'original', margin: 0 })
    expect([layout.pageWidth, layout.pageHeight]).toEqual([600, 900])
    expect(() => imagePdfLayout(1000, 20000, { ...settings, paper: 'original' })).toThrow('过长')
  })
})
function mockCanvas() {
  if (!Blob.prototype.arrayBuffer) Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: async () => new ArrayBuffer(0) })
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer).buffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this) })
  })
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([png], { type: 'image/png' })))
}
it('generates a readable two-page PDF in input order, with rotation changing original page dimensions', async () => {
  mockCanvas()
  const progress = vi.fn()
  const blob = await imagesToPdf([image, { ...image, id: 'two', rotation: 90 }], { ...settings, paper: 'original', margin: 0 }, progress)
  const pdf = await PDFDocument.load(await blob.arrayBuffer())
  expect(pdf.getPageCount()).toBe(2)
  expect(pdf.getPages().map(page => page.getSize())).toEqual([{ width: 600, height: 900 }, { width: 900, height: 600 }])
  expect(progress.mock.calls.map(call => call[0])).toEqual([1, 2])
  expect(blob.type).toBe('application/pdf')
})
it('rejects cancellation and unsupported browser encodings instead of mislabeling PNG as WebP', async () => {
  mockCanvas()
  const controller = new AbortController(); controller.abort()
  await expect(imagesToPdf([image], settings, undefined, controller.signal)).rejects.toThrow('已取消')
  await expect(convertToolImage(image, { format: 'webp', quality: 0.85, maxEdge: 2400 })).rejects.toThrow('不支持')
})
