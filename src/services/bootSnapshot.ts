import type { ReadingPosition } from '@/services/editorSession'
import type { Tab, ViewMode } from '@/stores/editorStore'
import { isWebRuntime } from '@/services/runtimeCapabilities'

export const BOOT_SNAPSHOT_STORAGE_KEY = 'guanmo-boot-snapshot'
export const BOOT_SNAPSHOT_VERSION = 2
export const BOOT_SNAPSHOT_CONTENT_LIMIT = 256_000

export type BootSnapshotReadingPositionScope = 'shared' | 'left'

export interface BootSnapshot {
  version: typeof BOOT_SNAPSHOT_VERSION
  capturedAt: number
  activeTab: {
    id: string
    title: string
    filePath: string
    content: string | null
  } | null
  viewMode: ViewMode
  readingPosition: ReadingPosition | null
  readingPositionScope: BootSnapshotReadingPositionScope | null
}

interface BootSnapshotState {
  tabs: Tab[]
  activeTabId: string | null
  viewMode: ViewMode
  readingPositions: Record<string, ReadingPosition>
}

let cachedSnapshot: BootSnapshot | null | undefined
let pendingSnapshot: BootSnapshot | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null

function isViewMode(value: unknown): value is ViewMode {
  return value === 'edit'
    || value === 'preview'
    || value === 'edit-preview'
    || value === 'dual-preview'
    || value === 'diff-preview'
}

export function parseBootSnapshot(raw: string | null): BootSnapshot | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Omit<Partial<BootSnapshot>, 'version'> & { version?: number }
    const activeTab = value.activeTab
    if ((value.version !== 1 && value.version !== BOOT_SNAPSHOT_VERSION) || !isViewMode(value.viewMode)) return null
    if (activeTab !== null && (
      !activeTab
      || typeof activeTab.id !== 'string'
      || typeof activeTab.title !== 'string'
      || typeof activeTab.filePath !== 'string'
      || (activeTab.content !== null && typeof activeTab.content !== 'string')
      || (typeof activeTab.content === 'string' && activeTab.content.length > BOOT_SNAPSHOT_CONTENT_LIMIT)
    )) return null
    if (value.version === 1) {
      return {
        ...value,
        version: BOOT_SNAPSHOT_VERSION,
        readingPosition: value.viewMode === 'dual-preview' ? value.readingPosition ?? null : null,
        readingPositionScope: value.viewMode === 'dual-preview' && value.readingPosition ? 'left' : null,
      } as BootSnapshot
    }
    if (value.readingPositionScope !== undefined
      && value.readingPositionScope !== null
      && value.readingPositionScope !== 'shared'
      && value.readingPositionScope !== 'left') return null
    return { ...value, readingPositionScope: value.readingPositionScope ?? null } as BootSnapshot
  } catch {
    return null
  }
}

export function createBootSnapshot(state: BootSnapshotState): BootSnapshot {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
  const snapshotTab = activeTab?.filePath && !activeTab.modified
    ? {
        id: activeTab.id,
        title: activeTab.title,
        filePath: activeTab.filePath,
        content: activeTab.content.length <= BOOT_SNAPSHOT_CONTENT_LIMIT
          ? activeTab.content
          : null,
      }
    : null
  const readingPositionScope = activeTab
    ? state.viewMode === 'dual-preview' && state.readingPositions[`${activeTab.id}:left`]
      ? 'left' as const
      : state.viewMode !== 'dual-preview' && state.readingPositions[activeTab.id]
        ? 'shared' as const
        : null
    : null
  return {
    version: BOOT_SNAPSHOT_VERSION,
    capturedAt: Date.now(),
    activeTab: snapshotTab,
    viewMode: state.viewMode,
    readingPosition: activeTab && readingPositionScope
      ? state.readingPositions[readingPositionScope === 'left' ? `${activeTab.id}:left` : activeTab.id] ?? null
      : null,
    readingPositionScope,
  }
}

