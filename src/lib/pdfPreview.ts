import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorker

export interface LoadedPdf {
  document: PDFDocumentProxy
  pageCount: number
}

export interface Thumbnail {
  pageNumber: number
  url: string
}

export interface PagePreview extends Thumbnail {
  width: number
  height: number
}

export async function loadPdfForPreview(bytes: Uint8Array): Promise<LoadedPdf> {
  try {
    const document = await getDocument({ data: bytes.slice() }).promise
    return { document, pageCount: document.numPages }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (name === 'PasswordException' || message.includes('password')) {
      throw new Error('暂不支持密码保护或加密的 PDF')
    }
    throw new Error('无法读取此 PDF，文件可能已损坏')
  }
}

export async function renderThumbnails(
  document: PDFDocumentProxy,
  onThumbnail: (thumbnail: Thumbnail) => void,
  isCancelled: () => boolean,
): Promise<void> {
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (isCancelled()) return

    const page = await document.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1, 240 / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = window.document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('当前浏览器无法生成页面预览')

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.ceil(viewport.width * pixelRatio)
    canvas.height = Math.ceil(viewport.height * pixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`

    await page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    }).promise

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84))
    page.cleanup()
    canvas.width = 0
    canvas.height = 0
    if (!blob || isCancelled()) return
    onThumbnail({ pageNumber, url: URL.createObjectURL(blob) })
  }
}

export async function renderPagePreview(
  document: PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
  isCancelled: () => boolean,
): Promise<PagePreview | null> {
  if (pageNumber < 1 || pageNumber > document.numPages || isCancelled()) return null

  const page = await document.getPage(pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const safeTargetWidth = Math.max(320, Math.min(targetWidth, 1200))
  const viewport = page.getViewport({ scale: safeTargetWidth / baseViewport.width })
  const canvas = window.document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('当前浏览器无法生成高清预览')

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.ceil(viewport.width * pixelRatio)
  canvas.height = Math.ceil(viewport.height * pixelRatio)

  await page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise

  if (isCancelled()) {
    page.cleanup()
    canvas.width = 0
    canvas.height = 0
    return null
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  page.cleanup()
  canvas.width = 0
  canvas.height = 0
  if (!blob || isCancelled()) return null

  return {
    pageNumber,
    url: URL.createObjectURL(blob),
    width: viewport.width,
    height: viewport.height,
  }
}
