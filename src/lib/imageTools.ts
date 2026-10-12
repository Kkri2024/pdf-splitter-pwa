import { PDFDocument } from 'pdf-lib'
import { getCroppedSize, loadStitchImage, MAX_EXPORT_EDGE, MAX_EXPORT_PIXELS, type StitchImage } from './imageStitch'

export type ImageTool = 'image-pdf' | 'image-convert'
export type ImageDestination = ImageTool | 'stitch'
export interface ImageIntake { id: string; files: File[] }
export interface PdfImageSettings { paper: 'a4' | 'original'; orientation: 'portrait' | 'landscape'; margin: number; encoding: 'png' | 'jpeg' }
export interface ConvertSettings { format: 'png' | 'jpeg' | 'webp'; maxEdge: number; quality: number }
export interface ToolResult { name: string; blob: Blob; width?: number; height?: number; originalBytes?: number }

export function fitImageSize(width: number, height: number, maxEdge: number) {
  if (![width, height, maxEdge].every(Number.isFinite) || width <= 0 || height <= 0 || maxEdge < 1 || maxEdge > MAX_EXPORT_EDGE) throw new Error('图片尺寸无效，请设置 1～8192 像素的最长边')
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(MAX_EXPORT_PIXELS / (width * height)))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

export function imagePdfLayout(width: number, height: number, settings: PdfImageSettings) {
  if (![width, height, settings.margin].every(Number.isFinite) || width <= 0 || height <= 0 || settings.margin < 0 || settings.margin > 30) throw new Error('页面尺寸或边距无效')
  const margin = settings.margin * 72 / 25.4
  const a4 = settings.orientation === 'portrait' ? [595.28, 841.89] : [841.89, 595.28]
  const pageWidth = settings.paper === 'a4' ? a4[0] : width * 0.75 + margin * 2
  const pageHeight = settings.paper === 'a4' ? a4[1] : height * 0.75 + margin * 2
  if (pageWidth > 14400 || pageHeight > 14400) throw new Error('原图页面过长，请使用 A4 纸张或先将长图分段')
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height)
  return { pageWidth, pageHeight, width: width * scale, height: height * scale, x: (pageWidth - width * scale) / 2, y: (pageHeight - height * scale) / 2 }
}

export async function drawToolImage(image: StitchImage, maxEdge: number, white: boolean, signal?: AbortSignal) {
  const size = getCroppedSize(image)
  const fitted = fitImageSize(size.width, size.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = fitted.width; canvas.height = fitted.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理图片')
  const source = await loadStitchImage(image.url, signal)
  try {
    if (white) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.translate(canvas.width / 2, canvas.height / 2)
    context.scale(canvas.width / size.width, canvas.height / size.height)
    context.rotate(image.rotation * Math.PI / 180)
    const sw = image.width * (1 - (image.crop.left + image.crop.right) / 100)
    const sh = image.height * (1 - (image.crop.top + image.crop.bottom) / 100)
    context.drawImage(source, image.width * image.crop.left / 100, image.height * image.crop.top / 100, sw, sh, -sw / 2, -sh / 2, sw, sh)
    return canvas
  } catch (error) { canvas.width = 0; canvas.height = 0; throw error }
  finally { source.src = '' }
}

async function encode(canvas: HTMLCanvasElement, format: ConvertSettings['format'], quality: number) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, `image/${format}`, quality))
  if (!blob || blob.type !== `image/${format}`) throw new Error('当前浏览器不支持该导出格式，请改用 PNG 或 JPG')
  return blob
}

export function toolFileName(name: string, extension: string) {
  return `${name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '整理图片'}.${extension}`
}

export async function convertToolImage(image: StitchImage, settings: ConvertSettings, signal?: AbortSignal): Promise<ToolResult> {
  if (!Number.isFinite(settings.quality) || settings.quality < 0.1 || settings.quality > 1) throw new Error('清晰度无效')
  const canvas = await drawToolImage(image, settings.maxEdge, settings.format === 'jpeg', signal)
  try {
    const blob = await encode(canvas, settings.format, settings.quality)
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    return { name: toolFileName(image.name, settings.format === 'jpeg' ? 'jpg' : settings.format), blob, width: canvas.width, height: canvas.height, originalBytes: image.bytes }
  } finally { canvas.width = 0; canvas.height = 0 }
}

export async function imagesToPdf(images: StitchImage[], settings: PdfImageSettings, onProgress?: (current: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (!images.length) throw new Error('请先添加图片')
  const pdf = await PDFDocument.create()
  let encodedBytes = 0
  for (const [index, image] of images.entries()) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const size = getCroppedSize(image)
    const layout = imagePdfLayout(size.width, size.height, settings)
    const canvas = await drawToolImage(image, 4096, true, signal)
    try {
      const blob = await encode(canvas, settings.encoding, 0.92)
      encodedBytes += blob.size
      if (encodedBytes > 120 * 1024 * 1024) throw new Error('生成内容超过 120 MB，请选择较小体积或减少图片')
      const bytes = await blob.arrayBuffer()
      const embedded = settings.encoding === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      pdf.addPage([layout.pageWidth, layout.pageHeight]).drawImage(embedded, { x: layout.x, y: layout.y, width: layout.width, height: layout.height })
      onProgress?.(index + 1)
    } finally { canvas.width = 0; canvas.height = 0 }
  }
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  const bytes = await pdf.save()
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