export function getBootSnapshotReadingPositionKey(snapshot: BootSnapshot, tabId: string): string | null {
  if (!snapshot.readingPosition || !snapshot.readingPositionScope) return null
  return snapshot.readingPositionScope === 'left' ? `${tabId}:left` : tabId
}

export function mergeBootSnapshotReadingPosition(
  positions: Record<string, ReadingPosition>,
  tabId: string,
  snapshot: BootSnapshot,
): Record<string, ReadingPosition> {
  const key = getBootSnapshotReadingPositionKey(snapshot, tabId)
  if (!key || !snapshot.readingPosition) return positions
  return { ...positions, [key]: snapshot.readingPosition }
}

export function getBootSnapshotDisplayContent(content: string, topLine: number | undefined): {
  content: string
  startLine: number
} {
  if (!Number.isInteger(topLine) || (topLine as number) < 1) return { content, startLine: 1 }

  const lineStarts = [0]
  for (let index = 0; index < content.length;) {
    if (content[index] === '\r') {
      index += content[index + 1] === '\n' ? 2 : 1
      lineStarts.push(index)
    } else if (content[index] === '\n') {
      index += 1
      lineStarts.push(index)
    } else {
      index += 1
    }
  }
  const startIndex = Math.min((topLine as number) - 1, lineStarts.length - 1)
  return { content: content.slice(lineStarts[startIndex]), startLine: startIndex + 1 }
}

export function applyBootSnapshot(tabs: Tab[], activeTabId: string | null, snapshot: BootSnapshot | null): Tab[] {
  if (!snapshot?.activeTab || snapshot.activeTab.id !== activeTabId || snapshot.activeTab.content === null) {
    return tabs
  }
  const snapshotTab = snapshot.activeTab
  const snapshotContent = snapshotTab.content as string
  return tabs.map((tab) => {
    if (
      tab.id !== snapshotTab.id
      || tab.filePath !== snapshotTab.filePath
      || tab.modified
    ) return tab
    return {
      ...tab,
      title: snapshotTab.title,
      content: snapshotContent,
      savedContent: snapshotContent,
      originalContent: snapshotContent,
      modified: false,
    }
  })
}

export function readBootSnapshot(): BootSnapshot | null {
  if (isWebRuntime()) return null
  if (cachedSnapshot !== undefined) return cachedSnapshot
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(BOOT_SNAPSHOT_STORAGE_KEY)
  cachedSnapshot = parseBootSnapshot(raw)
  if (raw && !cachedSnapshot) localStorage.removeItem(BOOT_SNAPSHOT_STORAGE_KEY)
  return cachedSnapshot
}

export function hasBootSnapshotContent(tab: Tab): boolean {
  const snapshot = readBootSnapshot()
  return Boolean(
    snapshot?.activeTab
    && snapshot.activeTab.id === tab.id
    && snapshot.activeTab.filePath === tab.filePath
    && snapshot.activeTab.content === tab.content,
  )
}

export function flushBootSnapshotWrite(): void {
  if (isWebRuntime()) {
    pendingSnapshot = null
    return
  }
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (!pendingSnapshot || typeof localStorage === 'undefined') return
  cachedSnapshot = pendingSnapshot
  localStorage.setItem(BOOT_SNAPSHOT_STORAGE_KEY, JSON.stringify(pendingSnapshot))
  pendingSnapshot = null
}

export function scheduleBootSnapshotWrite(snapshot: BootSnapshot): void {
  if (isWebRuntime()) return
  pendingSnapshot = snapshot
  if (writeTimer !== null) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushBootSnapshotWrite, 250)
}

export function resetBootSnapshotCacheForTest(): void {
  cachedSnapshot = undefined
  pendingSnapshot = null
  if (writeTimer !== null) clearTimeout(writeTimer)
  writeTimer = null
}
