import JSZip from 'jszip'
import type { SplitOutput } from './pdfSplitter'

export type CopyPdfResult = 'copied-file' | 'copied-name' | 'failed'
export type SharePdfResult = 'shared' | 'cancelled' | 'unsupported' | 'failed'
export interface DownloadFile {
  name: string
  data: Blob | Uint8Array
}

export function createPdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes], { type: 'application/pdf' })
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function downloadPdf(output: SplitOutput): void {
  triggerDownload(createPdfBlob(output.bytes), output.name)
}

export async function sharePdf(output: SplitOutput): Promise<SharePdfResult> {
  const blob = createPdfBlob(output.bytes)
  const file = new File([blob], output.name, { type: 'application/pdf' })
  const canShare = typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))

  if (!canShare) return 'unsupported'

  try {
    await navigator.share({ files: [file], title: output.name })
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    return 'failed'
  }
}

export async function copyPdfToClipboard(
  output: SplitOutput,
  clipboard: Clipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  ClipboardItemType: typeof ClipboardItem | undefined = globalThis.ClipboardItem,
): Promise<CopyPdfResult> {
  if (clipboard?.write && ClipboardItemType) {
    try {
      const blob = createPdfBlob(output.bytes)
      await clipboard.write([new ClipboardItemType({ 'application/pdf': blob })])
      return 'copied-file'
    } catch {
      // Safari and some Chromium builds reject application/pdf clipboard items.
    }
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(output.name)
      return 'copied-name'
    } catch {
      // Fall through to a visible failure message in the UI.
    }
  }

  return 'failed'
}

export async function createZip(
  outputs: SplitOutput[],
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  return createFilesZip(
    outputs.map((output) => ({ name: output.name, data: output.bytes })),
    onProgress,
  )
}

export async function createFilesZip(
  files: DownloadFile[],
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const zip = new JSZip()
  files.forEach((file) => zip.file(file.name, file.data))
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (metadata) => onProgress?.(metadata.percent),
  )
}
