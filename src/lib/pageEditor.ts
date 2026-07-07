import { getPdfBaseName, makeOutputName, parseRangeSpec, type PageRange, type SplitMode } from './pdfSplitter'

export type PageRotation = 0 | 90 | 180 | 270
export type SelectionOutputMode = 'merged' | 'segments'

export interface EditablePage {
  id: string
  sourcePageIndex: number
  rotation: PageRotation
}

export interface PageEditSnapshot {
  pages: EditablePage[]
  selectedIds: string[]
}

export interface PageEditState {
  original: EditablePage[]
  present: PageEditSnapshot
  past: PageEditSnapshot[]
  future: PageEditSnapshot[]
}

export type PageEditAction =
  | { type: 'initialize'; pageCount: number }
  | { type: 'toggle'; id: string }
  | { type: 'select-all' }
  | { type: 'clear-selection' }
  | { type: 'set-selection'; ids: string[] }
  | { type: 'rotate'; direction: -1 | 1 }
  | { type: 'delete-selected' }
  | { type: 'move'; activeId: string; overId: string }
  | { type: 'move-to'; id: string; position: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'restore' }

export interface OutputJob {
  name: string
  pages: EditablePage[]
  range?: PageRange
}

const cloneSnapshot = (snapshot: PageEditSnapshot): PageEditSnapshot => ({
  pages: snapshot.pages.map((page) => ({ ...page })),
  selectedIds: [...snapshot.selectedIds],
})

export function createPageEditState(pageCount: number): PageEditState {
  const original = Array.from({ length: pageCount }, (_, sourcePageIndex) => ({
    id: `page-${sourcePageIndex + 1}`,
    sourcePageIndex,
    rotation: 0 as const,
  }))
  return { original, present: { pages: original, selectedIds: [] }, past: [], future: [] }
}

function commit(state: PageEditState, present: PageEditSnapshot): PageEditState {
  return {
    ...state,
    present,
    past: [...state.past.slice(-49), cloneSnapshot(state.present)],
    future: [],
  }
}

export function pageEditReducer(state: PageEditState, action: PageEditAction): PageEditState {
  if (action.type === 'initialize') return createPageEditState(action.pageCount)
  const { pages, selectedIds } = state.present
  if (action.type === 'toggle') {
    const next = new Set(selectedIds)
    if (next.has(action.id)) next.delete(action.id)
    else next.add(action.id)
    return { ...state, present: { pages, selectedIds: [...next] } }
  }
  if (action.type === 'select-all') return { ...state, present: { pages, selectedIds: pages.map((page) => page.id) } }
  if (action.type === 'clear-selection') return { ...state, present: { pages, selectedIds: [] } }
  if (action.type === 'set-selection') {
    const valid = new Set(pages.map((page) => page.id))
    return { ...state, present: { pages, selectedIds: action.ids.filter((id) => valid.has(id)) } }
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1)
    if (!previous) return state
    return { ...state, present: previous, past: state.past.slice(0, -1), future: [cloneSnapshot(state.present), ...state.future].slice(0, 50) }
  }
  if (action.type === 'redo') {
    const next = state.future[0]
    if (!next) return state
    return { ...state, present: next, past: [...state.past, cloneSnapshot(state.present)].slice(-50), future: state.future.slice(1) }
  }
  if (action.type === 'restore') {
    const restored = { pages: state.original.map((page) => ({ ...page })), selectedIds: [] }
    return commit(state, restored)
  }
  if (action.type === 'rotate') {
    if (selectedIds.length === 0) return state
    const selected = new Set(selectedIds)
    const nextPages = pages.map((page) => selected.has(page.id)
      ? { ...page, rotation: ((page.rotation + action.direction * 90 + 360) % 360) as PageRotation }
      : page)
    return commit(state, { pages: nextPages, selectedIds })
  }
  if (action.type === 'delete-selected') {
    if (selectedIds.length === 0 || selectedIds.length >= pages.length) return state
    const selected = new Set(selectedIds)
    return commit(state, { pages: pages.filter((page) => !selected.has(page.id)), selectedIds: [] })
  }

  const from = pages.findIndex((page) => page.id === (action.type === 'move' ? action.activeId : action.id))
  const to = action.type === 'move'
    ? pages.findIndex((page) => page.id === action.overId)
    : Math.max(0, Math.min(pages.length - 1, action.position - 1))
  if (from < 0 || to < 0 || from === to) return state
  const nextPages = [...pages]
  const [moved] = nextPages.splice(from, 1)
  nextPages.splice(to, 0, moved)
  return commit(state, { pages: nextPages, selectedIds })
}

export function rangesToSelectedIds(ranges: PageRange[], pages: EditablePage[]): string[] {
  const ids = new Set<string>()
  ranges.forEach((range) => pages.slice(range.start - 1, range.end).forEach((page) => ids.add(page.id)))
  return pages.filter((page) => ids.has(page.id)).map((page) => page.id)
}

export function selectedIdsToRangeSpec(selectedIds: string[], pages: EditablePage[]): string {
  const selected = new Set(selectedIds)
  const positions = pages.flatMap((page, index) => selected.has(page.id) ? [index + 1] : [])
  if (positions.length === 0) return ''
  const ranges: string[] = []
  let start = positions[0]
  let end = start
  for (const position of positions.slice(1)) {
    if (position === end + 1) end = position
    else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`)
      start = position
      end = position
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`)
  return ranges.join(',')
}

export function createOutputJobs(
  mode: SplitMode,
  pages: EditablePage[],
  sourceName: string,
  options: { pagesPerFile?: number; rangeSpec?: string; selectionOutputMode?: SelectionOutputMode } = {},
): OutputJob[] {
  const baseName = getPdfBaseName(sourceName)
  if (pages.length === 0) return []
  if (mode === 'custom') {
    const ranges = parseRangeSpec(options.rangeSpec ?? '', pages.length)
    if (options.selectionOutputMode === 'merged') {
      const ids = rangesToSelectedIds(ranges, pages)
      const selected = new Set(ids)
      return [{ name: `${baseName}_selected.pdf`, pages: pages.filter((page) => selected.has(page.id)) }]
    }
    return ranges.map((range) => ({
      name: makeOutputName(baseName, range, pages.length),
      pages: pages.slice(range.start - 1, range.end),
      range,
    }))
  }
  const chunkSize = mode === 'each' ? 1 : options.pagesPerFile
  if (!Number.isInteger(chunkSize) || (chunkSize ?? 0) < 1) throw new Error('每份页数必须是大于 0 的整数')
  const jobs: OutputJob[] = []
  for (let start = 0; start < pages.length; start += chunkSize!) {
    const range = { start: start + 1, end: Math.min(start + chunkSize!, pages.length) }
    jobs.push({ name: makeOutputName(baseName, range, pages.length), pages: pages.slice(start, range.end), range })
  }
  return jobs
}

export function createEditedExportJob(pages: EditablePage[], sourceName: string): OutputJob {
  return { name: `${getPdfBaseName(sourceName)}_edited.pdf`, pages }
}
