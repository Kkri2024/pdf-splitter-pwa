import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
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
import { createZip, shareOrDownloadPdf, triggerDownload } from './lib/download'
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
  type SplitMode,
  type SplitOutput,
} from './lib/pdfSplitter'

interface SourcePdf {
  file: File
  bytes: Uint8Array
  pageCount: number
}

type BusyState = 'idle' | 'loading' | 'splitting' | 'zipping'

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
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  const [previewImage, setPreviewImage] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
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

  const closePagePreview = useCallback(() => {
    pagePreviewGenerationRef.current += 1
    if (pagePreviewUrlRef.current) URL.revokeObjectURL(pagePreviewUrlRef.current)
    pagePreviewUrlRef.current = ''
    setPreviewImage('')
    setPreviewLoading(false)
    setPreviewPage(null)
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
    if (!showHistory && previewPage === null) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewPage !== null) closePagePreview()
        else setShowHistory(false)
      }
      if (previewPage !== null && source) {
        if (event.key === 'ArrowLeft' && previewPage > 1) setPreviewPage(previewPage - 1)
        if (event.key === 'ArrowRight' && previewPage < source.pageCount) setPreviewPage(previewPage + 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePagePreview, previewPage, showHistory, source])

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

  const movePreview = (direction: -1 | 1) => {
    if (previewPage === null || !source) return
    const nextPage = previewPage + direction
    if (nextPage >= 1 && nextPage <= source.pageCount) setPreviewPage(nextPage)
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Scissors size={19} /></span>
          <span>PDF 分割工具</span>
        </div>
        <div className="topbar-actions">
          <span className={`status-chip ${online ? '' : 'offline'}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? '已联网' : '离线可用'}
          </span>
          <button
            className="icon-text-button history-button"
            type="button"
            onClick={() => { setShowHistory(true); setConfirmClearHistory(false) }}
            aria-label={`历史记录，${historyEntries.length} 条`}
            title="历史记录"
          >
            <HistoryIcon size={16} />
            <span>历史</span>
            {historyEntries.length > 0 && <b>{historyEntries.length}</b>}
          </button>
          <button className="icon-text-button" type="button" onClick={handleInstall} aria-label="安装到设备" title="安装到设备">
            <Download size={16} />
            <span>安装</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <div className="privacy-row">
              <p className="eyebrow"><ShieldCheck size={16} /> 本地处理，不上传文件</p>
              <span className="privacy-chip"><LockKeyhole size={13} /> 无网络传输</span>
            </div>
            <h1 id="page-title">拆分 PDF，清楚又利落</h1>
          </div>
          <p className="intro-copy">选择一个文件，按固定页数、逐页或自定义范围生成新的 PDF。</p>
        </section>

        {!source ? (
          <section
            className={`drop-zone ${dragActive ? 'drag-active' : ''} ${busy === 'loading' ? 'loading' : ''}`}
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
              aria-label="选择 PDF 文件"
            />
            <span className="upload-icon" aria-hidden="true">
              {busy === 'loading' ? <RefreshCw className="spin" size={28} /> : <Upload size={28} />}
            </span>
            <div className="drop-copy">
              <h2>{busy === 'loading' ? '正在读取 PDF' : '拖放 PDF 到这里'}</h2>
              <p>{busy === 'loading' ? '正在检查文件并准备页面预览' : '或从 Mac、iCloud 云盘及“文件”中选择'}</p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              <FileText size={18} /> 选择 PDF
            </button>
          </section>
        ) : (
          <>
            <section className="file-summary">
              <span className="file-badge" aria-hidden="true"><FileCheck2 size={23} /></span>
              <div className="file-details">
                <strong title={source.file.name}>{source.file.name}</strong>
                <span>{source.pageCount} 页 · {formatFileSize(source.file.size)}</span>
              </div>
              <button className="icon-button" type="button" onClick={clearAll} disabled={isBusy} aria-label="移除文件" title="移除文件">
                <Trash2 size={18} />
              </button>
            </section>

            <div className="work-grid">
              <section className="control-panel" aria-labelledby="split-settings-title">
                <div className="section-heading">
                  <span className="step-number">1</span>
                  <div><h2 id="split-settings-title">选择分割方式</h2><p>设置每份文件包含的页面</p></div>
                </div>

                <div className="segmented-control" role="tablist" aria-label="分割方式">
                  {modeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={mode === option.value}
                      className={mode === option.value ? 'active' : ''}
                      onClick={() => { setMode(option.value); setOutputs([]); setError('') }}
                      disabled={isBusy}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="mode-field">
                  {mode === 'fixed' && (
                    <label>
                      <span>每份页数</span>
                      <div className="number-field">
                        <input
                          type="number"
                          min="1"
                          max={source.pageCount}
                          inputMode="numeric"
                          value={pagesPerFile}
                          onChange={(event) => { setPagesPerFile(event.target.value); setOutputs([]) }}
                          disabled={isBusy}
                        />
                        <span>页 / 份</span>
                      </div>
                    </label>
                  )}
                  {mode === 'each' && (
                    <div className="mode-confirmation">
                      <span className="confirmation-icon"><Check size={18} /></span>
                      <div><strong>每页生成一份 PDF</strong><p>预计生成 {source.pageCount} 个文件</p></div>
                    </div>
                  )}
                  {mode === 'custom' && (
                    <label>
                      <span>页码范围</span>
                      <input
                        className="text-input"
                        type="text"
                        inputMode="text"
                        value={rangeSpec}
                        placeholder="例如：1-3,5,8-10"
                        onChange={(event) => { setRangeSpec(event.target.value); setOutputs([]) }}
                        disabled={isBusy}
                        aria-describedby="range-help"
                      />
                      <small id="range-help">用逗号分隔，每个范围生成一份文件</small>
                    </label>
                  )}
                </div>

                {planResult.error && <p className="field-error" role="alert"><Info size={16} /> {planResult.error}</p>}

                <button
                  className="primary-button split-button"
                  type="button"
                  onClick={handleSplit}
                  disabled={isBusy || Boolean(planResult.error) || planResult.plan.length === 0}
                >
                  {busy === 'splitting' ? <RefreshCw className="spin" size={18} /> : <Scissors size={18} />}
                  {splitButtonLabel}
                </button>
                {busy === 'splitting' && (
                  <div className="progress-track" aria-label="分割进度">
                    <span style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
                  </div>
                )}
              </section>

              <section className="preview-panel" aria-labelledby="preview-title">
                <div className="section-heading">
                  <span className="step-number quiet">2</span>
                  <div><h2 id="preview-title">页面预览</h2><p>{thumbnails.length < source.pageCount ? `正在准备 ${thumbnails.length}/${source.pageCount}` : `点击页面可全屏查看 · ${source.pageCount} 页`}</p></div>
                </div>
                <div className="thumbnail-grid">
                  {thumbnails.map((thumbnail) => (
                    <button
                      className="thumbnail"
                      key={thumbnail.pageNumber}
                      type="button"
                      onClick={() => setPreviewPage(thumbnail.pageNumber)}
                      aria-label={`全屏查看第 ${thumbnail.pageNumber} 页`}
                    >
                      <img src={thumbnail.url} alt={`第 ${thumbnail.pageNumber} 页预览`} />
                      <span className="thumbnail-page">{thumbnail.pageNumber}</span>
                      <span className="thumbnail-expand" aria-hidden="true"><Maximize2 size={15} /></span>
                    </button>
                  ))}
                  {thumbnails.length < source.pageCount && (
                    <div className="thumbnail-skeleton" aria-label="正在生成预览"><RefreshCw className="spin" size={20} /></div>
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {error && <div className="error-banner" role="alert"><Info size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={17} /></button></div>}

        {outputs.length > 0 && source && (
          <section className="results-section" aria-labelledby="results-title">
            <div className="results-header">
              <div className="section-heading">
                <span className="success-mark"><Check size={19} /></span>
                <div><h2 id="results-title">分割完成</h2><p>已生成 {outputs.length} 个 PDF 文件</p></div>
              </div>
              <button className="primary-button zip-button" type="button" onClick={handleZip} disabled={isBusy}>
                {busy === 'zipping' ? <RefreshCw className="spin" size={18} /> : <Archive size={18} />}
                {busy === 'zipping' ? `正在打包 ${Math.round(zipProgress)}%` : '下载全部 ZIP'}
              </button>
            </div>
            <div className="result-list">
              {outputs.map((output) => (
                <div className="result-row" key={output.name}>
                  <span className="result-icon"><FileText size={18} /></span>
                  <div className="result-details">
                    <strong>{output.name}</strong>
                    <span>{output.pageCount} 页 · {formatFileSize(output.bytes.byteLength)}</span>
                  </div>
                  <button
                    className="share-button"
                    type="button"
                    onClick={() => void shareOrDownloadPdf(output)}
                    aria-label={`分享或保存 ${output.name}`}
                  >
                    <Share2 size={17} /> <span>分享或保存</span><ChevronRight size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button className="secondary-button new-task-button" type="button" onClick={clearAll}>
              <PackageOpen size={18} /> 处理另一个文件
            </button>
          </section>
        )}
      </main>

      <footer><ShieldCheck size={14} /> PDF 不会上传或保留；仅操作记录保存在当前设备</footer>

      {showHistory && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setShowHistory(false)}>
          <aside className="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="drawer-kicker"><CalendarClock size={15} /> 当前设备</p>
                <h2 id="history-title">历史记录</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowHistory(false)} aria-label="关闭历史记录"><X size={19} /></button>
            </div>
            <div className="history-privacy"><LockKeyhole size={16} /><span>这里只保存操作信息，不保存原始或输出 PDF。</span></div>
            <div className="history-list">
              {historyEntries.length === 0 ? (
                <div className="history-empty">
                  <span><HistoryIcon size={24} /></span>
                  <strong>还没有历史记录</strong>
                  <p>成功完成一次分割后，记录会保存在这台设备。</p>
                </div>
              ) : historyEntries.map((entry) => (
                <article className={`history-entry mode-${entry.mode}`} key={entry.id}>
                  <span className="history-accent" aria-hidden="true" />
                  <div className="history-entry-main">
                    <div className="history-entry-title">
                      <strong title={entry.sourceName}>{entry.sourceName}</strong>
                      <time dateTime={entry.createdAt}>{dateFormatter.format(new Date(entry.createdAt))}</time>
                    </div>
                    <p>{entry.modeSummary}</p>
                    <div className="history-meta">
                      <span>{entry.pageCount} 页</span>
                      <span>{entry.outputCount} 份</span>
                      <span>{formatFileSize(entry.outputBytes)}</span>
                    </div>
                  </div>
                  <button
                    className="icon-button history-delete"
                    type="button"
                    onClick={() => setHistoryEntries(removeHistory(entry.id))}
                    aria-label={`删除 ${entry.sourceName} 的记录`}
                    title="删除记录"
                  ><Trash2 size={16} /></button>
                </article>
              ))}
            </div>
            {historyEntries.length > 0 && (
              <div className="drawer-footer">
                {confirmClearHistory ? (
                  <div className="clear-confirm">
                    <span>确定清空全部记录？</span>
                    <button type="button" onClick={handleClearHistory}>清空</button>
                    <button type="button" onClick={() => setConfirmClearHistory(false)}>取消</button>
                  </div>
                ) : (
                  <button className="clear-history-button" type="button" onClick={() => setConfirmClearHistory(true)}><Trash2 size={16} /> 清空全部记录</button>
                )}
                <small>自动保留最近 30 天，最多 20 条</small>
              </div>
            )}
          </aside>
        </div>
      )}

      {previewPage !== null && source && (
        <div
          className="preview-backdrop"
          role="presentation"
          onMouseDown={closePagePreview}
          onTouchStart={(event) => { touchStartXRef.current = event.changedTouches[0]?.clientX ?? null }}
          onTouchEnd={(event) => handlePreviewTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
        >
          <div className="page-preview-dialog" role="dialog" aria-modal="true" aria-label={`第 ${previewPage} 页高清预览`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="preview-toolbar">
              <span>{previewPage} / {source.pageCount}</span>
              <button type="button" onClick={closePagePreview} aria-label="关闭高清预览" title="关闭"><X size={20} /></button>
            </div>
            <div className="preview-stage">
              {previewLoading && <div className="preview-loading"><RefreshCw className="spin" size={24} /><span>正在生成高清预览</span></div>}
              {previewImage && <img src={previewImage} alt={`第 ${previewPage} 页高清预览`} />}
            </div>
            <button className="preview-nav previous" type="button" onClick={() => movePreview(-1)} disabled={previewPage === 1} aria-label="上一页"><ChevronLeft size={24} /></button>
            <button className="preview-nav next" type="button" onClick={() => movePreview(1)} disabled={previewPage === source.pageCount} aria-label="下一页"><ChevronRight size={24} /></button>
          </div>
        </div>
      )}

      {needRefresh && (
        <div className="update-toast" role="status">
          <RefreshCw size={18} />
          <span>新版本已准备好</span>
          <button type="button" onClick={() => void updateServiceWorker(true)}>立即更新</button>
          <button className="toast-close" type="button" onClick={() => setNeedRefresh(false)} aria-label="稍后更新"><X size={16} /></button>
        </div>
      )}

      {showInstallHelp && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowInstallHelp(false)}>
          <div className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close icon-button" type="button" onClick={() => setShowInstallHelp(false)} aria-label="关闭"><X size={18} /></button>
            <span className="modal-icon"><Download size={24} /></span>
            <h2 id="install-title">安装到设备</h2>
            <div className="install-steps">
              <p><strong>iPhone：</strong>在 Safari 中点击“分享”，再选择“添加到主屏幕”。</p>
              <p><strong>Mac：</strong>在 Safari 的“文件”菜单中选择“添加到程序坞”。</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowInstallHelp(false)}>知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
