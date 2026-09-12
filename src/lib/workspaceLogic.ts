import type { MergePage } from './pdfMerger'

export type WorkspaceOwner = 'split' | 'merge'
export const pageOwner = (id: string): WorkspaceOwner => id.startsWith('page-') ? 'split' : 'merge'

export function removeOwnedEntries<T>(entries: Map<string, T>, owner: WorkspaceOwner, dispose?: (value: T) => void) {
  for (const [id, value] of entries) {
    if (pageOwner(id) !== owner) continue
    dispose?.(value)
    entries.delete(id)
  }
}

export function toggleSourcePages(current: MergePage[], pages: MergePage[]): MergePage[] {
  const selected = new Set(current.map(page => page.id))
  const ids = new Set(pages.map(page => page.id))
  return pages.every(page => selected.has(page.id))
    ? current.filter(page => !ids.has(page.id))
    : [...current, ...pages.filter(page => !selected.has(page.id))]
}

export function orderPagesBySources(pages: MergePage[], sourceIds: string[]): MergePage[] {
  return sourceIds.flatMap(id => pages.filter(page => page.sourceId === id))
}
