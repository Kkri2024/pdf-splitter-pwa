/// <reference lib="webworker" />
import { executePdfJobs } from '../lib/pdfProcessor'
import type { OutputJob } from '../lib/pageEditor'

interface ProcessRequest {
  id: string
  bytes: ArrayBuffer
  jobs: OutputJob[]
}

self.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const { id, bytes, jobs } = event.data
  try {
    const outputs = await executePdfJobs(new Uint8Array(bytes), jobs, (completed, total) => {
      self.postMessage({ id, type: 'progress', completed, total })
    })
    const buffers = outputs.map((output) => output.bytes.buffer as ArrayBuffer)
    self.postMessage({ id, type: 'complete', outputs }, { transfer: buffers })
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'PDF 处理失败' })
  }
}

export {}
