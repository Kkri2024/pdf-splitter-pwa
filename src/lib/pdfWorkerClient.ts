import type { OutputJob } from './pageEditor'
import type { MergeJob, MergeSourceDocument } from './pdfMerger'
import type { SplitOutput } from './pdfSplitter'

export function processPdfJobsInWorker(
  sourceBytes: Uint8Array,
  jobs: OutputJob[],
  onProgress?: (completed: number, total: number) => void,
): { promise: Promise<SplitOutput[]>; cancel: () => void } {
  const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' })
  const id = crypto.randomUUID()
  let settled = false
  const promise = new Promise<SplitOutput[]>((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.id !== id) return
      if (event.data.type === 'progress') onProgress?.(event.data.completed, event.data.total)
      if (event.data.type === 'complete') {
        settled = true
        worker.terminate()
        resolve(event.data.outputs)
      }
      if (event.data.type === 'error') {
        settled = true
        worker.terminate()
        reject(new Error(event.data.message))
      }
    }
    worker.onerror = () => {
      settled = true
      worker.terminate()
      reject(new Error('后台 PDF 处理失败，请重新尝试'))
    }
    const bytes = sourceBytes.slice().buffer as ArrayBuffer
    worker.postMessage({ id, kind: 'jobs', bytes, jobs }, [bytes])
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker.terminate()
    },
  }
}

export function processMergeJobInWorker(
  sources: MergeSourceDocument[],
  job: MergeJob,
  onProgress?: (completed: number, total: number) => void,
): { promise: Promise<SplitOutput[]>; cancel: () => void } {
  const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' })
  const id = crypto.randomUUID()
  let settled = false
  const promise = new Promise<SplitOutput[]>((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.id !== id) return
      if (event.data.type === 'progress') onProgress?.(event.data.completed, event.data.total)
      if (event.data.type === 'complete') {
        settled = true
        worker.terminate()
        resolve(event.data.outputs)
      }
      if (event.data.type === 'error') {
        settled = true
        worker.terminate()
        reject(new Error(event.data.message))
      }
    }
    worker.onerror = () => {
      settled = true
      worker.terminate()
      reject(new Error('后台 PDF 处理失败，请重新尝试'))
    }
    const transfer: ArrayBuffer[] = []
    const payloadSources = sources.map((source) => {
      const bytes = source.bytes.slice().buffer as ArrayBuffer
      transfer.push(bytes)
      return { ...source, bytes }
    })
    worker.postMessage({ id, kind: 'merge', sources: payloadSources, job }, transfer)
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker.terminate()
    },
  }
}
