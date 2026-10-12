import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, FileImage, Plus, RotateCw, Trash2 } from 'lucide-react'
import { createFilesZip, triggerDownload } from '../lib/download'
import { formatFileSize } from '../lib/format'
import { getCroppedSize, importStitchImage, MAX_IMPORT_BYTES, type StitchImage } from '../lib/imageStitch'
import { convertToolImage, drawToolImage, imagePdfLayout, imagesToPdf, toolFileName, type ConvertSettings, type ImageDestination, type ImageIntake, type ImageTool, type PdfImageSettings, type ToolResult } from '../lib/imageTools'

interface Props {
  active: boolean; tool: ImageTool; intake?: ImageIntake
  onConsumed: (id: string) => void; onBusyChange: (busy: boolean) => void
  onContinue: (destination: ImageDestination, files: File[]) => void
  onPdfContinue: (files: File[]) => void
}
const message = (error: unknown) => error instanceof Error ? error.message : '处理失败，请重试'
const release = (image: StitchImage) => { URL.revokeObjectURL(image.url); URL.revokeObjectURL(image.thumbnail) }

export function ImageToolsWorkspace({ active, tool, intake, onConsumed, onBusyChange, onContinue, onPdfContinue }: Props) {
  const isPdf = tool === 'image-pdf'
  const title = isPdf ? '图片转 PDF' : '图片压缩与转换'
  const [images, setImages] = useState<StitchImage[]>([])
  const imagesRef = useRef<StitchImage[]>([])
  const [selectedId, setSelectedId] = useState('')
  const selected = images.find(image => image.id === selectedId) ?? images[0]
  const [pdf, setPdf] = useState<PdfImageSettings>({ paper: 'a4', orientation: 'portrait', margin: 10, encoding: 'png' })
  const [conversion, setConversion] = useState<ConvertSettings>({ format: 'jpeg', maxEdge: 2400, quality: 0.85 })
  const [name, setName] = useState('整理图片')
  const [results, setResults] = useState<Array<ToolResult & { url: string }>>([])
  const resultsRef = useRef<Array<ToolResult & { url: string }>>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [previewError, setPreviewError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const controller = useRef<AbortController | null>(null)
  const consumed = useRef('')
  const alive = useRef(true)
  const resultSection = useRef<HTMLElement>(null)
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controller.current?.abort(); imagesRef.current.forEach(release); resultsRef.current.forEach(result => URL.revokeObjectURL(result.url)) }
  }, [])
  const clearResults = () => {
    resultsRef.current.forEach(result => URL.revokeObjectURL(result.url))
    resultsRef.current = []; setResults([])
  }
  const changeImages = (next: StitchImage[]) => { clearResults(); imagesRef.current = next; setImages(next); setNotice('') }
  const addFiles = async (files: File[]) => {
    if (!files.length || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    const added: StitchImage[] = [], failures: string[] = []
    let bytes = imagesRef.current.reduce((sum, image) => sum + image.bytes, 0)
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`正在读取 ${index + 1}/${files.length}`)
        try {
          if (imagesRef.current.length + added.length >= 100) throw new Error('一次最多处理 100 张图片')
          if (bytes + file.size > MAX_IMPORT_BYTES) throw new Error('图片总量超过 120 MB，请减少图片')
          const image = await importStitchImage(file, abort.signal)
          added.push(image); bytes += file.size
        } catch (error) { if (abort.signal.aborted) break; failures.push(`${file.name}：${message(error)}`) }
      }
      if (!alive.current || abort.signal.aborted) { added.forEach(release); return }
      if (added.length) { changeImages([...imagesRef.current, ...added]); setSelectedId(added[0].id); setNotice(`已添加 ${added.length} 张图片，原有内容已保留`) }
      setError(failures.join('\n'))
    } finally { if (alive.current) { busyRef.current = false; setBusy(false); setProgress('') } }
  }
  useEffect(() => {
    if (!intake || consumed.current === intake.id || busyRef.current) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || !alive.current || busyRef.current) return
      consumed.current = intake.id; onConsumed(intake.id); void addFiles(intake.files)
    })
    return () => { cancelled = true }
  }, [intake, busy]) // Intake IDs make delivery idempotent, including StrictMode effects.

  useEffect(() => {
    if (!active || !selected) return
    const abort = new AbortController()
    setPreviewError('')
    void (async () => {
      let source: HTMLCanvasElement | undefined
      try {
        source = await drawToolImage(selected, 600, isPdf || conversion.format === 'jpeg', abort.signal)
        if (abort.signal.aborted || !preview.current) return
        const canvas = preview.current
        const context = canvas.getContext('2d')
        if (!context) throw new Error('当前浏览器无法显示预览')
        if (isPdf) {
          const size = getCroppedSize(selected)
          const layout = imagePdfLayout(size.width, size.height, pdf)
          const scale = Math.min(600 / layout.pageWidth, 650 / layout.pageHeight)
          canvas.width = Math.max(1, Math.round(layout.pageWidth * scale)); canvas.height = Math.max(1, Math.round(layout.pageHeight * scale))
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
          context.drawImage(source, layout.x * scale, layout.y * scale, layout.width * scale, layout.height * scale)
        } else { canvas.width = source.width; canvas.height = source.height; context.drawImage(source, 0, 0) }
      } catch (error) { if (!abort.signal.aborted) setPreviewError(message(error)) }
      finally { if (source) { source.width = 0; source.height = 0 } }
    })()
    return () => abort.abort()
  }, [active, selected, isPdf, pdf, conversion.format])

  const generate = async () => {
    if (busyRef.current || !images.length) return
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); clearResults()
    const abort = new AbortController(); controller.current = abort
    const generated: ToolResult[] = []
    try {
      if (isPdf) {
        const blob = await imagesToPdf(images, pdf, current => setProgress(`正在生成第 ${current}/${images.length} 页`), abort.signal)
        generated.push({ name: toolFileName(name, 'pdf'), blob })
      } else {
        let bytes = 0
        for (const [index, image] of images.entries()) {
          setProgress(`正在处理 ${index + 1}/${images.length}`)
          const result = await convertToolImage(image, conversion, abort.signal)
          bytes += result.blob.size
          if (bytes > MAX_IMPORT_BYTES) throw new Error('结果总量超过 120 MB，请降低尺寸或减少图片')
          generated.push({ ...result, name: images.length > 1 ? `${String(index + 1).padStart(3, '0')}-${result.name}` : result.name })
        }
      }
      if (!alive.current || abort.signal.aborted) return
      const next = generated.map(result => ({ ...result, url: URL.createObjectURL(result.blob) }))
      resultsRef.current = next; setResults(next); setNotice('处理完成，请下载保存，也可继续使用其他工具')
      requestAnimationFrame(() => resultSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    } catch (error) { if (alive.current) setError(abort.signal.aborted ? '已取消，图片和设置已保留' : message(error)) }
    finally { if (alive.current) { busyRef.current = false; setBusy(false); setProgress('') } }
  }
  const downloadAll = async () => {
    if (busyRef.current || !results.length) return
    if (results.length === 1) { triggerDownload(results[0].blob, results[0].name); return }
    busyRef.current = true; setBusy(true); setError('')
    try { triggerDownload(await createFilesZip(results.map(result => ({ name: result.name, data: result.blob }))), '转换图片.zip') }
    catch (error) { setError(message(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const resultFiles = () => results.map(result => new File([result.blob], result.name, { type: result.blob.type }))
  const updatePdf = (next: PdfImageSettings) => { clearResults(); setPdf(next) }
  const updateConversion = (next: ConvertSettings) => { clearResults(); setConversion(next) }
  return <div hidden={!active} className="image-tools-workspace">
    <section className="site-intro"><h1>{title}</h1><p className="site-intro-description">{isPdf ? '把照片与截图按顺序整理成一份 PDF，每张图片一页。' : '批量调整图片尺寸、清晰度和格式，预览后下载。'}</p></section>
    <input ref={input} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label={`${title}选择图片`} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addFiles(files) }} />
    {error && <p className="stitch-error" role="alert">{error}</p>}
    <p className="tool-status" role="status">{progress || notice}</p>
    {!images.length ? <section className="stitch-upload" aria-label={`${title}添加图片`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) }}>
      <FileImage size={32} aria-hidden="true" /><h2>添加需要处理的图片</h2><p>拖入图片，或从设备选择多张 JPG、PNG、静态 WebP。</p>
      <button type="button" className="stitch-primary" disabled={busy} onClick={() => input.current?.click()}><Plus size={17} />选择图片</button>
    </section> : <>
      <div className="tool-toolbar"><span>{images.length} 张图片 · {formatFileSize(images.reduce((sum, image) => sum + image.bytes, 0))}</span><div>
        <button type="button" className="stitch-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={16} />添加图片</button>
        <button type="button" className="stitch-button" disabled={busy} onClick={() => { if (!window.confirm('清空此工具的图片和结果？')) return; imagesRef.current.forEach(release); changeImages([]); setError('') }}>清空</button>
      </div></div>
      <div className="tool-layout">
        <section className="tool-images" aria-label="图片顺序"><h2>{isPdf ? '页面顺序' : '待处理图片'}</h2><ol>{images.map((image, index) => <li key={image.id} className={`tool-image-row ${selected?.id === image.id ? 'is-selected' : ''}`}>
          <button type="button" className="tool-image-select" disabled={busy} aria-pressed={selected?.id === image.id} aria-label={`预览第 ${index + 1} 张 ${image.name}`} onClick={() => setSelectedId(image.id)}><img src={image.thumbnail} alt="" /><span><strong>{image.name}</strong><small>{index + 1} · {image.width} × {image.height}{image.rotation ? ` · ${image.rotation}°` : ''}</small></span></button>
          <div className="tool-image-actions">
            {[-1, 1].map(offset => <button type="button" className="stitch-icon" key={offset} disabled={busy || index + offset < 0 || index + offset >= images.length} aria-label={`${offset < 0 ? '前移' : '后移'}第 ${index + 1} 张`} onClick={() => { const next = [...images]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; changeImages(next) }}>{offset < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</button>)}
            <button type="button" className="stitch-icon" disabled={busy} aria-label={`旋转第 ${index + 1} 张`} onClick={() => changeImages(images.map(item => item.id === image.id ? { ...item, rotation: ((item.rotation + 90) % 360) as StitchImage['rotation'] } : item))}><RotateCw size={16} /></button>
            <button type="button" className="stitch-icon" disabled={busy} aria-label={`移除第 ${index + 1} 张`} onClick={() => { release(image); changeImages(images.filter(item => item.id !== image.id)) }}><Trash2 size={16} /></button>
          </div>
        </li>)}</ol></section>
        <section className="tool-preview" aria-label={isPdf ? 'PDF 页面预览' : '图片预览'}><h2>{isPdf ? '页面预览' : '原图预览'}</h2><div className="tool-preview-surface"><canvas ref={preview} role="img" aria-label={selected ? `预览 ${selected.name}` : '图片预览'} hidden={Boolean(previewError)} />{previewError && <p role="alert">{previewError}</p>}</div><p className="stitch-hint">{isPdf ? `第 ${images.indexOf(selected) + 1} 页 · 内容完整保留，等比适应纸张` : '处理后的尺寸和体积会在结果中显示'}</p></section>
        <section className="tool-settings" aria-label="导出设置"><h2>导出设置</h2>
          {isPdf ? <>
            <label className="stitch-field">纸张尺寸<select disabled={busy} value={pdf.paper} onChange={event => updatePdf({ ...pdf, paper: event.target.value as PdfImageSettings['paper'] })}><option value="a4">A4</option><option value="original">原图尺寸</option></select></label>
            {pdf.paper === 'a4' && <label className="stitch-field">页面方向<select disabled={busy} value={pdf.orientation} onChange={event => updatePdf({ ...pdf, orientation: event.target.value as PdfImageSettings['orientation'] })}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>}
            <label className="stitch-field">边距<select disabled={busy} value={pdf.margin} onChange={event => updatePdf({ ...pdf, margin: Number(event.target.value) })}>{[0, 5, 10, 20, 30].map(value => <option key={value} value={value}>{value} mm</option>)}</select></label>
            <label className="stitch-field">图片清晰度<select disabled={busy} value={pdf.encoding} onChange={event => updatePdf({ ...pdf, encoding: event.target.value as PdfImageSettings['encoding'] })}><option value="png">清晰优先（PNG）</option><option value="jpeg">较小体积（JPG）</option></select></label>
            <label className="stitch-field">文件名<input type="text" disabled={busy} value={name} onChange={event => { setName(event.target.value); clearResults() }} /></label>
            <p className="stitch-hint">最长边最多 4096 像素，图片总量最多 120 MB。不识别文字。</p>
          </> : <>
            <label className="stitch-field">输出格式<select disabled={busy} value={conversion.format} onChange={event => updateConversion({ ...conversion, format: event.target.value as ConvertSettings['format'] })}><option value="jpeg">JPG · 适合照片</option><option value="webp">WebP · 支持透明</option><option value="png">PNG · 支持透明</option></select></label>
            <label className="stitch-field">最长边<select disabled={busy} value={conversion.maxEdge} onChange={event => updateConversion({ ...conversion, maxEdge: Number(event.target.value) })}>{[800, 1200, 1800, 2400, 4096, 8192].map(value => <option key={value} value={value}>{value === 8192 ? '保留尺寸（上限 8192）' : `${value} 像素`}</option>)}</select></label>
            {conversion.format !== 'png' && <label className="stitch-slider"><span>清晰度 <b>{Math.round(conversion.quality * 100)}%</b></span><input disabled={busy} type="range" min="0.1" max="1" step="0.05" value={conversion.quality} onChange={event => updateConversion({ ...conversion, quality: Number(event.target.value) })} /></label>}
            <p className="stitch-hint">不放大小图。单张输出最多 1600 万像素；JPG 的透明区域填为白色。PNG 不使用清晰度压缩，转换后体积可能增加。</p>
          </>}
          <button type="button" className="stitch-primary" disabled={busy || Boolean(previewError)} onClick={() => void generate()}>{busy ? '正在处理…' : isPdf ? '生成 PDF' : '处理图片'}</button>
          {busy && <button type="button" className="stitch-button" onClick={() => controller.current?.abort()}>取消处理</button>}
        </section>
      </div>
      {results.length > 0 && <section ref={resultSection} className="stitch-results" aria-label={`${title}结果`}><div className="stitch-result-heading"><div><h2>{isPdf ? 'PDF 已生成' : '图片已处理'}</h2><p>{isPdf ? `${images.length} 页` : `${results.length} 张`} · {formatFileSize(results.reduce((sum, result) => sum + result.blob.size, 0))} · 刷新后不会保留</p></div><button type="button" className="stitch-primary" disabled={busy} onClick={() => void downloadAll()}><Download size={17} />{results.length > 1 ? '打包下载 ZIP' : isPdf ? '下载 PDF' : '下载图片'}</button></div>
        {!isPdf && <div className="stitch-result-grid">{results.map(result => <article className="stitch-result" key={result.name}><a href={result.url} target="_blank" rel="noopener noreferrer" aria-label={`查看处理后的 ${result.name}`}><img src={result.url} alt={result.name} /></a><strong>{result.name}</strong><small>{result.width} × {result.height} · {formatFileSize(result.blob.size)}</small><p className="stitch-hint">{result.blob.size < result.originalBytes! ? `体积减少 ${Math.round((1 - result.blob.size / result.originalBytes!) * 100)}%` : result.blob.size === result.originalBytes ? '体积未变化' : `体积增加 ${Math.round((result.blob.size / result.originalBytes! - 1) * 100)}%`}（原图 {formatFileSize(result.originalBytes!)}）</p><button type="button" className="stitch-button" disabled={busy} onClick={() => triggerDownload(result.blob, result.name)}>下载图片</button></article>)}</div>}
        <div className="tool-continue"><span>继续处理</span>{isPdf ? <button type="button" className="stitch-button" disabled={busy} onClick={() => onPdfContinue(resultFiles())}>加入 PDF 合并</button> : <>{(['image-pdf', 'stitch'] as ImageDestination[]).map(destination => <button type="button" className="stitch-button" key={destination} disabled={busy} onClick={() => onContinue(destination, resultFiles())}>{destination === 'stitch' ? '继续图片拼接' : '转为 PDF'}</button>)}</>}</div>
      </section>}
    </>}
    <p className="stitch-privacy">文件只在本设备处理，不上传。一次最多 100 张，单张最多 25 MB、4000 万像素，合计最多 120 MB。</p>
  </div>
}
