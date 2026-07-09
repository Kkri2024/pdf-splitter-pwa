import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendHistory,
  clearHistory,
  HISTORY_MAX_ENTRIES,
  HISTORY_STORAGE_KEY,
  HISTORY_STORAGE_VERSION,
  loadHistory,
  removeHistory,
  type NewHistoryEntry,
} from './history'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const baseEntry: NewHistoryEntry = {
  sourceName: '资料.pdf',
  sourceSize: 1024,
  pageCount: 8,
  mode: 'fixed',
  modeSummary: '每 2 页一份',
  outputCount: 4,
  outputBytes: 2048,
}

describe('history storage', () => {
  let storage: MemoryStorage
  const now = Date.UTC(2026, 6, 3, 10)

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('adds and loads metadata without file bytes', () => {
    const entries = appendHistory(baseEntry, storage, now)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject(baseEntry)
    const payload = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY)!)
    expect(payload.version).toBe(HISTORY_STORAGE_VERSION)
    expect(payload.entries[0]).not.toHaveProperty('bytes')
  })

  it('accepts multi-PDF merge history entries', () => {
    const entries = appendHistory({
      ...baseEntry,
      sourceName: '3 个 PDF',
      mode: 'merge',
      modeSummary: '多 PDF 合并：6 页',
      outputCount: 1,
    }, storage, now)
    expect(entries[0].mode).toBe('merge')
    expect(loadHistory(storage, now)[0].modeSummary).toBe('多 PDF 合并：6 页')
  })

  it('removes entries older than 30 days', () => {
    appendHistory(baseEntry, storage, now - 31 * 24 * 60 * 60 * 1000)
    expect(loadHistory(storage, now)).toEqual([])
  })

  it('keeps only the latest 20 entries', () => {
    for (let index = 0; index < HISTORY_MAX_ENTRIES + 5; index += 1) {
      appendHistory({ ...baseEntry, sourceName: `${index}.pdf` }, storage, now + index)
    }
    const entries = loadHistory(storage, now + HISTORY_MAX_ENTRIES + 5)
    expect(entries).toHaveLength(HISTORY_MAX_ENTRIES)
    expect(entries[0].sourceName).toBe('24.pdf')
    expect(entries.at(-1)?.sourceName).toBe('5.pdf')
  })

  it('recovers from corrupted cache data', () => {
    storage.setItem(HISTORY_STORAGE_KEY, '{broken')
    expect(loadHistory(storage, now)).toEqual([])
    expect(storage.getItem(HISTORY_STORAGE_KEY)).toBeNull()
  })

  it('removes one entry', () => {
    const [entry] = appendHistory(baseEntry, storage, now)
    appendHistory({ ...baseEntry, sourceName: '第二份.pdf' }, storage, now + 1)
    const entries = removeHistory(entry.id, storage, now + 2)
    expect(entries.map((item) => item.sourceName)).toEqual(['第二份.pdf'])
  })

  it('clears all entries', () => {
    appendHistory(baseEntry, storage, now)
    clearHistory(storage)
    expect(loadHistory(storage, now)).toEqual([])
  })
})
