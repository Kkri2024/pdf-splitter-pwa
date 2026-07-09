import type { SplitMode } from './pdfSplitter'

export const HISTORY_STORAGE_KEY = 'pdf-splitter.history.v1'
export const HISTORY_STORAGE_VERSION = 1
export const HISTORY_MAX_ENTRIES = 20
export const HISTORY_RETENTION_DAYS = 30

export interface HistoryEntry {
  id: string
  createdAt: string
  sourceName: string
  sourceSize: number
  pageCount: number
  mode: SplitMode | 'merge'
  modeSummary: string
  outputCount: number
  outputBytes: number
}

export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'createdAt'>

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

interface HistoryPayload {
  version: typeof HISTORY_STORAGE_VERSION
  entries: HistoryEntry[]
}

const retentionMs = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

function defaultStorage(): HistoryStorage {
  return window.localStorage
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && typeof entry.createdAt === 'string'
    && Number.isFinite(Date.parse(entry.createdAt))
    && typeof entry.sourceName === 'string'
    && typeof entry.sourceSize === 'number'
    && typeof entry.pageCount === 'number'
    && ['fixed', 'each', 'custom', 'merge'].includes(String(entry.mode))
    && typeof entry.modeSummary === 'string'
    && typeof entry.outputCount === 'number'
    && typeof entry.outputBytes === 'number'
}

function pruneHistory(entries: HistoryEntry[], now: number): HistoryEntry[] {
  const cutoff = now - retentionMs
  return entries
    .filter((entry) => Date.parse(entry.createdAt) >= cutoff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, HISTORY_MAX_ENTRIES)
}

function writeHistory(entries: HistoryEntry[], storage: HistoryStorage): void {
  if (entries.length === 0) {
    storage.removeItem(HISTORY_STORAGE_KEY)
    return
  }
  const payload: HistoryPayload = { version: HISTORY_STORAGE_VERSION, entries }
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload))
}

export function loadHistory(
  storage: HistoryStorage = defaultStorage(),
  now = Date.now(),
): HistoryEntry[] {
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid history payload')
    const payload = parsed as Partial<HistoryPayload>
    if (payload.version !== HISTORY_STORAGE_VERSION || !Array.isArray(payload.entries)) {
      throw new Error('Unsupported history payload')
    }
    const entries = pruneHistory(payload.entries.filter(isHistoryEntry), now)
    writeHistory(entries, storage)
    return entries
  } catch {
    try {
      storage.removeItem(HISTORY_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    return []
  }
}

export function appendHistory(
  input: NewHistoryEntry,
  storage: HistoryStorage = defaultStorage(),
  now = Date.now(),
): HistoryEntry[] {
  const entry: HistoryEntry = {
    ...input,
    id: globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date(now).toISOString(),
  }
  const entries = pruneHistory([entry, ...loadHistory(storage, now)], now)
  try {
    writeHistory(entries, storage)
  } catch {
    return loadHistory(storage, now)
  }
  return entries
}

export function removeHistory(
  id: string,
  storage: HistoryStorage = defaultStorage(),
  now = Date.now(),
): HistoryEntry[] {
  const entries = loadHistory(storage, now).filter((entry) => entry.id !== id)
  try {
    writeHistory(entries, storage)
  } catch {
    return loadHistory(storage, now)
  }
  return entries
}

export function clearHistory(storage: HistoryStorage = defaultStorage()): void {
  try {
    storage.removeItem(HISTORY_STORAGE_KEY)
  } catch {
    // Clearing history should never interrupt the main PDF workflow.
  }
}
