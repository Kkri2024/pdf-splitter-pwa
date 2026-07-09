/// <reference lib="webworker" />
import { executePdfJobs } from '../lib/pdfProcessor'
import { executeMergeJob, type MergeJob, type MergeSourceDocument } from '../lib/pdfMerger'
import type { OutputJob } from '../lib/pageEditor'

interface ProcessJobsRequest {
  id: string
  kind: 'jobs'
  bytes: ArrayBuffer
  jobs: OutputJob[]
}

interface MergeRequest {
  id: string
  kind: 'merge'
  sources: Array<Omit<MergeSourceDocument, 'bytes'> & { bytes: ArrayBuffer }>
  job: MergeJob
}

type WorkerRequest = ProcessJobsRequest | MergeRequest

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id } = event.data
  try {
    const outputs = event.data.kind === 'merge'
      ? await executeMergeJob(
        event.data.sources.map((source) => ({ ...source, bytes: new Uint8Array(source.bytes) })),
        event.data.job,
        (completed, total) => self.postMessage({ id, type: 'progress', completed, total }),
      )
      : await executePdfJobs(new Uint8Array(event.data.bytes), event.data.jobs, (completed, total) => {
        self.postMessage({ id, type: 'progress', completed, total })
      })
    const buffers = outputs.map((output) => output.bytes.buffer as ArrayBuffer)
    self.postMessage({ id, type: 'complete', outputs }, { transfer: buffers })
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : 'PDF 处理失败' })
  }
}

export {}
