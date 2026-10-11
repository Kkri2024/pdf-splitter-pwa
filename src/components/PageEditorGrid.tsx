import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, GripVertical, MoreHorizontal, MoveRight } from 'lucide-react'
import type { OutputPageMeta as EditablePage } from '../lib/pdfSplitter'
import type { Thumbnail } from '../lib/pdfPreview'

interface PageEditorGridProps {
  pages: EditablePage[]
  pagePositions?: Record<string, number>
  totalPageCount?: number
  viewKey?: string
  selectedIds: string[]
  thumbnails: Record<string, Thumbnail>
  disabled: boolean
  editing: boolean
  showSelection: boolean
  thumbnailSize?: 'small' | 'medium' | 'large'
  showSourceLabel?: boolean
  scrollClassName?: string
  onToggle: (id: string) => void
  onMove: (activeId: string, overId: string) => void
  onMoveTo: (id: string, position: number) => void
  onOpen: (id: string) => void
  onRequestThumbnail: (page: EditablePage) => void
}

interface SortablePageProps extends Omit<PageEditorGridProps, 'pages' | 'onMove'> {
  page: EditablePage
  index: number
  pageCount: number
}

function SortablePage({
  page,
  index,
  pageCount,
  selectedIds,
  thumbnails,
  disabled,
  editing,
  showSelection,
  onToggle,
  onMoveTo,
  onOpen,
  onRequestThumbnail,
  showSourceLabel,
}: SortablePageProps) {
  const thumbnail = thumbnails[page.id]
  const selected = selectedIds.includes(page.id)
  const [position, setPosition] = useState(String(index + 1))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled: disabled || !editing })

  useEffect(() => setPosition(String(index + 1)), [index])
  useEffect(() => { onRequestThumbnail(page) }, [onRequestThumbnail, page, thumbnail])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus({ preventScroll: true }) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])
  useEffect(() => setMenuOpen(false), [editing, page.id])

  const submitPosition = () => {
    const next = Number(position)
    if (Number.isInteger(next) && next >= 1 && next <= pageCount) onMoveTo(page.id, next)
    else setPosition(String(index + 1))
  }

  return (
    <article
      ref={setNodeRef}
      className={`pdf-page group/page relative min-w-0 overflow-visible ${showSelection && selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''} ${menuOpen ? 'has-menu' : ''}`}
      data-source-name={page.sourceName}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className="pdf-page-preview" onClick={() => onOpen(page.id)} aria-label={`全屏查看当前第 ${index + 1} 页`}>
        {thumbnail ? (
          <img className="block h-full w-full bg-white object-contain" width={thumbnail.width} height={thumbnail.height} src={thumbnail.url} alt={`当前第 ${index + 1} 页预览`} />
        ) : (
          <span className="grid h-full w-full place-items-center bg-white text-xs text-faint">准备预览…</span>
        )}
      </button>
        {showSelection && (
          <button
            type="button"
            className={`page-selection ${selected ? 'is-selected' : ''}`}
            disabled={disabled}
            onClick={() => onToggle(page.id)}
            aria-label={`${selected ? '取消选择' : '选择'}当前第 ${index + 1} 页`}
            title={selected ? '取消选中' : '选中本页'}
            aria-pressed={selected}
          >
            <span className="page-selection-mark"><Check size={13} aria-hidden="true" /></span>
          </button>
        )}
      <footer className="pdf-page-footer">
        {showSourceLabel && <span className="page-source" title={`${page.sourceName ?? ''} · 原第 ${page.sourcePageIndex + 1} 页`}><span>{page.sourceName}</span><span>原 {page.sourcePageIndex + 1}</span></span>}
        <div className="page-control-row">
        <span className="page-number" title={`当前第 ${index + 1} 页`}>
          <span className="sr-only">第 </span>{index + 1}<span className="sr-only"> 页</span>
          {(!showSourceLabel && index !== page.sourcePageIndex || page.rotation !== 0) && <small>原 {page.sourcePageIndex + 1}{page.rotation ? ` · ${page.rotation}°` : ''}</small>}
        </span>
        {editing && (
          <div className="page-actions">
            <button
            type="button"
            className="page-action cursor-grab touch-manipulation active:cursor-grabbing"
            disabled={disabled}
            aria-label={`拖动当前第 ${index + 1} 页排序`}
            title="拖动排序"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={18} />
          </button>
            <div ref={menuRef} className="relative">
              <button ref={menuButtonRef} type="button" className="page-action" disabled={disabled} onClick={() => setMenuOpen((open) => !open)} aria-label={`第 ${index + 1} 页更多操作`} title="更多操作" aria-expanded={menuOpen} aria-controls={`${page.id}-actions`}><MoreHorizontal size={19} /></button>
              {menuOpen && (
                <div id={`${page.id}-actions`} className="absolute right-0 bottom-12 z-30 w-[190px] rounded-xl border border-line bg-white p-3 shadow-raised max-[540px]:w-[150px]">
                  <label className="block text-xs font-semibold text-ink">
                    移动到指定页
                    <span className="mt-2 flex items-center gap-2">
                      <input className="h-10 min-w-0 flex-1 rounded-md border border-black/15 px-2 text-center text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" type="number" min="1" max={pageCount} value={position} onChange={(event) => setPosition(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submitPosition(); setMenuOpen(false); menuButtonRef.current?.focus({ preventScroll: true }) } }} disabled={disabled} aria-label={`将当前第 ${index + 1} 页移动到第几页`} />
                      <button type="button" className="tooltip-button grid size-10 shrink-0 place-items-center rounded-lg bg-brand text-white" onClick={() => { submitPosition(); setMenuOpen(false); menuButtonRef.current?.focus({ preventScroll: true }) }} disabled={disabled} aria-label={`将当前页面移到第 ${position} 页`} title="确认移动"><MoveRight size={17} /></button>
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </footer>
    </article>
  )
}

export function PageEditorGrid(props: PageEditorGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const targetWidth = { small: 150, medium: width < 500 ? 145 : 210, large: 290 }[props.thumbnailSize ?? 'medium']
  const columns = Math.max(1, Math.floor((width + 16) / (targetWidth + 16)))
  const rows = useMemo(() => Array.from({ length: Math.ceil(props.pages.length / columns) }, (_, index) => props.pages.slice(index * columns, index * columns + columns)), [columns, props.pages])
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ((width - (columns - 1) * 16) / columns) / .71 + (props.showSourceLabel ? 92 : 60), overscan: 3 })
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => { virtualizer.measure() }, [columns, width, props.editing, props.showSourceLabel, virtualizer])

  useEffect(() => {
    if (props.viewKey !== undefined && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [props.viewKey])

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ''
    if (overId && activeId !== overId) props.onMove(activeId, overId)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={props.pages.map((page) => page.id)} strategy={rectSortingStrategy}>
        <div
          ref={scrollRef}
          className={`page-grid-scroll mt-4 overflow-y-auto overscroll-contain px-1.5 [scrollbar-width:thin] ${props.scrollClassName ?? 'h-[min(65vh,720px)] min-h-[280px]'}`}
          tabIndex={0}
          role="region"
          aria-label="PDF 页面列表"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                key={virtualRow.key}
                className="absolute top-0 left-0 grid w-full items-start gap-4 pb-4"
                style={{ transform: `translateY(${virtualRow.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {rows[virtualRow.index].map((page) => (
                  <SortablePage
                    key={page.id}
                    {...props}
                    page={page}
                    index={(props.pagePositions?.[page.id] ?? props.pages.findIndex((item) => item.id === page.id) + 1) - 1}
                    pageCount={props.totalPageCount ?? props.pages.length}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  )
}
