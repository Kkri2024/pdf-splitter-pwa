import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Download, FileImage, GripVertical, Plus, RotateCw, Share2, Trash2, Undo2, Redo2, ZoomIn, ZoomOut } from 'lucide-react'
import { createFilesZip, triggerDownload } from '../lib/download'
import { formatFileSize } from '../lib/format'
import { canvasBlob, createExportRegions, createStitchLayout, DEFAULT_STITCH_SETTINGS, EMPTY_CROP, importStitchImage, MAX_IMPORT_BYTES, renderStitchCanvas, stitchFileName, type ImageCrop, type StitchImage, type StitchSettings } from '../lib/imageStitch'

interface Snapshot { images: StitchImage[]; settings: StitchSettings }
interface Timeline { past: Snapshot[]; present: Snapshot; future: Snapshot[] }
interface Result { name: string; blob: Blob; url: string; width: number; height: number }
const initial = (): Snapshot => ({ images: [], settings: { ...DEFAULT_STITCH_SETTINGS } })
const messageOf = (error: unknown) => error instanceof Error ? error.message : '图片处理失败，请重新添加后重试'
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const modes = [{ value: 'vertical', label: '纵向长图' }, { value: 'horizontal', label: '横向拼接' }, { value: 'grid', label: '网格拼图' }] as const
const cropLabels: Record<keyof ImageCrop, string> = { top: '上边', bottom: '下边', left: '左边', right: '右边' }

