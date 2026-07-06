import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  FileText,
  History as HistoryIcon,
  Info,
  LockKeyhole,
  Maximize2,
  PackageOpen,
  RefreshCw,
  Scissors,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { copyPdfToClipboard, createZip, shareOrDownloadPdf, triggerDownload } from './lib/download'
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
  renderThumbnails,
  type Thumbnail,
} from './lib/pdfPreview'
import {
  createSplitPlan,
  getPdfBaseName,
  PdfSplitError,
  splitPdf,
  type PageRange,
  type SplitMode,
  type SplitOutput,
} from './lib/pdfSplitter'
import { createPreviewGroups, getAdjacentPreviewPage, isRemainderOutput } from './lib/uiLogic'

interface SourcePdf {
  file: File
  bytes: Uint8Array
  pageCount: number
}

type BusyState = 'idle' | 'loading' | 'splitting' | 'zipping'

interface PreviewContext {
  page: number
  range: PageRange
  label: string
}

const modeOptions: Array<{ value: SplitMode; label: string; description: string }> = [
  { value: 'fixed', label: '每 N 页', description: '按固定页数分组' },
  { value: 'each', label: '逐页分割', description: '每页单独生成' },
  { value: 'custom', label: '自定义', description: '指定页码范围' },
]

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const ui = {
  appShell: 'relative isolate flex min-h-screen flex-col overflow-x-hidden bg-canvas text-ink before:absolute before:inset-x-0 before:top-16 before:-z-10 before:h-[300px] before:border-b before:border-brand/10 before:bg-[#dfeaff] max-[540px]:before:top-[58px] max-[540px]:before:h-[285px]',
  topbar: 'sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/8 bg-[#f8fbff]/80 px-6 py-3 shadow-[0_4px_18px_rgba(31,43,58,.045)] backdrop-blur-[22px] backdrop-saturate-150 [padding-left:max(24px,env(safe-area-inset-left))] [padding-right:max(24px,env(safe-area-inset-right))] [padding-top:max(12px,env(safe-area-inset-top))] max-[540px]:h-[58px] max-[540px]:px-3.5 max-[540px]:[padding-left:max(14px,env(safe-area-inset-left))] max-[540px]:[padding-right:max(14px,env(safe-area-inset-right))]',
  brand: 'flex items-center gap-2.5 whitespace-nowrap text-[15px] font-semibold max-[540px]:text-sm max-[360px]:[&>span:last-child]:hidden',
  brandMark: 'grid size-[34px] place-items-center rounded-lg bg-brand text-white shadow-[0_8px_18px_rgba(18,100,229,.23)]',
  topbarActions: 'flex items-center gap-2.5 max-[540px]:gap-2',
  statusChip: 'flex min-h-8 items-center gap-1.5 rounded-lg border border-success/10 bg-success-soft/90 px-2.5 text-xs font-semibold text-success max-[540px]:hidden',
  topButton: 'flex h-9 items-center gap-1.5 rounded-lg border border-black/10 bg-white/70 px-2.5 text-sm text-ink shadow-[0_3px_10px_rgba(31,43,58,.04)] transition-all duration-200 hover:-translate-y-px hover:bg-white hover:shadow-[0_6px_16px_rgba(31,43,58,.08)] max-[540px]:size-10 max-[540px]:justify-center max-[540px]:px-2 max-[540px]:[&>span]:hidden',
  workspace: 'mx-auto w-[min(1120px,calc(100%-48px))] flex-1 animate-page-enter py-13 pb-16 max-[900px]:w-[min(740px,calc(100%-32px))] max-[900px]:pt-10 max-[540px]:w-[calc(100%-24px)] max-[540px]:py-7.5 max-[540px]:pb-12',
  glassPanel: 'rounded-lg border border-white/70 bg-white/75 shadow-glass backdrop-blur-3xl backdrop-saturate-150',
  intro: 'mb-7 flex items-end justify-between gap-8 max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-3 max-[540px]:mb-5.5',
  sectionHeading: 'flex items-center gap-3',
  iconButton: 'grid size-10 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted transition-all duration-200 hover:bg-danger-soft hover:text-danger active:scale-95 disabled:pointer-events-none disabled:opacity-40',
  primaryButton: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-0 bg-brand px-5 font-semibold text-white shadow-[0_8px_18px_rgba(18,100,229,.2)] transition-all duration-200 hover:-translate-y-px hover:bg-brand-hover hover:shadow-[0_11px_23px_rgba(18,100,229,.26)] active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  secondaryButton: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-black/10 bg-slate-200/80 px-4 font-semibold text-ink transition-all duration-200 active:scale-[.98]',
  stepNumber: 'grid size-[34px] shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white shadow-[0_7px_15px_rgba(18,100,229,.16)]',
  thumbnail: 'group/thumb relative m-0 min-w-0 cursor-zoom-in overflow-hidden rounded-[5px] border-0 bg-white p-0 shadow-[0_6px_18px_rgba(31,43,58,.1)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(31,43,58,.16)]',
  toast: 'fixed bottom-[max(22px,env(safe-area-inset-bottom))] left-1/2 z-80 flex min-h-13 -translate-x-1/2 items-center gap-2.5 rounded-lg bg-[#262a31] px-3.5 py-2 text-[13px] text-white shadow-[0_14px_38px_rgba(0,0,0,.22)] animate-fade-in max-[540px]:bottom-[max(12px,env(safe-area-inset-bottom))] max-[540px]:w-[calc(100%-24px)]',
}

