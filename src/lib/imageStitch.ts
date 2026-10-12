/** Geometry is shared by preview and export. Crops use the original image coordinates. */
export interface ImageCrop { top: number; right: number; bottom: number; left: number }
export interface StitchImage {
  id: string; name: string; url: string; thumbnail: string; width: number; height: number
  bytes: number; rotation: 0 | 90 | 180 | 270; crop: ImageCrop
}
export interface StitchSettings {
  mode: 'vertical' | 'horizontal' | 'grid'; size: number; columns: number
  gap: number; padding: number; background: string; fit: 'contain' | 'cover'
}
export interface ImagePlacement { image: StitchImage; x: number; y: number; width: number; height: number }
export interface StitchLayout { width: number; height: number; placements: ImagePlacement[] }
export interface ImageRegion { x: number; y: number; width: number; height: number }
export const EMPTY_CROP: ImageCrop = { top: 0, right: 0, bottom: 0, left: 0 }
export const DEFAULT_STITCH_SETTINGS: StitchSettings = {
  mode: 'vertical', size: 1200, columns: 2, gap: 0, padding: 0, background: '#ffffff', fit: 'contain',
}
export const MAX_EXPORT_PIXELS = 16_000_000
export const MAX_EXPORT_EDGE = 8192
export const MAX_TOTAL_PIXELS = 120_000_000
export const MAX_IMPORT_BYTES = 120 * 1024 * 1024

export function getCroppedSize(image: StitchImage) {
  const { crop, width, height } = image
  const w = width * (1 - (crop.left + crop.right) / 100)
  const h = height * (1 - (crop.top + crop.bottom) / 100)
  if (w <= 0 || h <= 0) throw new Error('裁剪后需要保留部分图片内容')
  return image.rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w }
}

export function createStitchLayout(images: StitchImage[], settings: StitchSettings): StitchLayout {
  const { mode, size, gap, padding, columns } = settings
  if (!Number.isFinite(size) || size < 100 || size > 4096 || !Number.isFinite(gap) || gap < 0 || gap > 100
    || !Number.isFinite(padding) || padding < 0 || padding > 100 || !Number.isInteger(columns) || columns < 2 || columns > 4) {
    throw new Error('请设置 100～4096 像素的尺寸、0～100 像素的间距和留白')
  }
  if (images.length === 0) return { width: 0, height: 0, placements: [] }
  let cursor = padding
  const count = Math.min(columns, images.length)
  const cell = (size - padding * 2 - gap * (count - 1)) / count
  if (mode === 'grid' && cell < 1) throw new Error('间距和留白过大，请增加输出宽度或减少间距')
  const placements = images.map((image, index) => {
    const intrinsic = getCroppedSize(image)
    if (mode === 'grid') return {
      image, x: padding + (index % count) * (cell + gap), y: padding + Math.floor(index / count) * (cell + gap), width: cell, height: cell,
    }
    const width = mode === 'vertical' ? size : intrinsic.width * size / intrinsic.height
    const height = mode === 'horizontal' ? size : intrinsic.height * size / intrinsic.width
    const result = { image, x: mode === 'vertical' ? padding : cursor, y: mode === 'vertical' ? cursor : padding, width, height }
    cursor += (mode === 'vertical' ? height : width) + gap
    return result
  })
  const width = mode === 'horizontal' ? cursor - gap + padding : mode === 'grid' ? size : size + padding * 2
  const height = mode === 'vertical' ? cursor - gap + padding : mode === 'grid' ? padding * 2 + Math.ceil(images.length / count) * (cell + gap) - gap : size + padding * 2
  return { width: Math.ceil(width), height: Math.ceil(height), placements }
}

/** Split along the reading direction, with no lost pixels at segment boundaries. */
export function createExportRegions(layout: StitchLayout, segmented: boolean): ImageRegion[] {
  const { width, height } = layout
  if (width < 1 || height < 1) throw new Error('请先添加图片')
  if (width * height > MAX_TOTAL_PIXELS) throw new Error('总图片尺寸过大，请降低输出尺寸或减少图片后重试')
  const oversized = width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE || width * height > MAX_EXPORT_PIXELS
  if (oversized && !segmented) throw new Error('长图尺寸超过单张导出限制，请降低尺寸或开启分段导出')
  const tileWidth = Math.min(width, MAX_EXPORT_EDGE)
  const tileHeight = Math.min(height, MAX_EXPORT_EDGE, Math.floor(MAX_EXPORT_PIXELS / tileWidth))
  const regions: ImageRegion[] = []
  for (let y = 0; y < height; y += tileHeight) {
    for (let x = 0; x < width; x += tileWidth) {
      regions.push({ x, y, width: Math.min(tileWidth, width - x), height: Math.min(tileHeight, height - y) })
    }
  }
  return regions
}