function ImageRow({ image, index, count, selected, disabled, onSelect, onMove, onReplace, onRemove }: {
  image: StitchImage; index: number; count: number; selected: boolean; disabled: boolean
  onSelect: () => void; onMove: (offset: number) => void; onReplace: () => void; onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: image.id, disabled })
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`stitch-image-row ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}>
    <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" disabled={disabled} className="stitch-icon stitch-grip" aria-label={`拖动第 ${index + 1} 张图片排序`}><GripVertical size={17} /></button>
    <button type="button" className="stitch-image-select" disabled={disabled} onClick={onSelect} aria-pressed={selected} aria-label={`编辑第 ${index + 1} 张图片 ${image.name}`}>
      <img src={image.thumbnail} alt="" /><span><strong title={image.name}>{image.name}</strong><small>{index + 1} · {image.width} × {image.height}{image.rotation ? ` · 旋转 ${image.rotation}°` : ''}</small></span>
    </button>
    <div className="stitch-row-actions">
      <button type="button" className="stitch-icon" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={`前移第 ${index + 1} 张图片`}><ArrowUp size={16} /></button>
      <button type="button" className="stitch-icon" disabled={disabled || index === count - 1} onClick={() => onMove(1)} aria-label={`后移第 ${index + 1} 张图片`}><ArrowDown size={16} /></button>
      <button type="button" className="stitch-small-button" disabled={disabled} onClick={onReplace} aria-label={`替换第 ${index + 1} 张图片`}>替换</button>
      <button type="button" className="stitch-icon" disabled={disabled} onClick={onRemove} aria-label={`移除第 ${index + 1} 张图片`}><Trash2 size={16} /></button>
    </div>
  </li>
}

export function ImageStitchWorkspace({ active }: { active: boolean }) {
  const [timeline, setTimeline] = useState<Timeline>(() => ({ past: [], present: initial(), future: [] }))
  const { images, settings } = timeline.present
  const [selectedId, setSelectedId] = useState('')
  const selected = images.find(image => image.id === selectedId)
  const [busy, setBusy] = useState<'idle' | 'import' | 'export' | 'zip'>('idle')
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState('')
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [zoom, setZoom] = useState(100)
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')
  const [quality, setQuality] = useState(0.92)
  const [name, setName] = useState('拼接图片')
  const [segmented, setSegmented] = useState(true)
  const [results, setResults] = useState<Result[]>([])
  const resultsRef = useRef<Result[]>([])
  const resources = useRef(new Map<string, StitchImage>())
  const fileInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const replaceId = useRef('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectedCanvasRef = useRef<HTMLCanvasElement>(null)
  const operation = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const resultSection = useRef<HTMLElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const layoutState = useMemo(() => {
    try { return { layout: createStitchLayout(images, settings), error: '' } }
    catch (error) { return { layout: null, error: messageOf(error) } }
  }, [images, settings])
  const exportPlan = useMemo(() => {
    if (!layoutState.layout || !images.length) return { regions: [], error: '' }
    try { return { regions: createExportRegions(layoutState.layout, segmented), error: '' } }
    catch (error) { return { regions: [], error: messageOf(error) } }
  }, [layoutState.layout, images.length, segmented])

  const clearResults = () => {
    resultsRef.current.forEach(result => URL.revokeObjectURL(result.url))
    resultsRef.current = []; setResults([])
  }
  const commit = (update: (snapshot: Snapshot) => Snapshot) => {
    clearResults(); setError(''); setNotice('')
    setTimeline(current => ({ past: [...current.past, current.present].slice(-30), present: update(current.present), future: [] }))
  }
  const changeSetting = <K extends keyof StitchSettings>(key: K, value: StitchSettings[K]) => commit(snapshot => ({ ...snapshot, settings: { ...snapshot.settings, [key]: value } }))
  const updateImage = (id: string, update: (image: StitchImage) => StitchImage) => commit(snapshot => ({ ...snapshot, images: snapshot.images.map(image => image.id === id ? update(image) : image) }))
  const moveImage = (id: string, target: number) => commit(snapshot => ({ ...snapshot, images: arrayMove(snapshot.images, snapshot.images.findIndex(image => image.id === id), target) }))
  const history = (direction: 'undo' | 'redo') => {
    clearResults(); setError(''); setNotice('')
    setTimeline(current => direction === 'undo' && current.past.length ? {
      past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future].slice(0, 30),
    } : direction === 'redo' && current.future.length ? {
      past: [...current.past, current.present].slice(-30), present: current.future[0], future: current.future.slice(1),
    } : current)
  }

  useEffect(() => {
    const retained = new Set([...timeline.past, timeline.present, ...timeline.future].flatMap(snapshot => snapshot.images.map(image => image.id)))
    resources.current.forEach((image, id) => {
      if (!retained.has(id)) { URL.revokeObjectURL(image.url); URL.revokeObjectURL(image.thumbnail); resources.current.delete(id) }
    })
  }, [timeline])
  useEffect(() => {
    alive.current = true
    const pool = resources.current
    return () => {
      alive.current = false; operation.current?.abort()
      pool.forEach(image => { URL.revokeObjectURL(image.url); URL.revokeObjectURL(image.thumbnail) }); pool.clear()
      resultsRef.current.forEach(result => URL.revokeObjectURL(result.url))
    }
  }, [])
  useEffect(() => {
    if (!active || !images.length || !layoutState.layout) { setPreviewReady(false); return }
    const controller = new AbortController()
    const layout = layoutState.layout
    setPreviewReady(false); setPreviewError('')
    const draw = async () => {
      const temp = document.createElement('canvas')
      try {
        const scale = Math.min(1, 4096 / Math.max(layout.width, layout.height), Math.sqrt(2_000_000 / (layout.width * layout.height)))
        await renderStitchCanvas(temp, layout, settings, { x: 0, y: 0, width: layout.width, height: layout.height }, scale, controller.signal)
        if (!controller.signal.aborted && canvasRef.current) {
          const canvas = canvasRef.current
          canvas.width = temp.width; canvas.height = temp.height
          canvas.getContext('2d')?.drawImage(temp, 0, 0)
          setPreviewReady(true)
        }
      } catch (error) { if (!controller.signal.aborted) setPreviewError(messageOf(error)) }
      finally { temp.width = 0; temp.height = 0 }
    }
    const timer = window.setTimeout(() => { void draw() }, 100)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [active, images, settings, layoutState.layout])
  useEffect(() => {
    if (!active || !selected) return
    const controller = new AbortController()
    const draw = async () => {
      const temp = document.createElement('canvas')
      try {
        const singleSettings = { ...DEFAULT_STITCH_SETTINGS, size: 600 }
        const layout = createStitchLayout([selected], singleSettings)
        const scale = Math.min(1, 600 / Math.max(layout.width, layout.height))
        await renderStitchCanvas(temp, layout, singleSettings, { x: 0, y: 0, width: layout.width, height: layout.height }, scale, controller.signal)
        if (!controller.signal.aborted && selectedCanvasRef.current) {
          selectedCanvasRef.current.width = temp.width; selectedCanvasRef.current.height = temp.height
          selectedCanvasRef.current.getContext('2d')?.drawImage(temp, 0, 0)
        }
      } catch (error) { if (!controller.signal.aborted) setError(messageOf(error)) }
      finally { temp.width = 0; temp.height = 0 }
    }
    void draw()
    return () => controller.abort()
  }, [active, selected])

  const addFiles = async (files: File[], targetId?: string) => {
    if (!files.length || busyRef.current) return
    busyRef.current = true; setBusy('import'); setError(''); setNotice('')
    const controller = new AbortController(); operation.current = controller
    const added: StitchImage[] = [], failures: string[] = []
    let total = images.reduce((sum, image) => sum + (image.id === targetId ? 0 : image.bytes), 0)
    let poolBytes = [...resources.current.values()].reduce((sum, image) => sum + image.bytes, 0)
    const batch = targetId ? files.slice(0, 1) : files
    try {
      for (let index = 0; index < batch.length; index++) {
        if (controller.signal.aborted) break
        const file = batch[index]
        setProgress(`正在读取图片 ${index + 1}/${batch.length}`)
        try {
          if (total + file.size > MAX_IMPORT_BYTES || poolBytes + file.size > MAX_IMPORT_BYTES * 2) throw new Error('图片及撤销记录占用空间过大，请减少图片，或清空图片和撤销记录后再添加')
          const image = await importStitchImage(file, controller.signal)
          added.push(image); total += file.size; poolBytes += file.size
        } catch (error) { if (isAbort(error)) break; failures.push(`${file.name}：${messageOf(error)}`) }
      }
      if (!alive.current || controller.signal.aborted) { added.forEach(image => { URL.revokeObjectURL(image.url); URL.revokeObjectURL(image.thumbnail) }); return }
      if (added.length) {
        added.forEach(image => resources.current.set(image.id, image))
        commit(snapshot => ({ ...snapshot, images: targetId ? snapshot.images.map(image => image.id === targetId ? added[0] : image) : [...snapshot.images, ...added] }))
        setSelectedId(added[0].id)
        setNotice(targetId ? '图片已替换，可撤销' : `已添加 ${added.length} 张图片`)
      }
      setError(failures.join('\n'))
    } finally { if (alive.current) { busyRef.current = false; setBusy('idle'); setProgress('') } }
  }

  const generate = async () => {
    if (busyRef.current || !layoutState.layout || !images.length) return
    if (exportPlan.error) { setError(exportPlan.error); return }
    busyRef.current = true; setBusy('export'); setError(''); setNotice(''); clearResults()
    const controller = new AbortController(); operation.current = controller
    const completed: Result[] = []
    const canvas = document.createElement('canvas')
    try {
      for (const [index, region] of exportPlan.regions.entries()) {
        setProgress(`正在生成图片 ${index + 1}/${exportPlan.regions.length}`)
        await renderStitchCanvas(canvas, layoutState.layout, settings, region, 1, controller.signal)
        const blob = await canvasBlob(canvas, format, quality)
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
        completed.push({ name: stitchFileName(name, format, index, exportPlan.regions.length), blob, url: URL.createObjectURL(blob), width: region.width, height: region.height })
        canvas.width = 0; canvas.height = 0
      }
      if (!alive.current) return
      resultsRef.current = completed; setResults(completed); setNotice(`已生成 ${completed.length} 张图片，请下载保存`)
      window.setTimeout(() => resultSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    } catch (error) {
      completed.forEach(result => URL.revokeObjectURL(result.url))
      if (alive.current) { if (isAbort(error)) setNotice('已取消生成，编辑内容已保留'); else setError(messageOf(error)) }
    } finally {
      canvas.width = 0; canvas.height = 0
      if (!alive.current) completed.forEach(result => URL.revokeObjectURL(result.url))
      else { busyRef.current = false; setBusy('idle'); setProgress('') }
    }
  }
  const downloadAll = async () => {
    if (busyRef.current || !results.length) return
    if (results.length === 1) { triggerDownload(results[0].blob, results[0].name); return }
    busyRef.current = true; setBusy('zip'); setError('')
    try {
      const blob = await createFilesZip(results.map(result => ({ name: result.name, data: result.blob })), percent => setProgress(`正在打包 ${Math.round(percent)}%`))
      if (alive.current) triggerDownload(blob, stitchFileName(name, format, 0, 1).replace(/\.[^.]+$/, '.zip'))
    } catch (error) { if (alive.current) setError(messageOf(error)) }
    finally { if (alive.current) { busyRef.current = false; setBusy('idle'); setProgress('') } }
  }
  const share = async (result: Result) => {
    const file = new File([result.blob], result.name, { type: result.blob.type })
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) { setNotice('当前浏览器不支持文件分享，请下载后分享'); return }
    try { await navigator.share({ files: [file], title: result.name }) }
    catch (error) { if (!isAbort(error)) setError('分享失败，请下载图片后分享') }
  }
  const clear = () => {
    if (!window.confirm('清空图片、编辑内容和撤销记录？PDF 工作区不受影响。')) return
    clearResults(); setTimeline({ past: [], present: initial(), future: [] }); setSelectedId(''); setError(''); setNotice('图片及撤销记录已清空')
  }
  const disabled = busy !== 'idle'

  return <div hidden={!active} className="stitch-workspace">
    <section className={`site-intro ${images.length ? 'site-intro-compact' : ''}`} aria-labelledby="stitch-heading">
      <h1 id="stitch-heading">图片拼接</h1><p className="site-intro-description">把照片与截图拼成一张图，预览后下载或分享。</p>
    </section>
    <input ref={fileInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="选择拼接图片" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addFiles(files) }} />
    <input ref={replaceInput} hidden type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="选择替换图片" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void addFiles([file], replaceId.current) }} />
    <div className="stitch-live" role="status">{progress || notice}</div>
    {error && <p role="alert" className="stitch-error">{error}</p>}
    {!images.length ? <section className={`stitch-upload ${dragging ? 'is-dragging' : ''}`} aria-label="添加拼接图片"
      onDragEnter={event => { event.preventDefault(); dragDepth.current++; setDragging(true) }} onDragOver={event => event.preventDefault()}
      onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) setDragging(false) }}
      onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(Array.from(event.dataTransfer.files)) }}>
      <FileImage size={32} aria-hidden="true" /><h2>{disabled ? '正在读取图片' : dragging ? '松开以添加图片' : '添加需要拼接的图片'}</h2>
      <p>拖入图片，或从设备选择多张图片。</p>
      <button type="button" className="stitch-primary" disabled={disabled} onClick={() => fileInput.current?.click()}><Plus size={17} />选择图片</button>
      <small>JPG / PNG / WebP · 单张最多 25 MB · 本次最多 120 MB</small>
      {(timeline.past.length > 0 || timeline.future.length > 0) && <div className="stitch-empty-history">
        <button type="button" className="stitch-button" disabled={disabled || !timeline.past.length} onClick={() => history('undo')} aria-label="撤销图片编辑"><Undo2 size={17} />撤销移除</button>
        <button type="button" className="stitch-icon" disabled={disabled || !timeline.future.length} onClick={() => history('redo')} aria-label="重做图片编辑"><Redo2 size={17} /></button>
        <button type="button" className="stitch-small-button" disabled={disabled} onClick={clear} aria-label="清空图片及撤销记录">清空撤销记录</button>
      </div>}
    </section> : <>
      <div className="stitch-toolbar">
        <span>{images.length} 张图片 · {formatFileSize(images.reduce((sum, image) => sum + image.bytes, 0))}</span>
        <div><button type="button" className="stitch-button" disabled={disabled} onClick={() => fileInput.current?.click()}><Plus size={16} />添加图片</button>
          <button type="button" className="stitch-icon" disabled={disabled || !timeline.past.length} onClick={() => history('undo')} aria-label="撤销图片编辑"><Undo2 size={17} /></button>
          <button type="button" className="stitch-icon" disabled={disabled || !timeline.future.length} onClick={() => history('redo')} aria-label="重做图片编辑"><Redo2 size={17} /></button>
          <button type="button" className="stitch-icon" disabled={disabled} onClick={clear} aria-label="清空图片及撤销记录"><Trash2 size={17} /></button></div>
      </div>
      <div className="stitch-layout">
        <section className="stitch-sources stitch-panel" aria-labelledby="stitch-sources-title"
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) }}>
          <h2 id="stitch-sources-title">图片顺序</h2><p className="stitch-hint">拖动手柄排序，或使用前移、后移按钮。</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id && !disabled) moveImage(String(active.id), images.findIndex(image => image.id === over.id)) }}>
            <SortableContext items={images.map(image => image.id)} strategy={verticalListSortingStrategy}>
              <ol className="stitch-image-list">{images.map((image, index) => <ImageRow key={image.id} image={image} index={index} count={images.length} selected={image.id === selectedId} disabled={disabled}
                onSelect={() => setSelectedId(image.id)} onMove={offset => moveImage(image.id, index + offset)}
                onReplace={() => { replaceId.current = image.id; replaceInput.current?.click() }} onRemove={() => commit(snapshot => ({ ...snapshot, images: snapshot.images.filter(item => item.id !== image.id) }))} />)}</ol>
            </SortableContext>
          </DndContext>
          {selected && <fieldset disabled={disabled} className="stitch-editor">
            <legend>编辑第 {images.indexOf(selected) + 1} 张图片</legend>
            <canvas ref={selectedCanvasRef} className="stitch-edit-preview" role="img" aria-label={`裁剪和旋转预览 ${selected.name}`} />
            <div className="stitch-editor-actions"><button type="button" className="stitch-button" onClick={() => updateImage(selected.id, image => ({ ...image, rotation: ((image.rotation + 90) % 360) as StitchImage['rotation'] }))}><RotateCw size={16} />旋转 90°</button>
              <button type="button" className="stitch-small-button" onClick={() => updateImage(selected.id, image => ({ ...image, rotation: 0, crop: { ...EMPTY_CROP } }))}>还原图片</button></div>
            <p className="stitch-hint">裁剪原图边缘，单位为百分比；之后应用旋转。</p>
            {(Object.keys(cropLabels) as Array<keyof ImageCrop>).map(edge => <label key={edge} className="stitch-slider"><span>{cropLabels[edge]} <b>{selected.crop[edge]}%</b></span><input type="range" min={0} max={90} step={1} value={selected.crop[edge]} onChange={event => {
              const opposite: keyof ImageCrop = edge === 'top' ? 'bottom' : edge === 'bottom' ? 'top' : edge === 'left' ? 'right' : 'left'
              const value = Math.min(Number(event.target.value), 95 - selected.crop[opposite])
              updateImage(selected.id, image => ({ ...image, crop: { ...image.crop, [edge]: value } }))
            }} /></label>)}
          </fieldset>}
        </section>
        <section className="stitch-preview-panel" aria-labelledby="stitch-preview-title">
          <div className="stitch-preview-heading"><h2 id="stitch-preview-title">拼接预览</h2><div>
            <button type="button" className="stitch-icon" aria-label="缩小拼接预览" disabled={zoom <= 100} onClick={() => setZoom(value => Math.max(100, value - 50))}><ZoomOut size={17} /></button>
            <button type="button" className="stitch-small-button" onClick={() => setZoom(100)} aria-label="预览适应宽度">{zoom === 100 ? '适应' : `${zoom}%`}</button>
            <button type="button" className="stitch-icon" aria-label="放大拼接预览" disabled={zoom >= 400} onClick={() => setZoom(value => Math.min(400, value + 50))}><ZoomIn size={17} /></button>
          </div></div>
          <div className="stitch-preview-scroll" role="region" tabIndex={0} aria-label="拼接预览，可滚动查看" aria-busy={!previewReady}>
            <canvas ref={canvasRef} role="img" aria-label={`按当前顺序拼接的 ${images.length} 张图片`} style={{ width: `${zoom}%`, opacity: previewReady ? 1 : 0.4 }} />
          </div>
          <p className="stitch-hint">{layoutState.layout ? `输出尺寸 ${layoutState.layout.width} × ${layoutState.layout.height} 像素` : layoutState.error}{!previewReady && !previewError && ' · 正在更新预览'} · 预览已缩小，导出使用所选尺寸。</p>
          {previewError && <p role="alert" className="stitch-error">{previewError}</p>}
        </section>
        <aside className="stitch-settings stitch-panel" aria-labelledby="stitch-settings-title">
          <h2 id="stitch-settings-title">布局与导出</h2>
          <fieldset disabled={disabled} className="stitch-settings-fields">
            <legend className="sr-only">拼接设置</legend>
            <div className="stitch-mode" role="group" aria-label="拼接方式">{modes.map(mode => <button key={mode.value} type="button" aria-pressed={settings.mode === mode.value} onClick={() => changeSetting('mode', mode.value)}>{mode.label}</button>)}</div>
            {settings.mode === 'grid' && <><label className="stitch-field">网格列数<select value={settings.columns} onChange={event => changeSetting('columns', Number(event.target.value))}>{[2, 3, 4].map(count => <option key={count} value={count}>{count} 列</option>)}</select></label>
              <label className="stitch-field">图片显示<select value={settings.fit} onChange={event => changeSetting('fit', event.target.value as StitchSettings['fit'])}><option value="contain">完整显示，保留内容</option><option value="cover">裁剪填满格子</option></select></label>
              {settings.fit === 'cover' && <p className="stitch-hint">填满格子会裁剪图片边缘，分享材料建议选择完整显示。</p>}</>}
            <label className="stitch-field">{settings.mode === 'horizontal' ? '统一高度（像素）' : settings.mode === 'grid' ? '输出宽度（像素）' : '统一宽度（像素）'}<select value={settings.size} onChange={event => changeSetting('size', Number(event.target.value))}>{[800, 1200, 1800, 2400, 3200, 4096].map(size => <option key={size} value={size}>{size}{size === 1200 ? ' · 推荐' : ''}</option>)}</select></label>
            <label className="stitch-slider"><span>图片间距 <b>{settings.gap} px</b></span><input type="range" min={0} max={100} step={1} value={settings.gap} onChange={event => changeSetting('gap', Number(event.target.value))} /></label>
            <label className="stitch-slider"><span>外围留白 <b>{settings.padding} px</b></span><input type="range" min={0} max={100} step={1} value={settings.padding} onChange={event => changeSetting('padding', Number(event.target.value))} /></label>
            <label className="stitch-field stitch-color">背景颜色<input type="color" value={settings.background} onChange={event => changeSetting('background', event.target.value)} /></label>
            <div className="stitch-export-fields">
              <label className="stitch-field">导出格式<select value={format} onChange={event => { setFormat(event.target.value as 'png' | 'jpeg'); clearResults() }}><option value="png">PNG · 文字与截图</option><option value="jpeg">JPG · 照片与分享</option></select></label>
              {format === 'jpeg' && <label className="stitch-slider"><span>JPG 质量 <b>{Math.round(quality * 100)}%</b></span><input type="range" min={0.6} max={1} step={0.01} value={quality} onChange={event => { setQuality(Number(event.target.value)); clearResults() }} /></label>}
              <label className="stitch-field">文件名称<input type="text" maxLength={100} value={name} onChange={event => { setName(event.target.value); clearResults() }} /></label>
              <label className="stitch-check"><input type="checkbox" checked={segmented} onChange={event => { setSegmented(event.target.checked); clearResults() }} />超长图片自动分段导出</label>
              <p className="stitch-hint">单张最多 8192 像素边长、1600 万像素；分段会在边界切开图片内容。</p>
            </div>
          </fieldset>
          {(layoutState.error || exportPlan.error) && <p role="alert" className="stitch-error">{layoutState.error || exportPlan.error}</p>}
          <button type="button" className="stitch-primary stitch-generate" disabled={disabled || !layoutState.layout || Boolean(exportPlan.error)} onClick={() => { void generate() }}><FileImage size={17} />{busy === 'export' ? '正在生成图片' : `生成${exportPlan.regions.length > 1 ? ` ${exportPlan.regions.length} 张分段` : ''}图片`}</button>
          {busy === 'export' && <button type="button" className="stitch-button stitch-generate" onClick={() => operation.current?.abort()}>取消生成</button>}
        </aside>
      </div>
      <div className="stitch-mobile-export">
        <div><span>{exportPlan.regions.length > 1 ? `分段导出 ${exportPlan.regions.length} 张` : '按当前设置生成'}</span><a href="#stitch-settings-title">调整设置</a></div>
        <button type="button" className="stitch-primary" disabled={disabled || !layoutState.layout || Boolean(exportPlan.error)} onClick={() => { void generate() }}><FileImage size={17} />{busy === 'export' ? '正在生成' : '生成图片'}</button>
      </div>
      {results.length > 0 && <section ref={resultSection} className="stitch-results" aria-labelledby="stitch-result-title">
        <div className="stitch-result-heading"><div><h2 id="stitch-result-title">图片已生成</h2><p>共 {results.length} 张 · {formatFileSize(results.reduce((sum, result) => sum + result.blob.size, 0))} · 请下载保存，刷新页面后不会保留。</p></div>
          <button type="button" className="stitch-primary" disabled={disabled} onClick={() => { void downloadAll() }}><Download size={17} />{results.length > 1 ? '打包下载 ZIP' : '下载图片'}</button></div>
        <div className="stitch-result-grid">{results.map(result => <article className="stitch-result" key={result.name}>
          <a href={result.url} target="_blank" rel="noopener noreferrer" aria-label={`查看原尺寸图片 ${result.name}`}><img src={result.url} loading="lazy" alt={result.name} /></a>
          <strong title={result.name}>{result.name}</strong><small>{result.width} × {result.height} · {formatFileSize(result.blob.size)}</small>
          <div><button type="button" className="stitch-button" disabled={disabled} onClick={() => triggerDownload(result.blob, result.name)} aria-label={`下载 ${result.name}`}><Download size={16} />下载</button>
            <button type="button" className="stitch-button" disabled={disabled} onClick={() => { void share(result) }} aria-label={`分享 ${result.name}`}><Share2 size={16} />分享</button></div>
        </article>)}</div>
      </section>}
    </>}
    <p className="stitch-privacy">图片只在本设备处理，不上传。编辑内容与结果仅保留在当前页面。</p>
  </div>
}