function getErrorMessage(error: unknown): string {
  if (error instanceof PdfSplitError || error instanceof Error) return error.message
  return '操作失败，请重新选择文件后再试'
}

function App() {
  const [source, setSource] = useState<SourcePdf | null>(null)
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([])
  const [mode, setMode] = useState<SplitMode>('fixed')
  const [pagesPerFile, setPagesPerFile] = useState('5')
  const [rangeSpec, setRangeSpec] = useState('')
  const [outputs, setOutputs] = useState<SplitOutput[]>([])
  const [busy, setBusy] = useState<BusyState>('idle')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [zipProgress, setZipProgress] = useState(0)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(() => loadHistory())
  const [showHistory, setShowHistory] = useState(false)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [previewContext, setPreviewContext] = useState<PreviewContext | null>(null)
  const [previewImage, setPreviewImage] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const previewDocumentRef = useRef<PDFDocumentProxy | null>(null)
  const thumbnailUrlsRef = useRef<string[]>([])
  const pagePreviewUrlRef = useRef('')
  const pagePreviewGenerationRef = useRef(0)
  const touchStartXRef = useRef<number | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const previewPage = previewContext?.page ?? null

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
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    thumbnailUrlsRef.current = []
    setThumbnails([])
    if (previewDocumentRef.current) void previewDocumentRef.current.destroy()
    previewDocumentRef.current = null
    closePagePreview()
  }, [closePagePreview])

  const clearAll = useCallback(() => {
    cleanupPreview()
    setSource(null)
    setOutputs([])
    setError('')
    setBusy('idle')
    setProgress({ current: 0, total: 0 })
    setZipProgress(0)
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
    thumbnailUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    if (pagePreviewUrlRef.current) URL.revokeObjectURL(pagePreviewUrlRef.current)
    if (previewDocumentRef.current) void previewDocumentRef.current.destroy()
  }, [])

  useEffect(() => {
    if (previewPage === null || !previewDocumentRef.current) return
    const previewGeneration = pagePreviewGenerationRef.current + 1
    pagePreviewGenerationRef.current = previewGeneration
    if (pagePreviewUrlRef.current) URL.revokeObjectURL(pagePreviewUrlRef.current)
    pagePreviewUrlRef.current = ''
    setPreviewImage('')
    setPreviewLoading(true)

    const targetWidth = Math.min(window.innerWidth - 48, 1120)
    void renderPagePreview(
      previewDocumentRef.current,
      previewPage,
      targetWidth,
      () => previewGeneration !== pagePreviewGenerationRef.current,
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
    const dialogOpen = showHistory || previewPage !== null || showInstallHelp
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
    if (!showHistory && previewPage === null) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewPage !== null) closePagePreview()
        else setShowHistory(false)
      }
      if (previewContext) {
        if (event.key === 'ArrowLeft') {
          setPreviewContext((current) => current && ({
            ...current,
            page: getAdjacentPreviewPage(current.page, -1, current.range),
          }))
        }
        if (event.key === 'ArrowRight') {
          setPreviewContext((current) => current && ({
            ...current,
            page: getAdjacentPreviewPage(current.page, 1, current.range),
          }))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePagePreview, previewContext, previewPage, showHistory])

  const processFile = useCallback(async (file?: File) => {
    if (!file || busy !== 'idle') return
    setError('')
    setOutputs([])

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
      setRangeSpec(`1-${Math.min(loaded.pageCount, 3)}`)
      setBusy('idle')

      await renderThumbnails(
        loaded.document,
        (thumbnail) => {
          if (generation === generationRef.current) {
            thumbnailUrlsRef.current.push(thumbnail.url)
            setThumbnails((current) => [...current, thumbnail])
          } else {
            URL.revokeObjectURL(thumbnail.url)
          }
        },
        () => generation !== generationRef.current,
      )
    } catch (loadError) {
      if (generation === generationRef.current) {
        cleanupPreview()
        setBusy('idle')
        setSource(null)
        setError(getErrorMessage(loadError))
      }
    }
  }, [busy, cleanupPreview])

  const planResult = useMemo(() => {
    if (!source) return { plan: [], error: '' }
    try {
      return {
        plan: createSplitPlan(mode, source.pageCount, {
          pagesPerFile: Number(pagesPerFile),
          rangeSpec,
        }),
        error: '',
      }
    } catch (planError) {
      return { plan: [], error: getErrorMessage(planError) }
    }
  }, [mode, pagesPerFile, rangeSpec, source])

  const chunkSize = Number(pagesPerFile)
  const previewGroups = useMemo(
    () => createPreviewGroups(thumbnails, source?.pageCount ?? 0, mode, chunkSize),
    [chunkSize, mode, source?.pageCount, thumbnails],
  )

  const handleSplit = async () => {
    if (!source || planResult.error || busy !== 'idle') return
    setError('')
    setOutputs([])
    setBusy('splitting')
    setProgress({ current: 0, total: planResult.plan.length })

    try {
      const result = await splitPdf(
        source.bytes.slice(),
        source.file.name,
        planResult.plan,
        (current, total) => setProgress({ current, total }),
      )
      setOutputs(result)
      const modeSummary = mode === 'fixed'
        ? `每 ${pagesPerFile} 页一份`
        : mode === 'each'
          ? '逐页分割'
          : `自定义：${rangeSpec}`
      setHistoryEntries(appendHistory({
        sourceName: source.file.name,
        sourceSize: source.file.size,
        pageCount: source.pageCount,
        mode,
        modeSummary,
        outputCount: result.length,
        outputBytes: result.reduce((total, output) => total + output.bytes.byteLength, 0),
      }))
    } catch (splitError) {
      setOutputs([])
      setError(getErrorMessage(splitError))
    } finally {
      setBusy('idle')
    }
  }

  const handleZip = async () => {
    if (!source || outputs.length === 0 || busy !== 'idle') return
    setBusy('zipping')
    setZipProgress(0)
    setError('')
    try {
      const zip = await createZip(outputs, setZipProgress)
      triggerDownload(zip, `${getPdfBaseName(source.file.name)}_split.zip`)
    } catch (zipError) {
      setError(getErrorMessage(zipError))
    } finally {
      setBusy('idle')
      setZipProgress(0)
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
        : '无法访问剪贴板，请使用分享或保存')
  }

  const openOutputPreview = (output: SplitOutput) => {
    setPreviewContext({ page: output.range.start, range: output.range, label: output.name })
  }

  const movePreview = (direction: -1 | 1) => {
    setPreviewContext((current) => current && ({
      ...current,
      page: getAdjacentPreviewPage(current.page, direction, current.range),
    }))
  }

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

  const isBusy = busy !== 'idle'
  const splitButtonLabel = busy === 'splitting'
    ? `正在生成 ${progress.current}/${progress.total}`
    : `开始分割 · ${planResult.plan.length || 0} 份`

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
            <h1 className="m-0 text-4xl leading-[1.16] font-bold max-[900px]:text-[32px] max-[540px]:text-[28px]" id="page-title">拆分 PDF，清楚又利落</h1>
          </div>
          <p className="mb-1 max-w-[390px] text-[15px] leading-relaxed text-muted max-[900px]:max-w-[560px] max-[540px]:text-sm">选择一个文件，按固定页数、逐页或自定义范围生成新的 PDF。</p>
        </section>

        {!source ? (
          <section
            className={cx(
              ui.glassPanel,
              'relative flex min-h-[356px] animate-surface-enter flex-col items-center justify-center border-dashed border-brand/40 px-6 py-12 text-center transition-all duration-200 after:pointer-events-none after:absolute after:inset-3 after:rounded-md after:border after:border-white/60 max-[540px]:min-h-[324px] max-[540px]:px-4.5 max-[540px]:py-10',
              dragActive && 'scale-[.995] border-brand bg-[#f5faff]/95 shadow-[0_24px_60px_rgba(18,100,229,.15)]',
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
            <span className={cx('mb-5 grid size-16 place-items-center rounded-lg border border-brand/15 bg-brand-soft text-brand shadow-[0_10px_22px_rgba(18,100,229,.1)]', busy === 'loading' && 'border-amber-700/10 bg-amber-soft text-amber-700')} aria-hidden="true">
              {busy === 'loading' ? <RefreshCw className="animate-spin" size={28} /> : <Upload size={28} />}
            </span>
            <div>
              <h2 className="mb-2 text-[21px] leading-tight font-semibold">{busy === 'loading' ? '正在读取 PDF' : '拖放 PDF 到这里'}</h2>
              <p className="mb-6 text-sm leading-relaxed text-muted">{busy === 'loading' ? '正在检查文件并准备页面预览' : '或从 Mac、iCloud 云盘及“文件”中选择'}</p>
            </div>
            <button
              className={ui.primaryButton}
              type="button"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              <FileText size={18} /> 选择 PDF
            </button>
          </section>
        ) : (
          <>
            <section className={cx(ui.glassPanel, 'flex min-h-[76px] animate-surface-enter items-center gap-3.5 px-4 py-3')}>
              <span className="grid size-[42px] shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden="true"><FileCheck2 size={23} /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <strong className="truncate text-sm" title={source.file.name}>{source.file.name}</strong>
                <span className="text-xs text-muted">{source.pageCount} 页 · {formatFileSize(source.file.size)}</span>
              </div>
              <button className={ui.iconButton} type="button" onClick={clearAll} disabled={isBusy} aria-label="移除文件" title="移除文件">
                <Trash2 size={18} />
              </button>
            </section>

            <div className="mt-6 grid grid-cols-[minmax(320px,.78fr)_minmax(0,1.22fr)] items-start gap-6 max-[900px]:grid-cols-1">
              <section className={cx(ui.glassPanel, 'animate-surface-enter p-6 max-[540px]:p-4.5')} aria-labelledby="split-settings-title">
                <div className={ui.sectionHeading}>
                  <span className={ui.stepNumber}>1</span>
                  <div><h2 className="mb-1 text-[17px] leading-tight font-semibold" id="split-settings-title">选择分割方式</h2><p className="text-xs leading-snug text-muted">设置每份文件包含的页面</p></div>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-1 rounded-lg border border-black/5 bg-slate-200/80 p-1" role="tablist" aria-label="分割方式">
                  {modeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={mode === option.value}
                      className={cx('h-[38px] min-w-0 cursor-pointer rounded-md border-0 bg-transparent px-2 text-[13px] font-semibold whitespace-nowrap text-muted transition-all duration-200 max-[540px]:text-xs', mode === option.value && 'bg-white text-ink shadow-[0_2px_8px_rgba(29,36,47,.12)]')}
                      onClick={() => { setMode(option.value); setOutputs([]); setError('') }}
                      disabled={isBusy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="min-h-[108px] pt-5.5">
                  {mode === 'fixed' && (
                    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
                      <span>每份页数</span>
                      <div className="flex items-center gap-2.5">
                        <input
                          className="h-11 w-[98px] rounded-lg border border-black/20 bg-white/90 px-3 text-base font-semibold text-ink transition-shadow focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
                          type="number"
                          min="1"
                          max={source.pageCount}
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
                      <div><strong className="text-sm">每页生成一份 PDF</strong><p className="mt-1 text-xs text-muted">预计生成 {source.pageCount} 个文件</p></div>
                    </div>
                  )}
                  {mode === 'custom' && (
                    <label className="flex flex-col gap-2 text-[13px] font-semibold text-ink">
                      <span>页码范围</span>
                      <input
                        className="h-11 w-full rounded-lg border border-black/20 bg-white/90 px-3 text-ink transition-shadow focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
                        type="text"
                        inputMode="text"
                        value={rangeSpec}
                        placeholder="例如：1-3,5,8-10"
                        onChange={(event) => { setRangeSpec(event.target.value); setOutputs([]) }}
                        disabled={isBusy}
                        aria-describedby="range-help"
                      />
                      <small className="font-normal leading-relaxed text-muted" id="range-help">用逗号分隔，每个范围生成一份文件</small>
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
                <div className={ui.sectionHeading}>
                  <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-coral-soft text-sm font-bold text-coral">2</span>
                  <div><h2 className="mb-1 text-[17px] leading-tight font-semibold" id="preview-title">页面预览</h2><p className="text-xs leading-snug text-muted">{thumbnails.length < source.pageCount ? `正在准备 ${thumbnails.length}/${source.pageCount}` : `点击页面可全屏查看 · ${source.pageCount} 页`}</p></div>
                </div>
                <div className="mt-6 h-[520px] overflow-y-auto px-1 pb-2 [scrollbar-color:rgba(92,102,117,.35)_transparent] [scrollbar-width:thin] max-[900px]:h-[560px] max-[540px]:h-[500px] max-[360px]:h-[540px]">
                  <div key={`${mode}-${chunkSize}`} className="space-y-4 animate-group-refresh">
                    {previewGroups.map((group, groupIndex) => (
                      <section
                        className={cx('grid grid-cols-2 gap-4 pb-4 max-[540px]:gap-3 max-[360px]:grid-cols-1', mode === 'fixed' && groupIndex < previewGroups.length - 1 && 'border-b border-dashed border-brand/25')}
                        key={`${group.range.start}-${group.range.end}`}
                        aria-label={mode === 'fixed' ? `第 ${groupIndex + 1} 份，${group.range.start} 到 ${group.range.end} 页` : undefined}
                      >
                        {mode === 'fixed' && Number.isInteger(chunkSize) && chunkSize > 0 && (
                          <div className="col-span-full flex items-center justify-between gap-3 text-xs text-muted max-[360px]:col-span-1">
                            <span className="font-semibold text-brand">第 {groupIndex + 1} 份</span>
                            <span>{group.range.start}-{group.range.end} 页</span>
                          </div>
                        )}
                        {group.thumbnails.map((thumbnail) => (
                          <button
                            className={ui.thumbnail}
                            key={thumbnail.pageNumber}
                            type="button"
                            onClick={() => setPreviewContext({
                              page: thumbnail.pageNumber,
                              range: { start: 1, end: source.pageCount },
                              label: source.file.name,
                            })}
                            aria-label={`全屏查看第 ${thumbnail.pageNumber} 页`}
                          >
                            <img className="block aspect-[.71] w-full border border-black/10 bg-white object-contain" src={thumbnail.url} alt={`第 ${thumbnail.pageNumber} 页预览`} />
                            <span className="absolute right-2 bottom-2 grid min-w-7 place-items-center rounded-[5px] bg-ink/85 px-2 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">{thumbnail.pageNumber}</span>
                            <span className="absolute top-2 right-2 grid size-[30px] -translate-y-1 place-items-center rounded-md border border-black/10 bg-white/90 text-ink opacity-0 transition-all duration-200 group-hover/thumb:translate-y-0 group-hover/thumb:opacity-100 group-focus-visible/thumb:translate-y-0 group-focus-visible/thumb:opacity-100 max-[540px]:size-7 max-[540px]:translate-y-0 max-[540px]:opacity-100" aria-hidden="true"><Maximize2 size={15} /></span>
                          </button>
                        ))}
                      </section>
                    ))}
                  </div>
                  {thumbnails.length < source.pageCount && (
                    <div className="mt-4 grid aspect-[.71] w-[calc(50%-8px)] place-items-center rounded-[5px] border border-black/10 bg-slate-100/80 text-faint max-[540px]:w-[calc(50%-6px)] max-[360px]:w-full" aria-label="正在生成预览"><RefreshCw className="animate-spin" size={20} /></div>
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {error && <div className="mt-4 flex min-h-12 items-center gap-2.5 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger shadow-[0_8px_20px_rgba(196,65,53,.07)]" role="alert"><Info size={18} /><span className="flex-1">{error}</span><button className="grid size-9 place-items-center rounded-md border-0 bg-transparent" type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={17} /></button></div>}

        {outputs.length > 0 && source && (
          <section className={cx(ui.glassPanel, 'mt-6 animate-surface-enter p-6 max-[540px]:p-4.5')} aria-labelledby="results-title">
            <div className="flex items-center justify-between gap-6 max-[540px]:flex-col max-[540px]:items-stretch">
              <div className={ui.sectionHeading}>
                <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-success-soft text-success"><Check size={19} /></span>
                <div><h2 className="mb-1 text-[17px] leading-tight font-semibold" id="results-title">分割完成</h2><p className="text-xs text-muted">已生成 {outputs.length} 个 PDF 文件</p></div>
              </div>
              <button className={cx(ui.primaryButton, 'shrink-0 max-[540px]:w-full')} type="button" onClick={handleZip} disabled={isBusy}>
                {busy === 'zipping' ? <RefreshCw className="animate-spin" size={18} /> : <Archive size={18} />}
                {busy === 'zipping' ? `正在打包 ${Math.round(zipProgress)}%` : '下载全部 ZIP'}
              </button>
            </div>
            <div className="mt-5 border-t border-black/10">
              {outputs.map((output, index) => {
                const remainder = isRemainderOutput(outputs, index, mode, chunkSize)
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
                  <div className="flex items-center gap-1.5 max-[540px]:ml-[50px] max-[540px]:w-[calc(100%-50px)] max-[540px]:justify-end">
                    <div className="flex items-center gap-1 opacity-100 transition-opacity duration-200 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100">
                      <button className="grid size-10 place-items-center rounded-lg border border-black/10 bg-white/65 text-muted transition-all duration-200 hover:bg-brand-soft hover:text-brand" type="button" onClick={() => void handleCopyOutput(output)} aria-label={`复制 ${output.name}`} title="复制 PDF"><Copy size={17} /></button>
                      <button className="grid size-10 place-items-center rounded-lg border border-black/10 bg-white/65 text-muted transition-all duration-200 hover:bg-brand-soft hover:text-brand" type="button" onClick={() => openOutputPreview(output)} aria-label={`预览 ${output.name}`} title="快速预览"><Eye size={18} /></button>
                    </div>
                    <button
                      className="inline-flex min-h-11 min-w-[150px] items-center justify-center gap-2 rounded-lg bg-transparent px-2 text-[13px] font-semibold text-brand transition-colors duration-200 hover:bg-brand-soft max-[540px]:min-w-0 max-[540px]:flex-1 max-[540px]:justify-start"
                      type="button"
                      onClick={() => void shareOrDownloadPdf(output)}
                      aria-label={`分享或保存 ${output.name}`}
                    >
                      <Share2 size={17} /> <span>分享或保存</span><ChevronRight className="max-[540px]:ml-auto" size={16} />
                    </button>
                  </div>
                </div>
              )})}
            </div>
            <button className={cx(ui.secondaryButton, 'mt-5 max-[540px]:w-full')} type="button" onClick={clearAll}>
              <PackageOpen size={18} /> 处理另一个文件
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

      {previewPage !== null && source && (
        <div
          className="fixed inset-0 z-70 grid animate-fade-in place-items-center bg-[#0a0f16]/85 p-[max(18px,env(safe-area-inset-top))_max(18px,env(safe-area-inset-right))_max(18px,env(safe-area-inset-bottom))_max(18px,env(safe-area-inset-left))] backdrop-blur-[10px] max-[540px]:p-0"
          role="presentation"
          onMouseDown={closePagePreview}
          onTouchStart={(event) => { touchStartXRef.current = event.changedTouches[0]?.clientX ?? null }}
          onTouchEnd={(event) => handlePreviewTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
        >
          <div className="relative flex h-full w-[min(1180px,100%)] animate-preview-enter flex-col overflow-hidden rounded-lg border border-white/10 bg-[#1a212b]/90 shadow-[0_30px_90px_rgba(0,0,0,.4)] max-[540px]:rounded-none max-[540px]:border-0" role="dialog" aria-modal="true" aria-label={`第 ${previewPage} 页高清预览`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex min-h-[54px] items-center justify-between gap-4 border-b border-white/10 bg-[#10161e]/75 py-1.5 pr-2.5 pl-4.5 text-white">
              <span className="min-w-0 text-[13px] font-semibold">
                <strong className="block truncate">{previewContext?.label}</strong>
                <small className="font-normal text-white/65">{previewPage - (previewContext?.range.start ?? 1) + 1} / {(previewContext?.range.end ?? source.pageCount) - (previewContext?.range.start ?? 1) + 1} · 原第 {previewPage} 页</small>
              </span>
              <button className="grid size-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/10" type="button" onClick={closePagePreview} aria-label="关闭高清预览" title="关闭"><X size={20} /></button>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto px-[72px] py-5 max-[540px]:p-3">
              {previewLoading && <div className="flex items-center gap-2.5 text-[13px] text-white/75"><RefreshCw className="animate-spin" size={24} /><span>正在生成高清预览</span></div>}
              {previewImage && <img className="block max-h-full max-w-full animate-preview-image-enter bg-white shadow-[0_18px_46px_rgba(0,0,0,.34)] max-[540px]:max-h-[calc(100vh-118px)]" src={previewImage} alt={`第 ${previewPage} 页高清预览`} />}
            </div>
            <button className="absolute top-1/2 left-3.5 z-2 grid size-[46px] -translate-y-1/2 place-items-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-20 max-[540px]:top-auto max-[540px]:bottom-[max(12px,env(safe-area-inset-bottom))] max-[540px]:left-[calc(50%-52px)] max-[540px]:size-[42px] max-[540px]:translate-y-0 max-[540px]:bg-[#10161e]/80" type="button" onClick={() => movePreview(-1)} disabled={previewPage === previewContext?.range.start} aria-label="上一页"><ChevronLeft size={24} /></button>
            <button className="absolute top-1/2 right-3.5 z-2 grid size-[46px] -translate-y-1/2 place-items-center rounded-lg border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-20 max-[540px]:top-auto max-[540px]:right-[calc(50%-52px)] max-[540px]:bottom-[max(12px,env(safe-area-inset-bottom))] max-[540px]:size-[42px] max-[540px]:translate-y-0 max-[540px]:bg-[#10161e]/80" type="button" onClick={() => movePreview(1)} disabled={previewPage === previewContext?.range.end} aria-label="下一页"><ChevronRight size={24} /></button>
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
