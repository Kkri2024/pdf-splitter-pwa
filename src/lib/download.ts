import JSZip from 'jszip'
import type { SplitOutput } from './pdfSplitter'

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

export async function shareOrDownloadPdf(output: SplitOutput): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = createPdfBlob(output.bytes)
  const file = new File([blob], output.name, { type: 'application/pdf' })
  const canShare = typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))

  if (canShare) {
    try {
      await navigator.share({ files: [file], title: output.name })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  triggerDownload(blob, output.name)
  return 'downloaded'
}

export async function createZip(
  outputs: SplitOutput[],
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const zip = new JSZip()
  outputs.forEach((output) => zip.file(output.name, output.bytes))
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (metadata) => onProgress?.(metadata.percent),
  )
}
