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
import type { EditablePage } from '../lib/pageEditor'
import type { Thumbnail } from '../lib/pdfPreview'

interface PageEditorGridProps {
  pages: EditablePage[]
  selectedIds: string[]
  thumbnails: Record<string, Thumbnail>
  disabled: boolean
  editing: boolean
  showSelection: boolean
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
}: SortablePageProps) {
  const thumbnail = thumbnails[page.id]
  const selected = selectedIds.includes(page.id)
  const [position, setPosition] = useState(String(index + 1))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled })

  useEffect(() => setPosition(String(index + 1)), [index])
  useEffect(() => { onRequestThumbnail(page) }, [onRequestThumbnail, page, thumbnail])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
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
      className={`group/page relative min-w-0 overflow-visible rounded-md border bg-white shadow-[0_6px_18px_rgba(31,43,58,.1)] transition-all duration-200 ${showSelection && selected ? 'border-brand ring-3 ring-brand/15' : 'border-black/10'} ${isDragging || menuOpen ? 'z-20 shadow-2xl' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className="block w-full cursor-zoom-in overflow-hidden rounded-t-md border-0 bg-transparent p-0" onClick={() => onOpen(page.id)} aria-label={`全屏查看当前第 ${index + 1} 页`}>
        {thumbnail ? (
          <img className="block h-auto w-full bg-white object-contain" style={{ aspectRatio: `${thumbnail.width} / ${thumbnail.height}` }} src={thumbnail.url} alt={`当前第 ${index + 1} 页预览`} />
        ) : (
          <span className="grid aspect-[.71] w-full place-items-center bg-slate-100 text-xs text-faint">准备预览...</span>
        )}
      </button>
      <footer className={`relative flex min-h-12 items-center gap-2 rounded-b-md border-t px-2.5 ${showSelection && selected ? 'border-brand/15 bg-brand-soft/55' : 'border-black/8 bg-slate-50/90'}`}>
        {showSelection && (
          <button
            type="button"
            className={`grid size-10 shrink-0 place-items-center rounded-lg border transition-colors ${selected ? 'border-brand bg-brand text-white' : 'border-black/15 bg-white text-transparent hover:border-brand/40'}`}
            onClick={() => onToggle(page.id)}
            aria-label={`${selected ? '取消选择' : '选择'}当前第 ${index + 1} 页`}
            title={selected ? '取消选中' : '选中本页'}
            aria-pressed={selected}
          >
            <Check size={17} />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
          第 {index + 1} 页
          {(index !== page.sourcePageIndex || page.rotation !== 0) && <small className="ml-1.5 font-normal text-muted">原 {page.sourcePageIndex + 1}{page.rotation ? ` · ${page.rotation}°` : ''}</small>}
        </span>
        {editing && (
          <>
            <button
            type="button"
            className="grid size-10 shrink-0 cursor-grab touch-manipulation place-items-center rounded-lg border border-black/10 bg-white text-muted shadow-sm active:cursor-grabbing"
            aria-label={`拖动当前第 ${index + 1} 页排序`}
            title="拖动排序"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={18} />
          </button>
            <div ref={menuRef} className="relative">
              <button type="button" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-white hover:text-ink" onClick={() => setMenuOpen((open) => !open)} aria-label={`第 ${index + 1} 页更多操作`} title="更多操作" aria-expanded={menuOpen}><MoreHorizontal size={19} /></button>
              {menuOpen && (
                <div className="absolute right-0 bottom-12 z-30 w-[190px] rounded-lg border border-black/10 bg-white p-3 shadow-2xl max-[540px]:w-[150px]">
                  <label className="block text-xs font-semibold text-ink">
                    移动到指定页
                    <span className="mt-2 flex items-center gap-2">
                      <input className="h-10 min-w-0 flex-1 rounded-md border border-black/15 px-2 text-center text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" type="number" min="1" max={pageCount} value={position} onChange={(event) => setPosition(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { submitPosition(); setMenuOpen(false) } }} disabled={disabled} aria-label={`将当前第 ${index + 1} 页移动到第几页`} />
                      <button type="button" className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand text-white" onClick={() => { submitPosition(); setMenuOpen(false) }} disabled={disabled} aria-label={`将当前页面移到第 ${position} 页`} title="确认移动"><MoveRight size={17} /></button>
                    </span>
                  </label>
                </div>
              )}
            </div>
          </>
        )}
      </footer>
    </article>
  )
}

export function PageEditorGrid(props: PageEditorGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(2)
  const rows = useMemo(() => Array.from({ length: Math.ceil(props.pages.length / columns) }, (_, index) => props.pages.slice(index * columns, index * columns + columns)), [columns, props.pages])
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => columns === 2 ? 360 : 500, overscan: 3 })
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setColumns(entry.contentRect.width < 330 ? 1 : 2))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ''
    if (overId && activeId !== overId) props.onMove(activeId, overId)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={props.pages.map((page) => page.id)} strategy={rectSortingStrategy}>
        <div ref={scrollRef} className="mt-4 h-[520px] overflow-y-auto px-1 [scrollbar-color:rgba(92,102,117,.35)_transparent] [scrollbar-width:thin] max-[900px]:h-[560px] max-[540px]:h-[500px]">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                key={virtualRow.key}
                className="absolute top-0 left-0 grid w-full grid-cols-2 items-start gap-4 pb-4 max-[540px]:gap-3 max-[330px]:grid-cols-1"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {rows[virtualRow.index].map((page) => (
                  <SortablePage key={page.id} {...props} page={page} index={props.pages.findIndex((item) => item.id === page.id)} pageCount={props.pages.length} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  )
}
