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
import { Check, GripVertical, MoveRight } from 'lucide-react'
import type { EditablePage } from '../lib/pageEditor'
import type { Thumbnail } from '../lib/pdfPreview'

interface PageEditorGridProps {
  pages: EditablePage[]
  selectedIds: string[]
  thumbnails: Record<string, Thumbnail>
  disabled: boolean
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
  onToggle,
  onMoveTo,
  onOpen,
  onRequestThumbnail,
}: SortablePageProps) {
  const thumbnail = thumbnails[page.id]
  const selected = selectedIds.includes(page.id)
  const [position, setPosition] = useState(String(index + 1))
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled })

  useEffect(() => setPosition(String(index + 1)), [index])
  useEffect(() => { onRequestThumbnail(page) }, [onRequestThumbnail, page, thumbnail])

  const submitPosition = () => {
    const next = Number(position)
    if (Number.isInteger(next) && next >= 1 && next <= pageCount) onMoveTo(page.id, next)
    else setPosition(String(index + 1))
  }

  return (
    <article
      ref={setNodeRef}
      className={`group/page relative min-w-0 overflow-hidden rounded-md border bg-white shadow-[0_6px_18px_rgba(31,43,58,.1)] transition-all duration-200 ${selected ? 'border-brand ring-3 ring-brand/15' : 'border-black/10'} ${isDragging ? 'z-10 opacity-70 shadow-2xl' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className="block w-full cursor-zoom-in border-0 bg-transparent p-0" onClick={() => onOpen(page.id)} aria-label={`全屏查看当前第 ${index + 1} 页`}>
        {thumbnail ? (
          <img className="block h-auto w-full bg-white object-contain" style={{ aspectRatio: `${thumbnail.width} / ${thumbnail.height}` }} src={thumbnail.url} alt={`当前第 ${index + 1} 页预览`} />
        ) : (
          <span className="grid aspect-[.71] w-full place-items-center bg-slate-100 text-xs text-faint">准备预览...</span>
        )}
      </button>
      <footer className={selected ? 'border-t border-brand/15 bg-brand-soft/55' : 'border-t border-black/8 bg-slate-50/90'}>
        <div className="flex min-h-12 items-center gap-2 px-2.5">
          <button
            type="button"
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${selected ? 'border-brand bg-brand text-white' : 'border-black/10 bg-white text-muted hover:border-brand/30 hover:text-brand'}`}
            onClick={() => onToggle(page.id)}
            aria-label={`${selected ? '取消选择' : '选择'}当前第 ${index + 1} 页`}
          >
            <span className={`grid size-5 place-items-center rounded-md border ${selected ? 'border-white/30 bg-white/15' : 'border-black/15 bg-slate-50'}`}><Check className={selected ? 'opacity-100' : 'opacity-0'} size={14} /></span>
            {selected ? '已选中' : '选中'}
          </button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">当前第 {index + 1} 页 · 原第 {page.sourcePageIndex + 1} 页{page.rotation ? ` · ${page.rotation}°` : ''}</span>
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
        </div>
        <label className="flex min-h-12 items-center justify-end gap-1 border-t border-black/8 px-2 text-xs font-medium text-muted" title="将当前页面移动到指定位置">
          <span>移动到第</span>
          <input
            className="h-9 w-12 rounded-md border border-black/15 bg-white px-1 text-center text-sm font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            type="number"
            min="1"
            max={pageCount}
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submitPosition() }}
            disabled={disabled}
            aria-label={`将当前第 ${index + 1} 页移动到第几页`}
          />
          <span>页</span>
          <button type="button" className="grid size-10 place-items-center rounded-lg text-brand hover:bg-white disabled:opacity-40" onClick={submitPosition} disabled={disabled} aria-label={`将当前页面移到第 ${position} 页`} title="确认移动"><MoveRight size={17} /></button>
        </label>
      </footer>
    </article>
  )
}

export function PageEditorGrid(props: PageEditorGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(2)
  const rows = useMemo(() => Array.from({ length: Math.ceil(props.pages.length / columns) }, (_, index) => props.pages.slice(index * columns, index * columns + columns)), [columns, props.pages])
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => columns === 2 ? 420 : 560, overscan: 3 })
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
