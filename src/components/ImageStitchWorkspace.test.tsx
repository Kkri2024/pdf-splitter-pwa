import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StitchImage } from '../lib/imageStitch'
const mocks = vi.hoisted(() => ({ import: vi.fn(), render: vi.fn(), blob: vi.fn() }))
vi.mock('../lib/imageStitch', async importOriginal => ({ ...await importOriginal<typeof import('../lib/imageStitch')>(), importStitchImage: mocks.import, renderStitchCanvas: mocks.render, canvasBlob: mocks.blob }))
import { ImageStitchWorkspace } from './ImageStitchWorkspace'
let root: Root, host: HTMLDivElement
const find = (label: string) => Array.from(host.querySelectorAll('button')).find(el => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === label)!
const click = async (label: string) => { expect(find(label)).toBeTruthy(); await act(async () => find(label).click()) }
async function upload(files = [new File(['a'], 'A.png', { type: 'image/png' })], replace = false) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${replace ? '选择替换图片' : '选择拼接图片'}"]`)!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
const names = () => Array.from(host.querySelectorAll('.stitch-image-select strong')).map(el => el.textContent)
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:result')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mocks.import.mockReset().mockImplementation(async (file: File): Promise<StitchImage> => ({ id: crypto.randomUUID(), name: file.name, url: `blob:${file.name}`, thumbnail: `blob:thumb-${file.name}`, bytes: file.size, width: 400, height: 600, rotation: 0, crop: { top: 0, bottom: 0, left: 0, right: 0 } }))
  mocks.render.mockReset().mockResolvedValue(undefined)
  mocks.blob.mockReset().mockResolvedValue(new Blob(['output'], { type: 'image/png' }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ImageStitchWorkspace active />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('keeps valid images in a mixed batch and reports failed file by name', async () => {
  mocks.import.mockRejectedValueOnce(new Error('损坏'))
  await upload([new File(['bad'], 'bad.png'), new File(['good'], 'good.png')])
  expect(names()).toEqual(['good.png'])
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('bad.png：损坏')
})
it('retains sequence and edit state when the workspace is hidden then shown', async () => {
  await upload([new File(['a'], 'A.png'), new File(['b'], 'B.png')]); await click('后移第 1 张图片'); await click('旋转 90°')
  await act(async () => root.render(<ImageStitchWorkspace active={false} />))
  await act(async () => root.render(<ImageStitchWorkspace active />))
  expect(names()).toEqual(['B.png', 'A.png'])
  expect(host.textContent).toContain('旋转 90°')
  await click('撤销图片编辑'); await click('撤销图片编辑'); expect(names()).toEqual(['A.png', 'B.png'])
  await click('重做图片编辑'); expect(names()).toEqual(['B.png', 'A.png'])
})
it('invalidates generated results on edits and undo restores original rotation', async () => {
  await upload(); await click('生成图片')
  expect(host.querySelector('.stitch-results')).not.toBeNull()
  await click('旋转 90°'); expect(host.querySelector('.stitch-results')).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result')
  await click('撤销图片编辑'); await click('生成图片')
  const exportCall = [...mocks.render.mock.calls].reverse().find(call => call[4] === 1)!
  expect(exportCall[1].placements[0].image.rotation).toBe(0)
})
it('preserves the old image after replacement fails and supports undoing successful replacement', async () => {
  await upload(); await click('替换第 1 张图片'); mocks.import.mockRejectedValueOnce(new Error('无法读取'))
  await upload([new File(['b'], 'bad.png')], true); expect(names()).toEqual(['A.png'])
  await click('替换第 1 张图片'); await upload([new File(['b'], 'B.png')], true); expect(names()).toEqual(['B.png'])
  await click('撤销图片编辑'); expect(names()).toEqual(['A.png'])
})
it('removal can be undone and clearing cancels cleanly or releases all source URLs', async () => {
  await upload(); await click('移除第 1 张图片'); expect(names()).toEqual([])
  await click('撤销图片编辑'); expect(names()).toEqual(['A.png'])
  vi.mocked(window.confirm).mockReturnValueOnce(false); await click('清空图片及撤销记录'); expect(names()).toEqual(['A.png'])
  await click('清空图片及撤销记录'); expect(names()).toEqual([])
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:A.png')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-A.png')
})
it('cancelling export preserves sources and discards partial results', async () => {
  await upload()
  mocks.render.mockImplementationOnce(async (_canvas, _layout, _settings, _region, _scale, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true })
  }))
  await click('生成图片'); await click('取消生成')
  expect(names()).toEqual(['A.png']); expect(host.querySelector('.stitch-results')).toBeNull()
  expect(host.textContent).toContain('已取消生成')
})