export async function loadStitchImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  return new Promise((resolve, reject) => {
    const image = new Image()
    const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); image.src = ''; reject(new DOMException('已取消', 'AbortError')) }
    image.onload = () => { cleanup(); resolve(image) }
    image.onerror = () => { cleanup(); reject(new Error('图片无法读取，请使用有效的 JPG、PNG 或 WebP 文件')) }
    signal?.addEventListener('abort', abort, { once: true })
    image.src = url
  })
}

export function canvasBlob(canvas: HTMLCanvasElement, format: 'png' | 'jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请降低尺寸或开启分段导出后重试')), `image/${format}`, quality))
}

export async function importStitchImage(file: File, signal?: AbortSignal): Promise<StitchImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('请使用 JPG、PNG 或 WebP 图片；HEIC 和动态图片暂不支持')
  if (file.size > 25 * 1024 * 1024) throw new Error('单张图片超过 25 MB，请压缩后再添加')
  // Validate container signatures and inspect actual chunks, not compressed pixel bytes.
  const header = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(header.buffer)
  const tag = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4))
  const png = header.length >= 8 && header[0] === 137 && tag(1) === 'PNG\r'
  const jpeg = header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255
  const webp = header.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('文件内容不是 JPG、PNG 或 WebP 图片，请转换格式后再添加')
  for (let offset = png ? 8 : 12; (png || webp) && offset + 8 <= header.length;) {
    const type = tag(offset + (png ? 4 : 0))
    if (type === 'acTL' || type === 'ANIM' || type === 'ANMF') throw new Error('动态图片暂不支持，请先导出为静态图片')
    const length = view.getUint32(offset + (png ? 0 : 4), !png)
    offset += png ? length + 12 : length + 8 + length % 2
  }
  const url = URL.createObjectURL(file)
  const canvas = document.createElement('canvas')
  let image: HTMLImageElement | undefined
  try {
    image = await loadStitchImage(url, signal)
    const width = image.naturalWidth, height = image.naturalHeight
    if (!width || !height || width * height > 40_000_000) throw new Error('单张图片超过 4000 万像素，请缩小后再添加')
    const scale = Math.min(1, 240 / Math.max(width, height))
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await canvasBlob(canvas, 'png')
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    return { id: crypto.randomUUID(), name: file.name, url, thumbnail: URL.createObjectURL(blob), width, height, bytes: file.size, rotation: 0, crop: { ...EMPTY_CROP } }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  } finally { if (image) image.src = ''; canvas.width = 0; canvas.height = 0 }
}

export async function renderStitchCanvas(
  canvas: HTMLCanvasElement, layout: StitchLayout, settings: StitchSettings,
  region: ImageRegion, scale = 1, signal?: AbortSignal,
) {
  canvas.width = Math.max(1, Math.round(region.width * scale))
  canvas.height = Math.max(1, Math.round(region.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法生成图片')
  context.fillStyle = settings.background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.scale(scale, scale)
  context.translate(-region.x, -region.y)
  for (const placement of layout.placements) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const { image, x, y, width, height } = placement
    if (x + width <= region.x || y + height <= region.y || x >= region.x + region.width || y >= region.y + region.height) continue
    const source = await loadStitchImage(image.url, signal)
    try {
      const intrinsic = getCroppedSize(image)
      const ratio = settings.mode === 'grid' && settings.fit === 'cover'
        ? Math.max(width / intrinsic.width, height / intrinsic.height)
        : Math.min(width / intrinsic.width, height / intrinsic.height)
      const sw = image.width * (1 - (image.crop.left + image.crop.right) / 100)
      const sh = image.height * (1 - (image.crop.top + image.crop.bottom) / 100)
      context.save()
      context.beginPath(); context.rect(x, y, width, height); context.clip()
      context.translate(x + width / 2, y + height / 2)
      context.rotate(image.rotation * Math.PI / 180)
      context.drawImage(source, image.width * image.crop.left / 100, image.height * image.crop.top / 100, sw, sh, -sw * ratio / 2, -sh * ratio / 2, sw * ratio, sh * ratio)
      context.restore()
    } finally { source.src = '' }
  }
}

export function stitchFileName(name: string, format: 'png' | 'jpeg', index: number, count: number) {
  const base = name.replace(/\.(png|jpe?g|zip)$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '拼接图片'
  return `${base}${count > 1 ? `-${String(index + 1).padStart(2, '0')}` : ''}.${format === 'jpeg' ? 'jpg' : 'png'}`
}
