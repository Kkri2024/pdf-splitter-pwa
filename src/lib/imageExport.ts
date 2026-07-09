import type { SplitOutput } from './pdfSplitter'
import { loadPdfForPreview } from './pdfPreview'

export type ImageExportFormat = 'jpeg' | 'png'

export interface ImageExportFile {
  name: string
  blob: Blob
}

export function getImageExportExtension(format: ImageExportFormat): 'jpg' | 'png' {
  return format === 'jpeg' ? 'jpg' : 'png'
}

export function getImageExportMime(format: ImageExportFormat): 'image/jpeg' | 'image/png' {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png'
}

export function getImageExportLabel(format: ImageExportFormat): 'JPG' | 'PNG' {
  return format === 'jpeg' ? 'JPG' : 'PNG'
}

export function makeImageOutputName(
  outputName: string,
  pageNumber: number,
  pageCount: number,
  format: ImageExportFormat,
): string {
  const baseName = outputName.replace(/\.pdf$/i, '')
  const extension = getImageExportExtension(format)
  if (pageCount === 1) return `${baseName}.${extension}`

  const width = Math.max(3, String(pageCount).length)
  return `${baseName}/p${String(pageNumber).padStart(width, '0')}.${extension}`
}

async function renderPageToImageBlob(
  document: Awaited<ReturnType<typeof loadPdfForPreview>>['document'],
  pageNumber: number,
  format: ImageExportFormat,
): Promise<Blob> {
  const page = await document.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const targetWidth = Math.min(1800, Math.max(1200, baseViewport.width * 2))
  const viewport = page.getViewport({ scale: targetWidth / baseViewport.width })
  const canvas = window.document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('当前浏览器无法生成图片')

  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, getImageExportMime(format), format === 'jpeg' ? 0.92 : undefined)
  })
  page.cleanup()
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('图片生成失败，请减少页数后重试')
  return blob
}

export async function renderOutputImages(
  output: SplitOutput,
  format: ImageExportFormat,
  onProgress?: (completed: number, total: number) => void,
): Promise<ImageExportFile[]> {
  const { document } = await loadPdfForPreview(output.bytes)
  const files: ImageExportFile[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const blob = await renderPageToImageBlob(document, pageNumber, format)
      files.push({
        name: makeImageOutputName(output.name, pageNumber, document.numPages, format),
        blob,
      })
      onProgress?.(pageNumber, document.numPages)
    }
  } finally {
    await document.destroy()
  }
  return files
}

