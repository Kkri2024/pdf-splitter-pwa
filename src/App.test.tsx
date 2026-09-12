import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { PageEditorGrid } from './components/PageEditorGrid'
const mocks = vi.hoisted(() => ({ load: vi.fn(), split: vi.fn(), merge: vi.fn() }))
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() }) }))
vi.mock('./lib/pdfPreview', () => ({ loadPdfForPreview: mocks.load, renderPagePreview: vi.fn().mockResolvedValue({ url: 'blob:preview' }), renderThumbnail: vi.fn() }))
vi.mock('./lib/pdfWorkerClient', () => ({ processPdfJobsInWorker: mocks.split, processMergeJobInWorker: mocks.merge }))
vi.mock('./components/PageEditorGrid', () => ({ PageEditorGrid: (props: Parameters<typeof PageEditorGrid>[0]) => <div>{props.pages.map(page => <div key={page.id}><button disabled={props.disabled} aria-label={`预览 ${page.id}`} onClick={() => props.onOpen(page.id)}>预览</button>{props.showSelection && <button disabled={props.disabled} aria-label={`选择 ${page.id}`} onClick={() => props.onToggle(page.id)} aria-pressed={props.selectedIds.includes(page.id)}>选择</button>}</div>)}</div> }))
import App from './App'
let root: Root, host: HTMLDivElement
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(el => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === name)!
const click = async (name: string) => { expect(button(name), name).toBeTruthy(); await act(async () => button(name).click()) }
const file = (name: string) => ({ name, size: 50, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(4) }) as File
async function upload(merge = false, files = [file('A.pdf')]) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${merge ? '选择多个 PDF 文件' : '选择 PDF 文件'}"]`)!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
const fillRange = async (value: string) => {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="例如：1-3,5,8-10"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  mocks.load.mockReset().mockImplementation(async () => ({ document: { destroy: vi.fn() }, pageCount: 8 }))
  mocks.split.mockReset().mockReturnValue({ cancel: vi.fn(), promise: Promise.resolve([{ name: 'output.pdf', bytes: new Uint8Array(8), pageCount: 8 }]) })
  mocks.merge.mockReset().mockReturnValue({ cancel: vi.fn(), promise: Promise.resolve([{ name: 'merged.pdf', bytes: new Uint8Array(8), pageCount: 16 }]) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<App />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('isolates split replacement/removal from merge documents and its selected queue', async () => {
  const mergeDoc = { destroy: vi.fn() }
  await click('合并'); mocks.load.mockResolvedValueOnce({ document: mergeDoc, pageCount: 8 }); await upload(true)
  await click('分割'); await upload(); await upload(false, [file('replacement.pdf')]); await click('移除')
  expect(mergeDoc.destroy).not.toHaveBeenCalled()
  await click('合并'); expect(host.textContent).toContain('已选 8 页')
  await click('生成合并 PDF · 8 页'); expect(mocks.merge.mock.calls[0][1].pages).toHaveLength(8)
})
it('keeps valid batch files and defaults to selecting every page', async () => {
  await click('合并')
  mocks.load.mockRejectedValueOnce(new Error('损坏')).mockResolvedValueOnce({ document: { destroy: vi.fn() }, pageCount: 8 })
  await upload(true, [file('bad.pdf'), file('good.pdf')])
  expect(host.textContent).toContain('bad.pdf：损坏'); expect(host.textContent).toContain('已选 8 页')
  await upload(true, [file('second.pdf')]); expect(host.textContent).toContain('已选 16 页')
  await click('生成合并 PDF · 16 页')
  expect(mocks.merge.mock.calls[0][1].pages.map((p: {sourceName: string}) => p.sourceName)).toEqual([...Array(8).fill('good.pdf'), ...Array(8).fill('second.pdf')])
})
it('preserves the split file and edited state after replacement fails or is cancelled', async () => {
  await upload(); await click('编辑页面'); await click('选择 page-1'); await click('所选页面向右旋转')
  vi.mocked(window.confirm).mockReturnValueOnce(false); await upload(false, [file('cancelled.pdf')]); expect(mocks.load).toHaveBeenCalledTimes(1)
  mocks.load.mockRejectedValueOnce(new Error('损坏')); await upload(false, [file('bad.pdf')]); expect(host.textContent).toContain('A.pdf')
  await click('导出编辑后的完整 PDF'); expect(mocks.split.mock.calls[0][1][0].pages[0].rotation).toBe(90)
})
it('keeps custom ranges and their order/overlap independent from editor selection', async () => {
  await upload(); await click('自定义'); await fillRange('5-6,1-3,3')
  await click('编辑页面'); await click('选择 page-2'); await click('所选页面向右旋转'); await click('完成编辑')
  expect(host.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('5-6,1-3,3')
  await click('开始分割 · 3 份')
  expect(mocks.split.mock.calls[0][1].map((job: {pages: {sourcePageIndex: number}[]}) => job.pages.map(p => p.sourcePageIndex))).toEqual([[4,5],[0,1,2],[2]])
})
it('blocks out-of-bounds ranges after deletion and undo restores validity', async () => {
  await upload(); await click('自定义'); await fillRange('8'); await click('编辑页面'); await click('选择 page-1'); await click('删除所选页面')
  expect(button('开始分割 · 0 份').disabled).toBe(true)
  await click('撤销页面编辑'); expect(button('开始分割 · 1 份').disabled).toBe(false)
})
it('retains merge results when clearing the split workspace and vice versa', async () => {
  await upload(); await click('开始分割 · 2 份'); await click('合并'); await upload(true); await click('生成合并 PDF · 8 页')
  await click('处理另一组合并'); await click('分割'); expect(host.textContent).toContain('output.pdf')
})
it('opens the source panel and restores background interaction on Escape', async () => {
  await click('合并'); await upload(true); await click('选择页面')
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toContain('选择页面')
  expect(document.body.style.overflow).toBe('hidden')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.style.overflow).toBe('')
})
it('returns from nested preview to its thumbnail, then to the original source trigger', async () => {
  await click('合并'); await upload(true)
  const opener = button('选择页面'); opener.focus(); await click('选择页面')
  const thumb = host.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label^="预览 "]')!
  thumb.focus(); await act(async () => thumb.click())
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭高清预览')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  expect(document.activeElement).toBe(thumb)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.activeElement).toBe(opener)
})

it('unmounts the mobile ordering grid when its panel closes before generation', async () => {
  await act(async () => root.unmount())
  vi.stubGlobal('innerWidth', 390)
  root = createRoot(host)
  await act(async () => root.render(<App />))
  await click('合并'); await upload(true)
  const panel = host.querySelector('#merge-order-panel')!
  expect(panel.querySelector('[aria-label^="预览 "]')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-controls="merge-order-panel"]')!.click())
  expect(panel.querySelector('[aria-label^="预览 "]')).not.toBeNull()
  await click('生成合并 PDF · 8 页')
  expect(panel.querySelector('[aria-label^="预览 "]')).toBeNull()
  expect(host.textContent).toContain('merged.pdf')
})
