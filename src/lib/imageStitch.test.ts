import { describe, expect, it } from 'vitest'
import { createExportRegions, createStitchLayout, DEFAULT_STITCH_SETTINGS, EMPTY_CROP, getCroppedSize, MAX_EXPORT_EDGE, MAX_EXPORT_PIXELS, stitchFileName, type StitchImage } from './imageStitch'
const image = (width: number, height: number, extra: Partial<StitchImage> = {}): StitchImage => ({ id: 'image', name: 'image.png', url: 'blob:image', thumbnail: 'blob:thumb', bytes: 1, width, height, rotation: 0, crop: { ...EMPTY_CROP }, ...extra })

describe('stitch layout and safe export', () => {
  it('retains complete portrait and landscape content with equal widths and exact margins', () => {
    const layout = createStitchLayout([image(600, 900), image(900, 600)], { ...DEFAULT_STITCH_SETTINGS, size: 600, gap: 12, padding: 20 })
    expect(layout.width).toBe(640)
    expect(layout.height).toBe(1352)
    expect(layout.placements.map(p => [p.x, p.y, p.width, p.height])).toEqual([[20, 20, 600, 900], [20, 932, 600, 400]])
  })
  it('applies crop in source coordinates before rotating and preserves horizontal proportions', () => {
    const cropped = image(1000, 500, { rotation: 90, crop: { top: 10, bottom: 10, left: 20, right: 0 } })
    expect(getCroppedSize(cropped)).toEqual({ width: 400, height: 800 })
    const layout = createStitchLayout([cropped, image(800, 400)], { ...DEFAULT_STITCH_SETTINGS, mode: 'horizontal', size: 400, gap: 10 })
    expect([layout.width, layout.height]).toEqual([1010, 400])
    expect(layout.placements[1].x).toBe(210)
  })
  it('keeps grid reading order and only allocates enough rows for the final incomplete row', () => {
    const layout = createStitchLayout(Array.from({ length: 5 }, (_, i) => image(300, 500, { id: `${i}` })), { ...DEFAULT_STITCH_SETTINGS, mode: 'grid', size: 620, columns: 3, gap: 10 })
    expect([layout.width, layout.height]).toEqual([620, 410])
    expect(layout.placements.map(p => [p.image.id, p.x, p.y])).toEqual([['0', 0, 0], ['1', 210, 0], ['2', 420, 0], ['3', 0, 210], ['4', 210, 210]])
  })
  it('segments tall output with no missing or duplicate rows and bounds every allocation', () => {
    const layout = { width: 2400, height: 21001, placements: [] }
    const regions = createExportRegions(layout, true)
    expect(regions.reduce((sum, r) => sum + r.height, 0)).toBe(21001)
    expect(regions[0].y).toBe(0)
    regions.forEach((r, i) => {
      expect(r.width * r.height).toBeLessThanOrEqual(MAX_EXPORT_PIXELS)
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_EXPORT_EDGE)
      if (i) expect(r.y).toBe(regions[i - 1].y + regions[i - 1].height)
    })
    expect(regions.at(-1)!.y + regions.at(-1)!.height).toBe(layout.height)
  })
  it('segments horizontal output without dropping the final column', () => {
    const regions = createExportRegions({ width: 17003, height: 800, placements: [] }, true)
    expect(regions.map(r => [r.x, r.width])).toEqual([[0, 8192], [8192, 8192], [16384, 619]])
  })
  it('requires explicit segmentation and rejects unreasonable total output before allocating', () => {
    expect(() => createExportRegions({ width: 1200, height: 20000, placements: [] }, false)).toThrow('开启分段')
    expect(() => createExportRegions({ width: 4096, height: 40000, placements: [] }, true)).toThrow('总图片尺寸过大')
    expect(() => createExportRegions({ width: 0, height: 0, placements: [] }, true)).toThrow('先添加')
  })
  it('rejects invalid geometry rather than generating stretched or empty content', () => {
    expect(() => createStitchLayout([image(200, 300)], { ...DEFAULT_STITCH_SETTINGS, size: NaN })).toThrow('请设置')
    expect(() => getCroppedSize(image(200, 300, { crop: { ...EMPTY_CROP, left: 100 } }))).toThrow('保留')
    expect(() => createStitchLayout([image(200, 300), image(200, 300)], { ...DEFAULT_STITCH_SETTINGS, mode: 'grid', size: 100, padding: 80 })).toThrow('间距和留白过大')
  })
  it('creates safe, deterministic segment names and a fallback for empty names', () => {
    expect(stitchFileName('报告/拼图.png', 'jpeg', 1, 3)).toBe('报告_拼图-02.jpg')
    expect(stitchFileName('  ', 'png', 0, 1)).toBe('拼接图片.png')
  })
})

describe('import validation before image decoding', () => {
  it('rejects unsupported formats and files with misleading extensions', async () => {
    const { importStitchImage } = await import('./imageStitch')
    const file = (name: string, type: string, data: number[]) => ({ name, type, size: data.length, arrayBuffer: async () => new Uint8Array(data).buffer }) as File
    await expect(importStitchImage(file('camera.heic', 'image/heic', [1, 2, 3]))).rejects.toThrow('HEIC')
    await expect(importStitchImage(file('renamed.png', 'image/png', [71, 73, 70, 56, 57, 97]))).rejects.toThrow('文件内容不是')
  })
  it('rejects APNG animations instead of silently discarding their other frames', async () => {
    const { importStitchImage } = await import('./imageStitch')
    const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    const file = { name: 'animated.png', type: 'image/png', size: data.length, arrayBuffer: async () => data.buffer } as File
    await expect(importStitchImage(file)).rejects.toThrow('动态图片暂不支持')
  })
})
