import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImageToolsWorkspace } from './ImageToolsWorkspace'
import type { ImageIntake } from '../lib/imageTools'
const mocks = vi.hoisted(() => ({ load: vi.fn(), convert: vi.fn() }))
vi.mock('../lib/imageStitch', async importOriginal => ({ ...await importOriginal<typeof import('../lib/imageStitch')>(), importStitchImage: mocks.load }))
vi.mock('../lib/imageTools', async importOriginal => ({ ...await importOriginal<typeof import('../lib/imageTools')>(), convertToolImage: mocks.convert, drawToolImage: vi.fn(async () => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200; return canvas }) }))
let host: HTMLDivElement, root: Root
const callbacks = { onConsumed: vi.fn(), onBusyChange: vi.fn(), onContinue: vi.fn(), onPdfContinue: vi.fn() }
const file = (name: string) => new File(['data'], name, { type: 'image/png' })
const render = async (intake?: ImageIntake) => { await act(async () => root.render(<StrictMode><ImageToolsWorkspace active tool="image-convert" intake={intake} {...callbacks} /></StrictMode>)) }
const click = async (label: string) => { const button = [...host.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label)!; expect(button).toBeTruthy(); await act(async () => button.click()) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:result'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  Object.values(callbacks).forEach(callback => callback.mockReset())
  mocks.load.mockReset().mockImplementation(async (file: File) => ({ id: file.name, name: file.name, url: `blob:${file.name}`, thumbnail: `blob:thumb-${file.name}`, width: 300, height: 200, bytes: 4, rotation: 0, crop: { top: 0, bottom: 0, left: 0, right: 0 } }))
  mocks.convert.mockReset().mockImplementation(async (image: {name: string}) => ({ name: image.name.replace('.png', '.jpg'), blob: new Blob(['result'], { type: 'image/jpeg' }), width: 300, height: 200, originalBytes: 4 }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('consumes each handoff once in StrictMode and appends a new handoff without replacing existing images', async () => {
  const first = { id: 'first', files: [file('one.png')] }
  await render(first); await render(first)
  expect(mocks.load).toHaveBeenCalledTimes(1)
  expect(callbacks.onConsumed).toHaveBeenCalledTimes(1)
  await render({ id: 'second', files: [file('two.png')] })
  expect([...host.querySelectorAll('.tool-image-row strong')].map(el => el.textContent)).toEqual(['one.png', 'two.png'])
  await click('处理图片'); await click('转为 PDF')
  const [destination, files] = callbacks.onContinue.mock.calls[0]
  expect(destination).toBe('image-pdf')
  expect(files.map((file: File) => [file.name, file.type])).toEqual([['001-one.jpg', 'image/jpeg'], ['002-two.jpg', 'image/jpeg']])
  expect(host.querySelectorAll('.tool-image-row')).toHaveLength(2)
  const select = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => { select.value = 'png'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.querySelectorAll('.stitch-result')).toHaveLength(0)
})
it('keeps valid images from a partially invalid handoff and reports the rejected filename', async () => {
  mocks.load.mockRejectedValueOnce(new Error('损坏')).mockResolvedValueOnce({ id: 'good', name: 'good.png', url: 'blob:good', thumbnail: 'blob:thumb', width: 300, height: 200, bytes: 4, rotation: 0, crop: { top: 0, bottom: 0, left: 0, right: 0 } })
  await render({ id: 'batch', files: [file('bad.png'), file('good.png')] })
  expect(host.textContent).toContain('bad.png：损坏')
  expect(host.querySelectorAll('.tool-image-row')).toHaveLength(1)
  expect(host.textContent).toContain('good.png')
})
