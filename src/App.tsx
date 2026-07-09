import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Archive,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileCheck2,
  FileImage,
  FileOutput,
  FileText,
  History as HistoryIcon,
  Info,
  Layers3,
  ListChecks,
  ListRestart,
  LockKeyhole,
  PackageOpen,
  RefreshCw,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  Settings2,
  Share2,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PageEditorGrid } from './components/PageEditorGrid'
import { copyPdfToClipboard, createFilesZip, createZip, downloadPdf, sharePdf, triggerDownload } from './lib/download'
import { formatFileSize } from './lib/format'
import {
  appendHistory,
  clearHistory,
  loadHistory,
  removeHistory,
  type HistoryEntry,
} from './lib/history'
import {
  loadPdfForPreview,
  renderPagePreview,
  renderThumbnail,
  type Thumbnail,
} from './lib/pdfPreview'
import {
  getPdfBaseName,
  PdfSplitError,
  parseRangeSpec,
  type OutputPageMeta,
  type SplitMode,
  type SplitOutput,
} from './lib/pdfSplitter'
import {
  getImageExportLabel,
  renderOutputImages,
  type ImageExportFormat,
} from './lib/imageExport'
import {
  createEditedExportJob,
  createOutputJobs,
  createPageEditState,
  pageEditReducer,
  rangesToSelectedIds,
  selectedIdsToRangeSpec,
  type EditablePage,
  type SelectionOutputMode,
} from './lib/pageEditor'
import { processMergeJobInWorker, processPdfJobsInWorker } from './lib/pdfWorkerClient'
import type { MergePage, MergeSourceDocument } from './lib/pdfMerger'
import { getThumbnailConcurrency, trimThumbnailUrls } from './lib/thumbnailCache'
import { isRemainderOutput } from './lib/uiLogic'

interface SourcePdf {
  file: File
  bytes: Uint8Array
  pageCount: number
}

interface MergeSourcePdf extends MergeSourceDocument {
  file: File
  pageCount: number
}

type BusyState = 'idle' | 'loading' | 'splitting' | 'zipping' | 'merging'
type WorkspaceMode = 'split' | 'merge'
type ExportFormat = 'pdf' | ImageExportFormat

interface PreviewContext {
  pages: OutputPageMeta[]
  index: number
  label: string
  mode: WorkspaceMode
}

const modeOptions: Array<{ value: SplitMode; label: string; description: string }> = [
  { value: 'fixed', label: '每 N 页', description: '按固定页数分组' },
  { value: 'each', label: '逐页分割', description: '每页单独生成' },
  { value: 'custom', label: '自定义', description: '指定页码范围' },
]

const workspaceOptions: Array<{ value: WorkspaceMode; label: string; description: string }> = [
  { value: 'split', label: '分割单个 PDF', description: '按页数或范围拆分一个文件' },
  { value: 'merge', label: '多 PDF 合并', description: '从多个文件选页后合并' },
]

const exportFormatOptions: Array<{ value: ExportFormat; label: string; description: string }> = [
  { value: 'pdf', label: 'PDF', description: '保留可编辑文档' },
  { value: 'jpeg', label: 'JPG', description: '适合分享预览' },
  { value: 'png', label: 'PNG', description: '适合高清图片' },
]

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const ui = {
  appShell: 'mesh-background relative isolate flex min-h-screen flex-col overflow-x-hidden text-ink',
  topbar: 'sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/50 bg-white/55 px-6 py-3 shadow-[0_10px_30px_rgba(73,137,214,.08)] backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 [padding-left:max(24px,env(safe-area-inset-left))] [padding-right:max(24px,env(safe-area-inset-right))] [padding-top:max(12px,env(safe-area-inset-top))] max-[540px]:h-[58px] max-[540px]:px-3.5 max-[540px]:[padding-left:max(14px,env(safe-area-inset-left))] max-[540px]:[padding-right:max(14px,env(safe-area-inset-right))]',
  brand: 'flex items-center gap-2.5 whitespace-nowrap text-[15px] font-semibold max-[540px]:text-sm max-[360px]:[&>span:last-child]:hidden',
  brandMark: 'grid size-[34px] place-items-center rounded-lg bg-brand text-white shadow-[0_8px_18px_rgba(18,100,229,.23)]',
  topbarActions: 'flex items-center gap-2.5 max-[540px]:gap-2',
  statusChip: 'flex min-h-8 items-center gap-1.5 rounded-lg border border-success/10 bg-success-soft/90 px-2.5 text-xs font-semibold text-success max-[540px]:hidden',
  topButton: 'tooltip-button flex h-9 items-center gap-1.5 rounded-lg border border-white/30 bg-white/35 px-2.5 text-sm text-ink shadow-sm backdrop-blur-xl transition-all duration-500 ease-out hover:-translate-y-px hover:border-blue-300/40 hover:bg-white/60 hover:shadow-md max-[540px]:size-10 max-[540px]:justify-center max-[540px]:px-2 max-[540px]:[&>span]:hidden',
  workspace: 'mx-auto w-[min(1120px,calc(100%-48px))] flex-1 animate-page-enter pt-15 pb-16 max-[900px]:w-[min(740px,calc(100%-32px))] max-[900px]:pt-12 max-[540px]:w-[calc(100%-24px)] max-[540px]:pt-9 max-[540px]:pb-12',
  glassPanel: 'rounded-lg border border-white/65 bg-white/58 shadow-glass backdrop-blur-2xl backdrop-saturate-150 transition-all duration-300 ease-out',
  intro: 'mb-7 flex items-end justify-between gap-8 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-3 max-[540px]:mb-5.5',
  sectionHeading: 'flex items-center gap-3',
  iconButton: 'tooltip-button grid size-10 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted transition-all duration-200 hover:bg-danger-soft hover:text-danger active:scale-95 disabled:pointer-events-none disabled:opacity-40',
  primaryButton: 'tooltip-button inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/25 bg-[#2388ff] px-5 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.35),inset_0_0_14px_rgba(255,255,255,.12),0_10px_24px_rgba(35,136,255,.28)] transition-all duration-300 ease-out hover:-translate-y-px hover:bg-[#117af0] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.4),inset_0_0_16px_rgba(255,255,255,.15),0_13px_28px_rgba(35,136,255,.34)] active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  secondaryButton: 'tooltip-button inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-black/10 bg-slate-200/80 px-4 font-semibold text-ink transition-all duration-200 active:scale-[.98]',
  stepNumber: 'grid size-[34px] shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white shadow-[0_7px_15px_rgba(18,100,229,.16)]',
  thumbnail: 'group/thumb relative m-0 min-w-0 cursor-zoom-in overflow-hidden rounded-[5px] border-0 bg-white p-0 shadow-[0_6px_18px_rgba(31,43,58,.1)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(31,43,58,.16)]',
  toast: 'fixed bottom-[max(22px,env(safe-area-inset-bottom))] left-1/2 z-80 flex min-h-13 -translate-x-1/2 items-center gap-2.5 rounded-lg bg-[#262a31] px-3.5 py-2 text-[13px] text-white shadow-[0_14px_38px_rgba(0,0,0,.22)] animate-fade-in max-[540px]:bottom-[max(12px,env(safe-area-inset-bottom))] max-[540px]:w-[calc(100%-24px)]',
}

function getErrorMessage(error: unknown): string {
  if (error instanceof PdfSplitError || error instanceof Error) return error.message
  return '操作失败，请重新选择文件后再试'
}

function createMergePages(source: MergeSourcePdf): MergePage[] {
  return Array.from({ length: source.pageCount }, (_, sourcePageIndex) => ({
    id: `${source.id}-page-${sourcePageIndex + 1}`,
    sourceId: source.id,
    sourceName: source.name,
    sourcePageIndex,
    rotation: 0 as const,
  }))
}

function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('split')
  const [source, setSource] = useState<SourcePdf | null>(null)
  const [mergeSources, setMergeSources] = useState<MergeSourcePdf[]>([])
  const [mergeSelectedPages, setMergeSelectedPages] = useState<MergePage[]>([])
  const [mergeOutputs, setMergeOutputs] = useState<SplitOutput[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, Thumbnail>>({})
  const [editState, dispatchEdit] = useReducer(pageEditReducer, 0, createPageEditState)
  const [mode, setMode] = useState<SplitMode>('fixed')
  const [pagesPerFile, setPagesPerFile] = useState('5')
  const [rangeSpec, setRangeSpec] = useState('')
  const [selectionOutputMode, setSelectionOutputMode] = useState<SelectionOutputMode>('segments')
  const [outputs, setOutputs] = useState<SplitOutput[]>([])
  const [busy, setBusy] = useState<BusyState>('idle')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [zipProgress, setZipProgress] = useState(0)
  const [imageProgress, setImageProgress] = useState({ current: 0, total: 0 })
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf')
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [mergeDragActive, setMergeDragActive] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [editorExpanded, setEditorExpanded] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => loadHistory())
  const [showHistory, setShowHistory] = useState(false)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [previewContext, setPreviewContext] = useState<PreviewContext | null>(null)
  const [previewImage, setPreviewImage] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const mergeInputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const previewDocumentRef = useRef<PDFDocumentProxy | null>(null)
  const mergeDocumentsRef = useRef<Map<string, PDFDocumentProxy>>(new Map())
  const thumbnailUrlsRef = useRef<Map<string, string>>(new Map())
  const thumbnailKeysRef = useRef<Map<string, string>>(new Map())
  const thumbnailRequestedKeysRef = useRef<Map<string, string>>(new Map())
  const thumbnailQueueRef = useRef<OutputPageMeta[]>([])
  const thumbnailActiveRef = useRef(0)
  const pagePreviewUrlRef = useRef('')
  const pagePreviewGenerationRef = useRef(0)
  const touchStartXRef = useRef<number | null>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const pendingResultScrollRef = useRef(false)
  const processingCancelRef = useRef<(() => void) | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const previewPage = previewContext?.pages[previewContext.index] ?? null

  const closePagePreview = useCallback(() => {
    pagePreviewGenerationRef.current += 1
    if (pagePreviewUrlRef.current) URL.revokeObjectURL(pagePreviewUrlRef.current)
    pagePreviewUrlRef.current = ''
    setPreviewImage('')
    setPreviewLoading(false)
    setPreviewContext(null)
  }, [])

  const cleanupPreview = useCallback(() => {
    generationRef.current += 1
    processingCancelRef.current?.()
    processingCancelRef.current = null
    thumbnailQueueRef.current = []
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    thumbnailUrlsRef.current.clear()
    thumbnailKeysRef.current.clear()
    thumbnailRequestedKeysRef.current.clear()
    setThumbnails({})
    if (previewDocumentRef.current) void previewDocumentRef.current.destroy()
    previewDocumentRef.current = null
    mergeDocumentsRef.current.forEach((document) => void document.destroy())
    mergeDocumentsRef.current.clear()
    closePagePreview()
  }, [closePagePreview])

  const clearAll = useCallback(() => {
    cleanupPreview()
    setSource(null)
    setMergeSources([])
    setMergeSelectedPages([])
    setMergeOutputs([])
    setOutputs([])
    setError('')
    setBusy('idle')
    setProgress({ current: 0, total: 0 })
    setZipProgress(0)
    setImageProgress({ current: 0, total: 0 })
    setExportFormat('pdf')
    setEditorExpanded(false)
    dispatchEdit({ type: 'initialize', pageCount: 0 })
    if (inputRef.current) inputRef.current.value = ''
  }, [cleanupPreview])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
    }
  }, [])

  useEffect(() => () => {
    generationRef.current += 1
    processingCancelRef.current?.()
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    if (pagePreviewUrlRef.current) URL.revokeObjectURL(pagePreviewUrlRef.current)
    if (previewDocumentRef.current) void previewDocumentRef.current.destroy()
    mergeDocumentsRef.current.forEach((document) => void document.destroy())
  }, [])

  useEffect(() => {
    if (!previewPage) return
    const previewDocument = previewPage.sourceId
      ? mergeDocumentsRef.current.get(previewPage.sourceId)
      : previewDocumentRef.current
    if (!previewDocument) return
    const previewGeneration = pagePreviewGenerationRef.current + 1
    pagePreviewGenerationRef.current = previewGeneration
    if (pagePreviewUrlRef.current) URL.revokeObjectURL(pagePreviewUrlRef.current)
    pagePreviewUrlRef.current = ''
    setPreviewImage('')
    setPreviewLoading(true)

    const targetWidth = Math.min(window.innerWidth - 48, 1120)
    void renderPagePreview(
      previewDocument,
      previewPage.sourcePageIndex + 1,
      targetWidth,
      () => previewGeneration !== pagePreviewGenerationRef.current,
      previewPage.rotation,
    ).then((preview) => {
      if (!preview || previewGeneration !== pagePreviewGenerationRef.current) {
        if (preview?.url) URL.revokeObjectURL(preview.url)
        return
      }
      pagePreviewUrlRef.current = preview.url
      setPreviewImage(preview.url)
      setPreviewLoading(false)
    }).catch((previewError) => {
      if (previewGeneration === pagePreviewGenerationRef.current) {
        setPreviewLoading(false)
        setError(getErrorMessage(previewError))
      }
    })
  }, [previewPage])

  useEffect(() => {
    const dialogOpen = showHistory || Boolean(previewPage) || showInstallHelp
    if (!dialogOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [previewPage, showHistory, showInstallHelp])

  useEffect(() => {
    if (!copyNotice) return
    const timer = window.setTimeout(() => setCopyNotice(''), 2_600)
    return () => window.clearTimeout(timer)
  }, [copyNotice])

  useEffect(() => {
    if ((outputs.length === 0 && mergeOutputs.length === 0) || !pendingResultScrollRef.current) return
    pendingResultScrollRef.current = false
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      resultsRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mergeOutputs.length, outputs.length])

  useEffect(() => {
    if (!showHistory && !previewPage) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewPage) closePagePreview()
        else setShowHistory(false)
      }
      if (previewContext) {
        if (event.key === 'ArrowLeft') {
          setPreviewContext((current) => current && ({
            ...current,
            index: Math.max(0, current.index - 1),
          }))
        }
        if (event.key === 'ArrowRight') {
          setPreviewContext((current) => current && ({
            ...current,
            index: Math.min(current.pages.length - 1, current.index + 1),
          }))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePagePreview, previewContext, previewPage, showHistory])

  const runThumbnailQueue = useCallback(() => {
    const limit = getThumbnailConcurrency(window.matchMedia('(pointer: coarse)').matches)
    while (thumbnailActiveRef.current < limit && thumbnailQueueRef.current.length > 0) {
      const page = thumbnailQueueRef.current.shift()!
      const document = page.sourceId
        ? mergeDocumentsRef.current.get(page.sourceId)
        : previewDocumentRef.current
      if (!document) continue
      const key = `${page.sourcePageIndex}:${page.rotation}`
      if (thumbnailKeysRef.current.get(page.id) === key) continue
      thumbnailActiveRef.current += 1
      const generation = generationRef.current
      void renderThumbnail(
        document,
        page.sourcePageIndex + 1,
        page.rotation,
        limit === 1 ? 1.5 : 2,
        () => generation !== generationRef.current,
      ).then((thumbnail) => {
        if (!thumbnail || generation !== generationRef.current) {
          if (thumbnail?.url) URL.revokeObjectURL(thumbnail.url)
          return
        }
        if (thumbnailRequestedKeysRef.current.get(page.id) !== key) {
          URL.revokeObjectURL(thumbnail.url)
          return
        }
        const previousUrl = thumbnailUrlsRef.current.get(page.id)
        if (previousUrl) URL.revokeObjectURL(previousUrl)
        thumbnailUrlsRef.current.delete(page.id)
        thumbnailUrlsRef.current.set(page.id, thumbnail.url)
        thumbnailKeysRef.current.set(page.id, key)
        setThumbnails((current) => ({ ...current, [page.id]: thumbnail }))

        trimThumbnailUrls(thumbnailUrlsRef.current).forEach(([oldestId, oldestUrl]) => {
          URL.revokeObjectURL(oldestUrl)
          thumbnailKeysRef.current.delete(oldestId)
          thumbnailRequestedKeysRef.current.delete(oldestId)
          setThumbnails((current) => {
            const next = { ...current }
            delete next[oldestId]
            return next
          })
        })
      }).catch((thumbnailError) => setError(getErrorMessage(thumbnailError))).finally(() => {
        thumbnailActiveRef.current -= 1
        runThumbnailQueue()
      })
    }
  }, [])

  const requestThumbnail = useCallback((page: OutputPageMeta) => {
    const key = `${page.sourcePageIndex}:${page.rotation}`
    if (thumbnailKeysRef.current.get(page.id) === key) {
      const url = thumbnailUrlsRef.current.get(page.id)
      if (url) {
        thumbnailUrlsRef.current.delete(page.id)
        thumbnailUrlsRef.current.set(page.id, url)
      }
      return
    }
    if (thumbnailQueueRef.current.some((queued) => queued.id === page.id && queued.rotation === page.rotation)) return
    thumbnailRequestedKeysRef.current.set(page.id, key)
    thumbnailQueueRef.current.push(page)
    runThumbnailQueue()
  }, [runThumbnailQueue])

  const processFile = useCallback(async (file?: File) => {
    if (!file || busy !== 'idle') return
    setError('')
    setOutputs([])
    setEditorExpanded(false)

    const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!looksLikePdf) {
      setError('请选择 PDF 文件')
      return
    }
    if (file.size === 0) {
      setError('文件为空，请选择有效的 PDF')
      return
    }

    cleanupPreview()
    setSource(null)
    setBusy('loading')
    const generation = generationRef.current

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const loaded = await loadPdfForPreview(bytes)
      if (generation !== generationRef.current) {
        await loaded.document.destroy()
        return
      }

      previewDocumentRef.current = loaded.document
      setSource({ file, bytes, pageCount: loaded.pageCount })
      const initialEnd = Math.min(loaded.pageCount, 3)
      setRangeSpec(`1-${initialEnd}`)
      dispatchEdit({ type: 'initialize', pageCount: loaded.pageCount })
      setBusy('idle')
    } catch (loadError) {
      if (generation === generationRef.current) {
        cleanupPreview()
        setBusy('idle')
        setSource(null)
        setError(getErrorMessage(loadError))
      }
    }
  }, [busy, cleanupPreview])

  const processMergeFiles = useCallback(async (fileList?: FileList | File[]) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0 || busy !== 'idle') return
    setError('')
    setMergeOutputs([])
    setBusy('loading')
    const generation = generationRef.current

    try {
      const nextSources: MergeSourcePdf[] = []
      for (const file of files) {
        const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        if (!looksLikePdf) throw new Error(`“${file.name}”不是 PDF 文件`)
        if (file.size === 0) throw new Error(`“${file.name}”为空文件`)

        const bytes = new Uint8Array(await file.arrayBuffer())
        const loaded = await loadPdfForPreview(bytes)
        if (generation !== generationRef.current) {
          await loaded.document.destroy()
          return
        }
        const id = crypto.randomUUID()
        mergeDocumentsRef.current.set(id, loaded.document)
        nextSources.push({ id, file, name: file.name, bytes, pageCount: loaded.pageCount })
      }
      setMergeSources((current) => [...current, ...nextSources])
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      if (generation === generationRef.current) setBusy('idle')
      if (mergeInputRef.current) mergeInputRef.current.value = ''
    }
  }, [busy])

  const removeMergeSource = useCallback((sourceId: string) => {
    const document = mergeDocumentsRef.current.get(sourceId)
    if (document) void document.destroy()
    mergeDocumentsRef.current.delete(sourceId)
    setMergeSources((current) => current.filter((item) => item.id !== sourceId))
    setMergeSelectedPages((current) => current.filter((page) => page.sourceId !== sourceId))
    setMergeOutputs([])
    setThumbnails((current) => {
      const next = { ...current }
      Object.keys(next).forEach((id) => {
        if (id.startsWith(`${sourceId}-`)) delete next[id]
      })
      return next
    })
    Array.from(thumbnailUrlsRef.current.entries()).forEach(([id, url]) => {
      if (!id.startsWith(`${sourceId}-`)) return
      URL.revokeObjectURL(url)
      thumbnailUrlsRef.current.delete(id)
      thumbnailKeysRef.current.delete(id)
      thumbnailRequestedKeysRef.current.delete(id)
    })
  }, [])

  const clearMergeWorkspace = useCallback(() => {
    mergeDocumentsRef.current.forEach((document) => void document.destroy())
    mergeDocumentsRef.current.clear()
    setMergeSources([])
    setMergeSelectedPages([])
    setMergeOutputs([])
    setError('')
    setProgress({ current: 0, total: 0 })
    setBusy('idle')
    setThumbnails((current) => {
      const next = { ...current }
      Object.keys(next).forEach((id) => {
        if (id.includes('-page-')) delete next[id]
      })
      return next
    })
    Array.from(thumbnailUrlsRef.current.entries()).forEach(([id, url]) => {
      if (!id.includes('-page-')) return
      URL.revokeObjectURL(url)
      thumbnailUrlsRef.current.delete(id)
      thumbnailKeysRef.current.delete(id)
      thumbnailRequestedKeysRef.current.delete(id)
    })
    if (mergeInputRef.current) mergeInputRef.current.value = ''
  }, [])

  const handleToggleMergePage = useCallback((page: MergePage) => {
    setMergeSelectedPages((current) => {
      const exists = current.some((item) => item.id === page.id)
      return exists ? current.filter((item) => item.id !== page.id) : [...current, page]
    })
    setMergeOutputs([])
  }, [])

  const moveMergePage = useCallback((activeId: string, overId: string) => {
    setMergeSelectedPages((current) => {
      const from = current.findIndex((page) => page.id === activeId)
      const to = current.findIndex((page) => page.id === overId)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setMergeOutputs([])
  }, [])

  const moveMergePageTo = useCallback((id: string, position: number) => {
    setMergeSelectedPages((current) => {
      const from = current.findIndex((page) => page.id === id)
      const to = Math.max(0, Math.min(current.length - 1, position - 1))
      if (from < 0 || from === to) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setMergeOutputs([])
  }, [])

  const planResult = useMemo(() => {
    if (!source) return { plan: [], error: '' }
    try {
      return {
        plan: createOutputJobs(mode, editState.present.pages, source.file.name, {
          pagesPerFile: Number(pagesPerFile),
          rangeSpec,
          selectionOutputMode,
        }),
        error: '',
      }
    } catch (planError) {
      return { plan: [], error: getErrorMessage(planError) }
    }
  }, [editState.present.pages, mode, pagesPerFile, rangeSpec, selectionOutputMode, source])

  const chunkSize = Number(pagesPerFile)

  const handleSplit = async () => {
    if (!source || planResult.error || busy !== 'idle') return
    setError('')
    setOutputs([])
    setBusy('splitting')
    setProgress({ current: 0, total: planResult.plan.length })

    try {
      closePagePreview()
      const task = processPdfJobsInWorker(source.bytes, planResult.plan, (current, total) => setProgress({ current, total }))
      processingCancelRef.current = task.cancel
      const result = await task.promise
      processingCancelRef.current = null
      pendingResultScrollRef.current = true
      setOutputs(result)
      const modeSummary = mode === 'fixed'
        ? `每 ${pagesPerFile} 页一份`
        : mode === 'each'
          ? '逐页分割'
          : `自定义：${rangeSpec}`
      setHistoryEntries(appendHistory({
        sourceName: source.file.name,
        sourceSize: source.file.size,
        pageCount: editState.present.pages.length,
        mode,
        modeSummary,
        outputCount: result.length,
        outputBytes: result.reduce((total, output) => total + output.bytes.byteLength, 0),
      }))
    } catch (splitError) {
      setOutputs([])
      setError(getErrorMessage(splitError))
    } finally {
      processingCancelRef.current = null
      setBusy('idle')
    }
  }

  const handleExportEdited = async () => {
    if (!source || busy !== 'idle' || editState.present.pages.length === 0) return
    setBusy('splitting')
    setProgress({ current: 0, total: 1 })
    setError('')
    closePagePreview()
    try {
      const task = processPdfJobsInWorker(source.bytes, [createEditedExportJob(editState.present.pages, source.file.name)], (current, total) => setProgress({ current, total }))
      processingCancelRef.current = task.cancel
      const [output] = await task.promise
      processingCancelRef.current = null
      downloadPdf(output)
      setCopyNotice('编辑后的完整 PDF 已生成')
    } catch (exportError) {
      setError(getErrorMessage(exportError))
    } finally {
      processingCancelRef.current = null
      setBusy('idle')
      setProgress({ current: 0, total: 0 })
    }
  }

  const handleMergeSelected = async () => {
    if (mergeSources.length === 0 || mergeSelectedPages.length === 0 || busy !== 'idle') return
    setBusy('merging')
    setProgress({ current: 0, total: mergeSelectedPages.length })
    setError('')
    setMergeOutputs([])
    closePagePreview()
    try {
      const task = processMergeJobInWorker(
        mergeSources.map(({ id, name, bytes }) => ({ id, name, bytes })),
        { name: 'merged_selected.pdf', pages: mergeSelectedPages },
        (current, total) => setProgress({ current, total }),
      )
      processingCancelRef.current = task.cancel
      const result = await task.promise
      processingCancelRef.current = null
      pendingResultScrollRef.current = true
      setMergeOutputs(result)
      setHistoryEntries(appendHistory({
        sourceName: `${mergeSources.length} 个 PDF`,
        sourceSize: mergeSources.reduce((total, item) => total + item.file.size, 0),
        pageCount: mergeSelectedPages.length,
        mode: 'merge',
        modeSummary: `多 PDF 合并：${mergeSelectedPages.length} 页`,
        outputCount: 1,
        outputBytes: result[0]?.bytes.byteLength ?? 0,
      }))
    } catch (mergeError) {
      setError(getErrorMessage(mergeError))
    } finally {
      processingCancelRef.current = null
      setBusy('idle')
    }
  }

  const handleDownloadOutput = async (output: SplitOutput) => {
    if (busy !== 'idle') return
    if (exportFormat === 'pdf') {
      downloadPdf(output)
      return
    }

    setBusy('zipping')
    setZipProgress(0)
    setImageProgress({ current: 0, total: output.pageCount })
    setError('')
    closePagePreview()
    try {
      const imageFiles = await renderOutputImages(output, exportFormat, (current, total) => {
        setImageProgress({ current, total })
      })
      if (imageFiles.length === 1) {
        triggerDownload(imageFiles[0].blob, imageFiles[0].name)
      } else {
        const zip = await createFilesZip(
          imageFiles.map((file) => ({ name: file.name, data: file.blob })),
          setZipProgress,
        )
        triggerDownload(zip, `${output.name.replace(/\.pdf$/i, '')}_${getImageExportLabel(exportFormat).toLowerCase()}.zip`)
      }
    } catch (downloadError) {
      setError(getErrorMessage(downloadError))
    } finally {
      setBusy('idle')
      setZipProgress(0)
      setImageProgress({ current: 0, total: 0 })
    }
  }

  const handleDownloadAll = async () => {
    const activeOutputs = workspaceMode === 'merge' ? mergeOutputs : outputs
    if (activeOutputs.length === 0 || busy !== 'idle') return
    setBusy('zipping')
    setZipProgress(0)
    setImageProgress({
      current: 0,
      total: exportFormat === 'pdf' ? 0 : activeOutputs.reduce((total, output) => total + output.pageCount, 0),
    })
    setError('')
    closePagePreview()
    try {
      const zip = exportFormat === 'pdf'
        ? await createZip(activeOutputs, setZipProgress)
        : await createFilesZip(
          (await activeOutputs.reduce<Promise<{ files: Array<{ name: string; data: Blob }>; completedPages: number }>>(async (promise, output) => {
            const accumulator = await promise
            const previousCount = accumulator.completedPages
            const rendered = await renderOutputImages(output, exportFormat, (current) => {
              setImageProgress((latest) => ({ ...latest, current: previousCount + current }))
            })
            accumulator.files.push(...rendered.map((file) => ({ name: file.name, data: file.blob })))
            return { files: accumulator.files, completedPages: previousCount + output.pageCount }
          }, Promise.resolve({ files: [], completedPages: 0 }))).files,
          setZipProgress,
        )
      const zipName = workspaceMode === 'merge'
        ? `merged_selected_${exportFormat === 'pdf' ? 'pdf' : getImageExportLabel(exportFormat).toLowerCase()}.zip`
        : `${getPdfBaseName(source?.file.name ?? 'PDF')}_split_${exportFormat === 'pdf' ? 'pdf' : getImageExportLabel(exportFormat).toLowerCase()}.zip`
      triggerDownload(zip, zipName)
    } catch (zipError) {
      setError(getErrorMessage(zipError))
    } finally {
      setBusy('idle')
      setZipProgress(0)
      setImageProgress({ current: 0, total: 0 })
    }
  }

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(null)
    } else {
      setShowInstallHelp(true)
    }
  }

  const handleCopyOutput = async (output: SplitOutput) => {
    const result = await copyPdfToClipboard(output)
    setCopyNotice(result === 'copied-file'
      ? 'PDF 已复制到剪贴板'
      : result === 'copied-name'
        ? '浏览器不支持复制 PDF，已复制文件名'
        : '无法访问剪贴板，请使用下载')
  }

  const handleShareOutput = async (output: SplitOutput) => {
    const result = await sharePdf(output)
    if (result === 'shared' || result === 'cancelled') return
    setCopyNotice(result === 'unsupported'
      ? '当前浏览器不支持文件分享，请使用下载'
      : '分享失败，请使用下载后再分享')
  }

  const openOutputPreview = (output: SplitOutput) => {
    const pages = output.pages ?? editState.present.pages.slice(output.range.start - 1, output.range.end)
    setPreviewContext({ pages, index: 0, label: output.name, mode: workspaceMode })
  }

  const movePreview = (direction: -1 | 1) => {
    setPreviewContext((current) => current && ({
      ...current,
      index: Math.max(0, Math.min(current.pages.length - 1, current.index + direction)),
    }))
  }

  const handleTogglePage = (id: string) => {
    const selected = new Set(editState.present.selectedIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    const ids = editState.present.pages.filter((page) => selected.has(page.id)).map((page) => page.id)
    dispatchEdit({ type: 'set-selection', ids })
    if (mode === 'custom') setRangeSpec(selectedIdsToRangeSpec(ids, editState.present.pages))
    setOutputs([])
  }

  const handleToggleAllPages = () => {
    const ids = editState.present.selectedIds.length === editState.present.pages.length
      ? []
      : editState.present.pages.map((page) => page.id)
    dispatchEdit({ type: 'set-selection', ids })
    if (mode === 'custom') setRangeSpec(selectedIdsToRangeSpec(ids, editState.present.pages))
    setOutputs([])
  }

  const handleRangeChange = (value: string) => {
    setRangeSpec(value)
    setOutputs([])
    try {
      const ranges = parseRangeSpec(value, editState.present.pages.length)
      dispatchEdit({ type: 'set-selection', ids: rangesToSelectedIds(ranges, editState.present.pages) })
    } catch {
      // Preserve the last valid visual selection while the user edits an incomplete range.
    }
  }

  const applyPageEdit = (action: Parameters<typeof dispatchEdit>[0]) => {
    if (action.type === 'delete-selected' && editState.present.selectedIds.length >= editState.present.pages.length) {
      setCopyNotice('PDF 至少需要保留一页')
      return
    }
    if (action.type === 'delete-selected') {
      editState.present.selectedIds.forEach((id) => {
        const url = thumbnailUrlsRef.current.get(id)
        if (url) URL.revokeObjectURL(url)
        thumbnailUrlsRef.current.delete(id)
        thumbnailKeysRef.current.delete(id)
        thumbnailRequestedKeysRef.current.delete(id)
      })
      setThumbnails((current) => {
        const next = { ...current }
        editState.present.selectedIds.forEach((id) => delete next[id])
        return next
      })
    }
    dispatchEdit(action)
    setOutputs([])
  }

  useEffect(() => {
    if (mode !== 'custom') return
    setRangeSpec(selectedIdsToRangeSpec(editState.present.selectedIds, editState.present.pages))
  }, [editState.present.pages, mode])

  const handlePreviewTouchEnd = (clientX: number) => {
    if (touchStartXRef.current === null) return
    const distance = clientX - touchStartXRef.current
    touchStartXRef.current = null
    if (Math.abs(distance) < 48) return
    movePreview(distance > 0 ? -1 : 1)
  }

  const handleClearHistory = () => {
    clearHistory()
    setHistoryEntries([])
    setConfirmClearHistory(false)
  }

  const previewPageSelected = previewPage ? (
    previewContext?.mode === 'merge'
      ? mergeSelectedPages.some((page) => page.id === previewPage.id)
      : editState.present.selectedIds.includes(previewPage.id)
  ) : false
  const isBusy = busy !== 'idle'
  const activeOutputs = workspaceMode === 'merge' ? mergeOutputs : outputs
  const splitButtonLabel = busy === 'splitting'
    ? `正在生成 ${progress.current}/${progress.total}`
    : `开始分割 · ${planResult.plan.length || 0} 份`
  const mergeButtonLabel = busy === 'merging'
    ? `正在合并 ${progress.current}/${progress.total}`
    : `生成合并 PDF · ${mergeSelectedPages.length} 页`
  const activeOutputPageCount = activeOutputs.reduce((total, output) => total + output.pageCount, 0)
  const resultFormatLabel = exportFormat === 'pdf' ? 'PDF' : getImageExportLabel(exportFormat)
  const downloadAllLabel = busy === 'zipping'
    ? imageProgress.total > 0 && imageProgress.current < imageProgress.total
      ? `正在生成图片 ${imageProgress.current}/${imageProgress.total}`
      : `正在打包 ${Math.round(zipProgress)}%`
    : `下载 ${resultFormatLabel}`

  return (
    <div className={ui.appShell}>
      <header className={ui.topbar}>
        <div className={ui.brand}>
          <span className={ui.brandMark} aria-hidden="true"><Scissors size={19} /></span>
          <span>PDF 分割工具</span>
        </div>
        <div className={ui.topbarActions}>
          <span className={cx(ui.statusChip, !online && 'border-amber-700/10 bg-amber-soft text-amber-800')}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? '已联网' : '离线可用'}
          </span>
          <button
            className={ui.topButton}
            type="button"
            onClick={() => { setShowHistory(true); setConfirmClearHistory(false) }}
            aria-label={`历史记录，${historyEntries.length} 条`}
            title="历史记录"
          >
            <HistoryIcon size={16} />
            <span>历史</span>
            {historyEntries.length > 0 && (
              <b className="grid min-w-[18px] place-items-center rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                {historyEntries.length}
              </b>
            )}
          </button>
          <button className={ui.topButton} type="button" onClick={handleInstall} aria-label="安装到设备" title="安装到设备">
            <Download size={16} />
            <span>安装</span>
          </button>
        </div>
      </header>

      <main className={ui.workspace}>
        <section className={ui.intro} aria-labelledby="page-title">
          <div>
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5 max-[540px]:gap-2">
              <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-success max-[540px]:text-xs"><ShieldCheck size={16} /> 本地处理，不上传文件</p>
              <span className="flex min-h-6 items-center gap-1 rounded-lg border border-slate-600/10 bg-white/55 px-2 text-[11px] font-semibold text-slate-600 max-[360px]:hidden"><LockKeyhole size={13} /> 无网络传输</span>
            </div>
            <h1 className="m-0 text-4xl leading-[1.16] font-black tracking-[.025em] text-[#333333] max-[900px]:text-[32px] max-[540px]:text-[28px]" id="page-title">拆分 PDF，清楚又利落</h1>
          </div>
          <p className="mb-1 max-w-[390px] text-[15px] leading-relaxed text-slate-600/75 max-[900px]:max-w-[560px] max-[540px]:text-sm">选择一个文件，按固定页数、逐页或自定义范围生成新的 PDF。</p>
        </section>

        <section className="mb-6 rounded-lg border border-white/65 bg-white/55 p-1.5 shadow-[0_10px_28px_rgba(73,137,214,.08)] backdrop-blur-2xl" aria-label="功能模式">
          <div className="grid grid-cols-2 gap-1.5 max-[540px]:grid-cols-1">
            {workspaceOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx(
                  'group flex min-h-[58px] items-center gap-3 rounded-lg px-4 text-left transition-all duration-200 hover:bg-white/75',
                  workspaceMode === option.value ? 'bg-white text-ink shadow-sm' : 'text-muted',
                )}
                onClick={() => {
                  setWorkspaceMode(option.value)
                  setError('')
                  closePagePreview()
                }}
                aria-pressed={workspaceMode === option.value}
                title={option.description}
              >
                <span className={cx('grid size-10 shrink-0 place-items-center rounded-lg', workspaceMode === option.value ? 'bg-brand text-white' : 'bg-slate-100 text-muted group-hover:text-brand')}>
                  {option.value === 'split' ? <Scissors size={18} /> : <Layers3 size={18} />}
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm">{option.label}</strong>
                  <small className="mt-0.5 block truncate text-xs font-normal opacity-75">{option.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        {workspaceMode === 'split' && (!source ? (
          <section
            className={cx(
              ui.glassPanel,
              'relative isolate flex min-h-[356px] animate-surface-enter flex-col items-center justify-center overflow-hidden border-dashed border-brand/40 px-6 py-12 text-center transition-all duration-500 ease-out after:pointer-events-none after:absolute after:inset-3 after:rounded-md after:border after:border-white/60 max-[540px]:min-h-[324px] max-[540px]:px-4.5 max-[540px]:py-10',
              dragActive && 'drag-neon scale-[1.02] border-cyan-300/70 bg-white/55 backdrop-blur-md',
            )}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              void processFile(event.dataTransfer.files[0])
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => void processFile(event.target.files?.[0])}
              className="pointer-events-none absolute size-px opacity-0"
              aria-label="选择 PDF 文件"
            />
            <div className={cx('relative z-10 flex flex-col items-center transition-all duration-500 ease-out', (dragActive || busy === 'loading') && 'pointer-events-none scale-95 opacity-0')}>
              <span className="mb-5 grid size-16 place-items-center rounded-lg border border-brand/15 bg-brand-soft text-brand shadow-[0_10px_22px_rgba(18,100,229,.1)]" aria-hidden="true">
                <Upload size={28} />
              </span>
              <div>
                <h2 className="mb-2 text-[21px] leading-tight font-semibold">拖放 PDF 到这里</h2>
                <p className="mb-6 text-sm leading-relaxed text-muted">或从 Mac、iCloud 云盘及“文件”中选择</p>
              </div>
              <button className={ui.primaryButton} type="button" disabled={isBusy} onClick={() => inputRef.current?.click()}>
                <FileText size={18} /> 选择 PDF
              </button>
            </div>
            {(dragActive || busy === 'loading') && (
              <div className="absolute inset-0 z-20 flex animate-fade-in flex-col items-center justify-center bg-white/15 backdrop-blur-[2px]">
                <div className="relative grid size-24 place-items-center rounded-full bg-white/55 shadow-xl shadow-cyan-500/10 backdrop-blur-xl">
                  <span className="absolute inset-2 animate-spin rounded-full border-[3px] border-cyan-200/60 border-r-violet-500 border-t-blue-500" />
                  <strong className="text-lg font-black text-blue-700">0%</strong>
                </div>
                <p className="mt-5 text-sm font-bold tracking-wide text-slate-700">准备中...</p>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className={cx(ui.glassPanel, 'flex min-h-[76px] animate-surface-enter items-center gap-3.5 px-4 py-3')}>
              <span className="grid size-[42px] shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden="true"><FileCheck2 size={23} /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <strong className="truncate text-sm" title={source.file.name}>{source.file.name}</strong>
                <span className="text-xs text-muted">当前 {editState.present.pages.length} 页{editState.present.pages.length !== source.pageCount ? ` · 原 ${source.pageCount} 页` : ''} · {formatFileSize(source.file.size)}</span>
              </div>
              <button className={ui.iconButton} type="button" onClick={clearAll} disabled={isBusy} aria-label="移除文件" title="移除文件">
                <Trash2 size={18} />
              </button>
            </section>
            {(source.pageCount > 500 || source.file.size > 100 * 1024 * 1024) && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-50/75 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                <Info className="mt-px shrink-0" size={16} /> 文件较大，缩略图会按当前可见页面生成；处理时建议关闭其他占用内存的应用。
              </div>
            )}

            <div className="mt-8 grid grid-cols-[minmax(320px,.78fr)_minmax(0,1.22fr)] items-start gap-7 max-[900px]:grid-cols-1 max-[540px]:mt-6 max-[540px]:gap-5">
              <section className={cx(ui.glassPanel, 'animate-surface-enter px-8 py-7 max-[540px]:px-5 max-[540px]:py-5')} aria-labelledby="split-settings-title">
                <div className={ui.sectionHeading}>
                  <span className={ui.stepNumber}>1</span>
                  <h2 className="text-[17px] leading-tight font-semibold" id="split-settings-title">分割方式</h2>
                </div>

                <div className="mt-7 grid grid-cols-3 gap-2 bg-transparent" role="tablist" aria-label="分割方式">
                  {modeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={mode === option.value}
                      className={cx('h-10 min-w-0 cursor-pointer rounded-full border border-[#e0e0e0] bg-white/45 px-2 text-[13px] font-semibold whitespace-nowrap text-muted transition-all duration-200 hover:border-brand/35 hover:bg-white/75 max-[540px]:text-xs', mode === option.value && 'border-brand/35 bg-brand-soft text-brand shadow-[0_4px_12px_rgba(40,120,232,.12)]')}
                      onClick={() => {
                        setMode(option.value)
                        setOutputs([])
                        setError('')
                        if (option.value === 'custom') {
                          if (editState.present.selectedIds.length > 0) {
                            setRangeSpec(selectedIdsToRangeSpec(editState.present.selectedIds, editState.present.pages))
                          } else {
                            try {
                              dispatchEdit({ type: 'set-selection', ids: rangesToSelectedIds(parseRangeSpec(rangeSpec, editState.present.pages.length), editState.present.pages) })
                            } catch {
                              setRangeSpec('')
                            }
                          }
                        }
                      }}
                      disabled={isBusy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="min-h-[120px] pt-8">
                  {mode === 'fixed' && (
                    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
                      <span>每份页数</span>
                      <div className="flex items-center gap-2.5">
                        <input
                          className="h-11 w-[98px] rounded-lg border border-[#e0e0e0] bg-white/90 px-3 text-base font-semibold text-ink transition-shadow focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
                          type="number"
                          min="1"
                          max={editState.present.pages.length}
                          inputMode="numeric"
                          value={pagesPerFile}
                          onChange={(event) => { setPagesPerFile(event.target.value); setOutputs([]) }}
                          disabled={isBusy}
                        />
                        <span className="text-[13px] font-medium text-muted">页 / 份</span>
                      </div>
                    </label>
                  )}
                  {mode === 'each' && (
                    <div className="flex min-h-[70px] items-center gap-3">
                      <span className="grid size-[34px] place-items-center rounded-lg bg-success-soft text-success"><Check size={18} /></span>
                      <strong className="text-sm">预计 {editState.present.pages.length} 份</strong>
                    </div>
                  )}
                  {mode === 'custom' && (
                    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
                      <span>页码范围</span>
                      <input
                        className="h-11 w-full rounded-lg border border-[#e0e0e0] bg-white/90 px-3 text-ink transition-shadow focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
                        type="text"
                        inputMode="text"
                        value={rangeSpec}
                        placeholder="例如：1-3,5,8-10"
                        onChange={(event) => handleRangeChange(event.target.value)}
                        disabled={isBusy}
                      />
                      <span className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/80 p-1" role="group" aria-label="自定义页面输出方式">
                        <button type="button" className={cx('min-h-9 rounded-md px-2 text-xs font-semibold text-muted', selectionOutputMode === 'segments' && 'bg-white text-ink shadow-sm')} onClick={() => { setSelectionOutputMode('segments'); setOutputs([]) }}>连续段拆分</button>
                        <button type="button" className={cx('min-h-9 rounded-md px-2 text-xs font-semibold text-muted', selectionOutputMode === 'merged' && 'bg-white text-ink shadow-sm')} onClick={() => { setSelectionOutputMode('merged'); setOutputs([]) }}>合并为一份</button>
                      </span>
                    </label>
                  )}
                </div>

                {planResult.error && <p className="mb-3.5 flex items-start gap-2 text-xs leading-relaxed text-danger" role="alert"><Info className="mt-px shrink-0" size={16} /> {planResult.error}</p>}

                <button
                  className={cx(ui.primaryButton, 'w-full')}
                  type="button"
                  onClick={handleSplit}
                  disabled={isBusy || Boolean(planResult.error) || planResult.plan.length === 0}
                >
                  {busy === 'splitting' ? <RefreshCw className="animate-spin" size={18} /> : <Scissors size={18} />}
                  {splitButtonLabel}
                </button>
                {busy === 'splitting' && (
                  <div className="mt-3 h-1 overflow-hidden rounded-sm bg-slate-200" aria-label="分割进度">
                    <span className="block h-full bg-brand transition-[width] duration-200" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
                  </div>
                )}
              </section>

              <section className={cx(ui.glassPanel, 'min-w-0 animate-surface-enter p-6 [animation-delay:40ms] max-[540px]:p-4.5')} aria-labelledby="preview-title">
                <div className="flex items-center justify-between gap-3">
                  <div className={ui.sectionHeading}>
                    <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-coral-soft text-sm font-bold text-coral">2</span>
                    <div><h2 className="text-[17px] leading-tight font-semibold" id="preview-title">页面</h2><p className="mt-1 text-xs text-muted">{editState.present.pages.length} 页{editState.present.selectedIds.length > 0 ? ` · 已选 ${editState.present.selectedIds.length}` : ''}</p></div>
                  </div>
                  <button className={cx('tooltip-button relative grid size-11 place-items-center rounded-lg border transition-colors', editorExpanded ? 'border-brand/20 bg-brand-soft text-brand' : 'border-black/10 bg-white/60 text-muted hover:text-brand')} type="button" onClick={() => setEditorExpanded((expanded) => !expanded)} aria-expanded={editorExpanded} aria-label={editorExpanded ? '收起页面编辑工具' : '展开页面编辑工具'} title={editorExpanded ? '收起编辑' : '编辑页面'}>
                    <Settings2 size={19} />
                    {editState.past.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-white" aria-label="已有页面编辑" />}
                  </button>
                </div>
                {editorExpanded && <div className="mt-4 flex animate-fade-in flex-wrap items-center gap-1.5 rounded-lg border border-black/8 bg-white/45 p-2">
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-brand hover:bg-brand-soft" type="button" onClick={handleToggleAllPages} aria-label={editState.present.selectedIds.length === editState.present.pages.length ? '取消全选' : '全选页面'} title={editState.present.selectedIds.length === editState.present.pages.length ? '取消全选' : '全选'}><ListChecks size={18} /></button>
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-white hover:text-brand disabled:opacity-35" type="button" onClick={() => applyPageEdit({ type: 'rotate', direction: -1 })} disabled={isBusy || editState.present.selectedIds.length === 0} aria-label="所选页面向左旋转" title="向左旋转"><RotateCcw size={18} /></button>
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-white hover:text-brand disabled:opacity-35" type="button" onClick={() => applyPageEdit({ type: 'rotate', direction: 1 })} disabled={isBusy || editState.present.selectedIds.length === 0} aria-label="所选页面向右旋转" title="向右旋转"><RotateCw size={18} /></button>
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-35" type="button" onClick={() => applyPageEdit({ type: 'delete-selected' })} disabled={isBusy || editState.present.selectedIds.length === 0} aria-label="删除所选页面" title="删除"><Trash2 size={18} /></button>
                  <span className="mx-1 h-6 w-px bg-black/10" aria-hidden="true" />
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-white hover:text-brand disabled:opacity-35" type="button" onClick={() => applyPageEdit({ type: 'undo' })} disabled={isBusy || editState.past.length === 0} aria-label="撤销页面编辑" title="撤销"><Undo2 size={18} /></button>
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-white hover:text-brand disabled:opacity-35" type="button" onClick={() => applyPageEdit({ type: 'redo' })} disabled={isBusy || editState.future.length === 0} aria-label="重做页面编辑" title="重做"><Redo2 size={18} /></button>
                  <span className="mx-1 h-6 w-px bg-black/10" aria-hidden="true" />
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-white hover:text-brand disabled:opacity-35" type="button" onClick={() => void handleExportEdited()} disabled={isBusy || editState.present.pages.length === 0} aria-label="导出编辑后的完整 PDF" title="导出完整 PDF"><FileOutput size={18} /></button>
                  <button className="tooltip-button grid size-10 place-items-center rounded-md text-muted hover:bg-white hover:text-brand disabled:opacity-35" type="button" onClick={() => applyPageEdit({ type: 'restore' })} disabled={isBusy} aria-label="恢复原始页面" title="恢复原始"><ListRestart size={18} /></button>
                </div>}
                <PageEditorGrid
                  pages={editState.present.pages}
                  selectedIds={editState.present.selectedIds}
                  thumbnails={thumbnails}
                  disabled={isBusy}
                  editing={editorExpanded}
                  showSelection={mode === 'custom' || editorExpanded}
                  onToggle={handleTogglePage}
                  onMove={(activeId, overId) => applyPageEdit({ type: 'move', activeId, overId })}
                  onMoveTo={(id, position) => applyPageEdit({ type: 'move-to', id, position })}
                  onOpen={(id) => {
                    const index = editState.present.pages.findIndex((page) => page.id === id)
                    if (index >= 0) setPreviewContext({ pages: editState.present.pages, index, label: source.file.name, mode: 'split' })
                  }}
                  onRequestThumbnail={requestThumbnail}
                />
              </section>
            </div>
          </>
        ))}

        {workspaceMode === 'merge' && (
          <>
            <section
              className={cx(
                ui.glassPanel,
                'relative isolate flex min-h-[220px] animate-surface-enter flex-col items-center justify-center overflow-hidden border-dashed border-brand/35 px-6 py-8 text-center transition-all duration-300 max-[540px]:px-4.5',
                mergeDragActive && 'drag-neon scale-[1.01] border-cyan-300/70 bg-white/60',
              )}
              onDragEnter={(event) => { event.preventDefault(); setMergeDragActive(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) setMergeDragActive(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setMergeDragActive(false)
                void processMergeFiles(event.dataTransfer.files)
              }}
            >
              <input
                ref={mergeInputRef}
                type="file"
                multiple
                accept="application/pdf,.pdf"
                onChange={(event) => void processMergeFiles(event.target.files ?? undefined)}
                className="pointer-events-none absolute size-px opacity-0"
                aria-label="选择多个 PDF 文件"
              />
              <span className="mb-4 grid size-14 place-items-center rounded-lg border border-brand/15 bg-brand-soft text-brand" aria-hidden="true">
                <Layers3 size={26} />
              </span>
              <h2 className="mb-2 text-[21px] leading-tight font-semibold">上传多个 PDF</h2>
              <p className="mb-5 max-w-[520px] text-sm leading-relaxed text-muted">从每个 PDF 勾选需要的页面，再在待合并清单中拖拽调整最终顺序。</p>
              <button className={ui.primaryButton} type="button" disabled={isBusy} onClick={() => mergeInputRef.current?.click()} title="添加一个或多个 PDF 文件">
                <Upload size={18} /> 添加 PDF
              </button>
              {busy === 'loading' && <p className="mt-4 text-sm font-semibold text-brand">正在读取 PDF...</p>}
            </section>

            {mergeSources.length > 0 && (
              <div className="mt-8 grid grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)] items-start gap-7 max-[980px]:grid-cols-1 max-[540px]:mt-6 max-[540px]:gap-5">
                <section className={cx(ui.glassPanel, 'min-w-0 animate-surface-enter p-6 max-[540px]:p-4.5')} aria-labelledby="merge-sources-title">
                  <div className="flex items-start justify-between gap-4">
                    <div className={ui.sectionHeading}>
                      <span className={ui.stepNumber}>1</span>
                      <div>
                        <h2 className="text-[17px] leading-tight font-semibold" id="merge-sources-title">选择页面</h2>
                        <p className="mt-1 text-xs text-muted">{mergeSources.length} 个 PDF · 已选 {mergeSelectedPages.length} 页</p>
                      </div>
                    </div>
                    <button className={ui.secondaryButton} type="button" onClick={() => mergeInputRef.current?.click()} disabled={isBusy} title="继续添加 PDF">
                      <Upload size={16} /> 添加
                    </button>
                  </div>
                  <div className="mt-5 flex flex-col gap-5">
                    {mergeSources.map((mergeSource) => {
                      const pages = createMergePages(mergeSource)
                      const selectedIds = mergeSelectedPages.filter((page) => page.sourceId === mergeSource.id).map((page) => page.id)
                      return (
                        <section className="rounded-lg border border-black/10 bg-white/45 p-4" key={mergeSource.id} aria-label={mergeSource.name}>
                          <div className="mb-3 flex items-center gap-3">
                            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><FileText size={18} /></span>
                            <div className="min-w-0 flex-1">
                              <strong className="block truncate text-sm" title={mergeSource.name}>{mergeSource.name}</strong>
                              <span className="text-xs text-muted">{mergeSource.pageCount} 页 · {formatFileSize(mergeSource.file.size)}</span>
                            </div>
                            <button className={ui.iconButton} type="button" onClick={() => removeMergeSource(mergeSource.id)} disabled={isBusy} aria-label={`移除 ${mergeSource.name}`} title="移除文件"><Trash2 size={18} /></button>
                          </div>
                          <PageEditorGrid
                            pages={pages}
                            selectedIds={selectedIds}
                            thumbnails={thumbnails}
                            disabled={isBusy}
                            editing={false}
                            showSelection
                            onToggle={(id) => {
                              const page = pages.find((item) => item.id === id)
                              if (page) handleToggleMergePage(page)
                            }}
                            onMove={() => undefined}
                            onMoveTo={() => undefined}
                            onOpen={(id) => {
                              const index = pages.findIndex((page) => page.id === id)
                              if (index >= 0) setPreviewContext({ pages, index, label: mergeSource.name, mode: 'merge' })
                            }}
                            onRequestThumbnail={requestThumbnail}
                          />
                        </section>
                      )
                    })}
                  </div>
                </section>

                <section className={cx(ui.glassPanel, 'sticky top-24 min-w-0 animate-surface-enter p-6 max-[980px]:static max-[540px]:p-4.5')} aria-labelledby="merge-order-title">
                  <div className="flex items-start justify-between gap-3">
                    <div className={ui.sectionHeading}>
                      <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-coral-soft text-sm font-bold text-coral">2</span>
                      <div>
                        <h2 className="text-[17px] leading-tight font-semibold" id="merge-order-title">调整顺序</h2>
                        <p className="mt-1 text-xs text-muted">拖拽页面决定最终 PDF 顺序</p>
                      </div>
                    </div>
                    <button className={ui.secondaryButton} type="button" onClick={() => { setMergeSelectedPages([]); setMergeOutputs([]) }} disabled={isBusy || mergeSelectedPages.length === 0} title="清空待合并页面">
                      <Trash2 size={16} /> 清空
                    </button>
                  </div>
                  {mergeSelectedPages.length === 0 ? (
                    <div className="mt-5 grid min-h-[240px] place-items-center rounded-lg border border-dashed border-black/12 bg-white/40 px-6 text-center text-sm text-muted">
                      勾选左侧页面后，会出现在这里
                    </div>
                  ) : (
                    <PageEditorGrid
                      pages={mergeSelectedPages}
                      selectedIds={mergeSelectedPages.map((page) => page.id)}
                      thumbnails={thumbnails}
                      disabled={isBusy}
                      editing
                      showSelection
                      onToggle={(id) => {
                        setMergeSelectedPages((current) => current.filter((page) => page.id !== id))
                        setMergeOutputs([])
                      }}
                      onMove={moveMergePage}
                      onMoveTo={moveMergePageTo}
                      onOpen={(id) => {
                        const index = mergeSelectedPages.findIndex((page) => page.id === id)
                        if (index >= 0) setPreviewContext({ pages: mergeSelectedPages, index, label: '待合并页面', mode: 'merge' })
                      }}
                      onRequestThumbnail={requestThumbnail}
                    />
                  )}
                  <button
                    className={cx(ui.primaryButton, 'mt-5 w-full')}
                    type="button"
                    onClick={() => void handleMergeSelected()}
                    disabled={isBusy || mergeSelectedPages.length === 0}
                    title="按当前顺序生成一个合并后的 PDF"
                  >
                    {busy === 'merging' ? <RefreshCw className="animate-spin" size={18} /> : <FileOutput size={18} />}
                    {mergeButtonLabel}
                  </button>
                  {busy === 'merging' && (
                    <div className="mt-3 h-1 overflow-hidden rounded-sm bg-slate-200" aria-label="合并进度">
                      <span className="block h-full bg-brand transition-[width] duration-200" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}

        {error && <div className="mt-4 flex min-h-12 items-center gap-2.5 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger shadow-[0_8px_20px_rgba(196,65,53,.07)]" role="alert"><Info size={18} /><span className="flex-1">{error}</span><button className="grid size-9 place-items-center rounded-md border-0 bg-transparent" type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={17} /></button></div>}

        {activeOutputs.length > 0 && (
          <section ref={resultsRef} className={cx(ui.glassPanel, 'mx-auto mt-6 max-w-[960px] scroll-mt-20 animate-success-morph border-emerald-100/60 bg-[linear-gradient(135deg,rgba(236,253,245,.72),rgba(255,251,235,.66),rgba(255,255,255,.5))] p-6 max-[540px]:p-4.5')} aria-labelledby="results-title">
            <div className="flex items-center justify-between gap-6 max-[540px]:flex-col max-[540px]:items-stretch">
              <div className={ui.sectionHeading}>
                <span className="grid size-11 shrink-0 animate-success-pop place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"><Check size={22} /></span>
                <div><h2 className="mb-1 text-[17px] leading-tight font-semibold" id="results-title">{workspaceMode === 'merge' ? '合并完成' : '分割完成'}</h2><p className="text-xs text-muted">已生成 {activeOutputs.length} 个 PDF 文件 · 共 {activeOutputPageCount} 页</p></div>
              </div>
              <div className="flex shrink-0 items-center gap-2 max-[720px]:flex-wrap max-[540px]:w-full">
                <div className="grid min-h-11 grid-cols-3 gap-1 rounded-lg bg-white/70 p-1 shadow-sm" role="group" aria-label="导出格式">
                  {exportFormatOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cx(
                        'min-w-14 rounded-md px-2 text-xs font-semibold text-muted transition-colors duration-200 hover:bg-white hover:text-brand disabled:opacity-50',
                        exportFormat === option.value && 'bg-brand text-white shadow-sm hover:bg-brand hover:text-white',
                      )}
                      onClick={() => setExportFormat(option.value)}
                      disabled={isBusy}
                      aria-pressed={exportFormat === option.value}
                      title={option.description}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button className={cx(ui.primaryButton, 'shrink-0 rounded-full bg-[linear-gradient(135deg,#1264e5,#3b82f6,#22d3ee)] px-6 shadow-lg shadow-blue-500/20 hover:bg-[linear-gradient(135deg,#0f55c7,#2563eb,#06b6d4)] max-[540px]:flex-1')} type="button" onClick={() => void handleDownloadAll()} disabled={isBusy} title={exportFormat === 'pdf' ? '把生成的 PDF 打包下载' : `导出为 ${resultFormatLabel} 图片`}>
                  {busy === 'zipping' ? <RefreshCw className="animate-spin" size={18} /> : exportFormat === 'pdf' ? <Archive size={18} /> : <FileImage size={18} />}
                  {downloadAllLabel}
                </button>
              </div>
            </div>
            <div className="mt-5 border-t border-black/10">
              {activeOutputs.map((output, index) => {
                const remainder = workspaceMode === 'split' && isRemainderOutput(outputs, index, mode, chunkSize)
                return (
                <div className="group flex min-h-[72px] animate-surface-enter items-center gap-3 border-b border-black/10 py-3 max-[540px]:flex-wrap max-[540px]:items-start" key={output.name}>
                  <span className={cx('grid size-[38px] shrink-0 place-items-center rounded-lg bg-success-soft text-success transition-all duration-200', remainder && 'border border-dashed border-amber-400/60 bg-amber-50 text-amber-700 opacity-80')}><FileText size={18} /></span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 max-[540px]:pt-1">
                    <strong className="truncate text-sm">{output.name}</strong>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {output.pageCount} 页 · {formatFileSize(output.bytes.byteLength)}
                      {remainder && <em className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold not-italic text-amber-700">剩余页</em>}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 max-[540px]:ml-[50px] max-[540px]:w-[calc(100%-50px)]">
                    <div className="flex items-center gap-1 opacity-100 transition-opacity duration-200 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100">
                      <button className="tooltip-button grid size-10 place-items-center rounded-lg border border-black/10 bg-white/65 text-muted transition-all duration-200 hover:bg-brand-soft hover:text-brand" type="button" onClick={() => void handleCopyOutput(output)} aria-label={`复制 ${output.name}`} title="复制 PDF"><Copy size={17} /></button>
                      <button className="tooltip-button grid size-10 place-items-center rounded-lg border border-black/10 bg-white/65 text-muted transition-all duration-200 hover:bg-brand-soft hover:text-brand" type="button" onClick={() => openOutputPreview(output)} aria-label={`预览 ${output.name}`} title="快速预览"><Eye size={18} /></button>
                    </div>
                    <button className="tooltip-button inline-flex min-h-11 min-w-[88px] items-center justify-center gap-2 rounded-lg bg-brand-soft px-3 text-[13px] font-semibold text-brand transition-colors duration-200 hover:bg-blue-100 disabled:opacity-50" type="button" onClick={() => void handleDownloadOutput(output)} disabled={isBusy} aria-label={`下载 ${output.name}`} title={exportFormat === 'pdf' ? '下载 PDF' : `下载 ${resultFormatLabel} 图片`}>
                      <Download size={17} /> <span>下载</span>
                    </button>
                    <button className="tooltip-button inline-flex min-h-11 min-w-[80px] items-center justify-center gap-2 rounded-lg bg-transparent px-2 text-[13px] font-semibold text-brand transition-colors duration-200 hover:bg-brand-soft" type="button" onClick={() => void handleShareOutput(output)} aria-label={`分享 ${output.name}`} title="分享 PDF">
                      <Share2 size={17} /> <span>分享</span>
                    </button>
                  </div>
                </div>
              )})}
            </div>
            <button className={cx(ui.secondaryButton, 'mt-5 max-[540px]:w-full')} type="button" onClick={workspaceMode === 'merge' ? clearMergeWorkspace : clearAll} title={workspaceMode === 'merge' ? '清空多 PDF 合并工作区' : '重新选择 PDF 文件'}>
              <PackageOpen size={18} /> {workspaceMode === 'merge' ? '处理另一组合并' : '处理另一个文件'}
            </button>
          </section>
        )}
      </main>

      <footer className="flex min-h-[58px] items-center justify-center gap-2 px-6 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] text-center text-xs text-faint max-[540px]:px-4"><ShieldCheck size={14} /> PDF 不会上传或保留；仅操作记录保存在当前设备</footer>

      {showHistory && (
        <div className="fixed inset-0 z-60 flex animate-fade-in justify-end bg-slate-950/45 backdrop-blur-[10px]" role="presentation" onMouseDown={() => setShowHistory(false)}>
          <aside className="flex h-full w-[min(430px,100%)] animate-drawer-enter flex-col border-l border-white/70 bg-[#f8fafd]/95 shadow-[-18px_0_54px_rgba(16,24,35,.2)] backdrop-blur-[30px] backdrop-saturate-150 max-[540px]:w-full max-[540px]:border-l-0" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex min-h-[92px] items-center justify-between gap-4 border-b border-black/10 px-5.5 pt-[max(22px,env(safe-area-inset-top))] pb-4.5">
              <div>
                <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-brand"><CalendarClock size={15} /> 当前设备</p>
                <h2 className="mt-1 text-[23px] font-bold" id="history-title">历史记录</h2>
              </div>
              <button className={ui.iconButton} type="button" onClick={() => setShowHistory(false)} aria-label="关闭历史记录"><X size={19} /></button>
            </div>
            <div className="mx-4.5 mt-4 flex items-start gap-2 rounded-lg border border-brand/10 bg-brand-soft p-3 text-xs leading-relaxed text-slate-600"><LockKeyhole className="mt-px shrink-0" size={16} /><span>这里只保存操作信息，不保存原始或输出 PDF。</span></div>
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4.5 pt-3.5 pb-5">
              {historyEntries.length === 0 ? (
                <div className="my-auto flex flex-col items-center px-5 py-9 text-center text-muted">
                  <span className="mb-3.5 grid size-[50px] place-items-center rounded-lg bg-brand-soft text-brand"><HistoryIcon size={24} /></span>
                  <strong className="text-[15px] text-ink">还没有历史记录</strong>
                  <p className="mt-2 max-w-[260px] text-xs leading-relaxed">成功完成一次分割后，记录会保存在这台设备。</p>
                </div>
              ) : historyEntries.map((entry) => (
                <article className="relative flex min-h-[108px] animate-history-enter gap-3 overflow-hidden rounded-lg border border-black/10 bg-white/75 py-3.5 pr-2.5 pl-4 shadow-[0_7px_20px_rgba(31,43,58,.055)]" key={entry.id}>
                  <span className={cx('absolute inset-y-0 left-0 w-1 bg-brand', entry.mode === 'each' && 'bg-success', entry.mode === 'custom' && 'bg-coral')} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="truncate text-sm" title={entry.sourceName}>{entry.sourceName}</strong>
                      <time className="shrink-0 text-[11px] text-faint" dateTime={entry.createdAt}>{dateFormatter.format(new Date(entry.createdAt))}</time>
                    </div>
                    <p className="my-2 text-xs text-muted">{entry.modeSummary}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-muted">{entry.pageCount} 页</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-muted">{entry.outputCount} 份</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-muted">{formatFileSize(entry.outputBytes)}</span>
                    </div>
                  </div>
                  <button
                    className={cx(ui.iconButton, 'size-[34px]')}
                    type="button"
                    onClick={() => setHistoryEntries(removeHistory(entry.id))}
                    aria-label={`删除 ${entry.sourceName} 的记录`}
                    title="删除记录"
                  ><Trash2 size={16} /></button>
                </article>
              ))}
            </div>
            {historyEntries.length > 0 && (
              <div className="border-t border-black/10 px-4.5 pt-3.5 pb-[max(18px,env(safe-area-inset-bottom))]">
                {confirmClearHistory ? (
                  <div className="flex min-h-[42px] items-center gap-2">
                    <span className="flex-1 text-xs text-muted">确定清空全部记录？</span>
                    <button className="min-h-9 rounded-md border-0 bg-danger px-3 text-sm text-white" type="button" onClick={handleClearHistory}>清空</button>
                    <button className="min-h-9 rounded-md border-0 bg-slate-200 px-3 text-sm text-ink" type="button" onClick={() => setConfirmClearHistory(false)}>取消</button>
                  </div>
                ) : (
                  <button className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-danger/15 bg-transparent text-sm text-danger" type="button" onClick={() => setConfirmClearHistory(true)}><Trash2 size={16} /> 清空全部记录</button>
                )}
                <small className="mt-2 block text-center text-[11px] text-faint">自动保留最近 30 天，最多 20 条</small>
              </div>
            )}
          </aside>
        </div>
      )}

      {previewPage && previewContext && (
        <div
          className="fixed inset-0 z-70 grid animate-fade-in place-items-center bg-[#0a0f16]/85 p-[max(18px,env(safe-area-inset-top))_max(18px,env(safe-area-inset-right))_max(18px,env(safe-area-inset-bottom))_max(18px,env(safe-area-inset-left))] backdrop-blur-[10px] max-[540px]:p-0"
          role="presentation"
          onMouseDown={closePagePreview}
          onTouchStart={(event) => { touchStartXRef.current = event.changedTouches[0]?.clientX ?? null }}
          onTouchEnd={(event) => handlePreviewTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
        >
          <div className="relative flex h-full w-[min(1180px,100%)] animate-preview-enter flex-col overflow-hidden rounded-lg border border-white/10 bg-[#1a212b]/90 shadow-[0_30px_90px_rgba(0,0,0,.4)] max-[540px]:rounded-none max-[540px]:border-0" role="dialog" aria-modal="true" aria-label={`当前第 ${previewContext.index + 1} 页高清预览`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-white/10 bg-[#10161e]/75 py-2 pr-2.5 pl-4.5 text-white">
              <span className="min-w-0 text-[13px] font-semibold">
                <strong className="block truncate">{previewContext?.label}</strong>
                <small className="font-normal text-white/65">{previewContext.index + 1} / {previewContext.pages.length} · 原第 {previewPage.sourcePageIndex + 1} 页{previewPage.rotation ? ` · 旋转 ${previewPage.rotation}°` : ''}</small>
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className={cx(
                    'grid size-11 place-items-center rounded-lg border transition-colors',
                    previewPageSelected ? 'border-brand bg-brand text-white' : 'border-white/15 bg-white/10 text-white hover:bg-white/20',
                  )}
                  type="button"
                  onClick={() => {
                    if (previewContext.mode === 'merge' && previewPage.sourceId && previewPage.sourceName) {
                      handleToggleMergePage(previewPage as MergePage)
                    } else {
                      handleTogglePage(previewPage.id)
                    }
                  }}
                  aria-pressed={previewPageSelected}
                  aria-label={previewPageSelected ? '取消选中当前页面' : '选中当前页面'}
                  title={previewPageSelected ? '取消选中' : '选中本页'}
                >
                  <Check size={17} />
                </button>
                <button className="tooltip-button grid size-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/10" type="button" onClick={closePagePreview} aria-label="关闭高清预览" title="关闭"><X size={20} /></button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto px-[72px] py-5 max-[540px]:p-3">
              {previewLoading && <div className="flex items-center gap-2.5 text-[13px] text-white/75"><RefreshCw className="animate-spin" size={24} /><span>正在生成高清预览</span></div>}
              {previewImage && <img className="block max-h-full max-w-full animate-preview-image-enter bg-white shadow-[0_18px_46px_rgba(0,0,0,.34)] max-[540px]:max-h-[calc(100vh-118px)]" src={previewImage} alt={`当前第 ${previewContext.index + 1} 页高清预览`} />}
            </div>
            <button className="tooltip-button absolute top-1/2 left-3.5 z-2 grid size-[46px] -translate-y-1/2 place-items-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-20 max-[540px]:top-auto max-[540px]:bottom-[max(12px,env(safe-area-inset-bottom))] max-[540px]:left-[calc(50%-52px)] max-[540px]:size-[42px] max-[540px]:translate-y-0 max-[540px]:bg-[#10161e]/80" type="button" onClick={() => movePreview(-1)} disabled={previewContext.index === 0} aria-label="上一页" title="上一页"><ChevronLeft size={24} /></button>
            <button className="tooltip-button absolute top-1/2 right-3.5 z-2 grid size-[46px] -translate-y-1/2 place-items-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-20 max-[540px]:top-auto max-[540px]:right-[calc(50%-52px)] max-[540px]:bottom-[max(12px,env(safe-area-inset-bottom))] max-[540px]:size-[42px] max-[540px]:translate-y-0 max-[540px]:bg-[#10161e]/80" type="button" onClick={() => movePreview(1)} disabled={previewContext.index === previewContext.pages.length - 1} aria-label="下一页" title="下一页"><ChevronRight size={24} /></button>
          </div>
        </div>
      )}

      {copyNotice && (
        <div className={ui.toast} role="status" aria-live="polite">
          <Check size={18} />
          <span className="flex-1">{copyNotice}</span>
          <button className="grid size-9 place-items-center rounded-md border-0 bg-transparent text-white/75" type="button" onClick={() => setCopyNotice('')} aria-label="关闭提示"><X size={16} /></button>
        </div>
      )}

      {needRefresh && (
        <div className={ui.toast} role="status">
          <RefreshCw size={18} />
          <span className="flex-1">新版本已准备好</span>
          <button className="h-9 rounded-md border-0 bg-brand px-3 font-semibold text-white" type="button" onClick={() => void updateServiceWorker(true)}>立即更新</button>
          <button className="grid size-9 place-items-center rounded-md border-0 bg-transparent text-white/75" type="button" onClick={() => setNeedRefresh(false)} aria-label="稍后更新"><X size={16} /></button>
        </div>
      )}

      {showInstallHelp && (
        <div className="fixed inset-0 z-75 grid animate-fade-in place-items-center bg-slate-950/45 p-5 backdrop-blur-[10px]" role="presentation" onMouseDown={() => setShowInstallHelp(false)}>
          <div className="relative w-[min(420px,100%)] animate-preview-enter rounded-lg border border-white/70 bg-white/95 p-7 text-center shadow-raised" role="dialog" aria-modal="true" aria-labelledby="install-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className={cx(ui.iconButton, 'absolute top-2.5 right-2.5')} type="button" onClick={() => setShowInstallHelp(false)} aria-label="关闭"><X size={18} /></button>
            <span className="mx-auto mb-4 grid size-[52px] place-items-center rounded-lg bg-brand-soft text-brand"><Download size={24} /></span>
            <h2 className="text-[21px] font-semibold" id="install-title">安装到设备</h2>
            <div className="my-5 text-left text-sm leading-relaxed text-muted">
              <p className="border-t border-black/10 py-3"><strong>iPhone：</strong>在 Safari 中点击“分享”，再选择“添加到主屏幕”。</p>
              <p className="border-y border-black/10 py-3"><strong>Mac：</strong>在 Safari 的“文件”菜单中选择“添加到程序坞”。</p>
            </div>
            <button className={ui.primaryButton} type="button" onClick={() => setShowInstallHelp(false)}>知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
