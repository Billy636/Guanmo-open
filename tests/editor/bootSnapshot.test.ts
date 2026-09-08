import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useTauri', () => ({
  isTauri: () => true,
}))

import {
  BOOT_SNAPSHOT_CONTENT_LIMIT,
  BOOT_SNAPSHOT_STORAGE_KEY,
  BOOT_SNAPSHOT_VERSION,
  applyBootSnapshot,
  createBootSnapshot,
  getBootSnapshotDisplayContent,
  mergeBootSnapshotReadingPosition,
  readBootSnapshot,
  resetBootSnapshotCacheForTest,
} from '@/services/bootSnapshot'
import type { Tab } from '@/stores/editorStore'

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'active',
    title: 'active.md',
    filePath: 'D:\\notes\\active.md',
    content: '# cached',
    savedContent: '# cached',
    originalContent: '# cached',
    modified: false,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  resetBootSnapshotCacheForTest()
})

describe('boot snapshot', () => {
  it('stores only the active disk document and essential first-screen state', () => {
    const snapshot = createBootSnapshot({
      tabs: [tab(), tab({ id: 'other', filePath: null, content: 'draft', modified: true })],
      activeTabId: 'active',
      viewMode: 'preview',
      readingPositions: { active: { editorScrollTop: 120 } },
    })

    expect(snapshot.activeTab?.content).toBe('# cached')
    expect(snapshot.viewMode).toBe('preview')
    expect(snapshot.readingPosition?.editorScrollTop).toBe(120)
    expect(snapshot.readingPositionScope).toBe('shared')
  })

  it('selects the position scope that matches the startup mode', () => {
    const positions = {
      active: { editorScrollTop: 120, topLine: 12 },
      'active:left': { previewScrollTop: 1440, topLine: 120 },
    }
    const active = tab()

    const editSnapshot = createBootSnapshot({
      tabs: [active],
      activeTabId: active.id,
      viewMode: 'edit',
      readingPositions: positions,
    })
    const dualSnapshot = createBootSnapshot({
      tabs: [active],
      activeTabId: active.id,
      viewMode: 'dual-preview',
      readingPositions: positions,
    })

    expect(editSnapshot.readingPositionScope).toBe('shared')
    expect(editSnapshot.readingPosition?.editorScrollTop).toBe(120)
    expect(dualSnapshot.readingPositionScope).toBe('left')
    expect(dualSnapshot.readingPosition?.previewScrollTop).toBe(1440)

    const dualWithoutLeft = createBootSnapshot({
      tabs: [active],
      activeTabId: active.id,
      viewMode: 'dual-preview',
      readingPositions: { active: positions.active },
    })
    expect(dualWithoutLeft.readingPosition).toBeNull()
    expect(dualWithoutLeft.readingPositionScope).toBeNull()
  })

  it('migrates v1 dual-preview positions but does not trust ambiguous non-dual positions', () => {
    localStorage.setItem(BOOT_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      version: 1,
      capturedAt: Date.now(),
      viewMode: 'dual-preview',
      readingPosition: { previewScrollTop: 1440, topLine: 120 },
      activeTab: null,
    }))
    const dual = readBootSnapshot()
    expect(dual?.version).toBe(BOOT_SNAPSHOT_VERSION)
    expect(dual?.readingPositionScope).toBe('left')

    resetBootSnapshotCacheForTest()
    localStorage.setItem(BOOT_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      version: 1,
      capturedAt: Date.now(),
      viewMode: 'edit',
      readingPosition: { previewScrollTop: 1440, topLine: 120 },
      activeTab: null,
    }))
    const edit = readBootSnapshot()
    expect(edit?.readingPosition).toBeNull()
    expect(edit?.readingPositionScope).toBeNull()
  })

  it('writes a v2 boot position back to its scoped key', () => {
    const snapshot = createBootSnapshot({
      tabs: [tab()],
      activeTabId: 'active',
      viewMode: 'dual-preview',
      readingPositions: { 'active:left': { previewScrollTop: 1440 } },
    })
    const merged = mergeBootSnapshotReadingPosition({ active: { editorScrollTop: 120 } }, 'active', snapshot)
    expect(merged.active).toMatchObject({ editorScrollTop: 120 })
    expect(merged['active:left']).toMatchObject({ previewScrollTop: 1440 })
  })

  it('anchors the startup snapshot at a valid line and clamps invalid lines', () => {
    const content = 'line 1\r\nline 2\r\nline 3\r\nline 4'
    expect(getBootSnapshotDisplayContent(content, 3)).toEqual({ content: 'line 3\r\nline 4', startLine: 3 })
    expect(getBootSnapshotDisplayContent(content, 99)).toEqual({ content: 'line 4', startLine: 4 })
    expect(getBootSnapshotDisplayContent(content, undefined)).toEqual({ content, startLine: 1 })
  })

  it('drops large document bodies while keeping metadata for disk fallback', () => {
    const snapshot = createBootSnapshot({
      tabs: [tab({ content: 'x'.repeat(BOOT_SNAPSHOT_CONTENT_LIMIT + 1) })],
      activeTabId: 'active',
      viewMode: 'edit',
      readingPositions: {},
    })

    expect(snapshot.activeTab?.content).toBeNull()
  })

  it('applies matching cached content without touching modified or mismatched tabs', () => {
    const snapshot = createBootSnapshot({
      tabs: [tab()],
      activeTabId: 'active',
      viewMode: 'edit',
      readingPositions: {},
    })
    const compacted = tab({ content: '', savedContent: '', originalContent: '' })

    expect(applyBootSnapshot([compacted], 'active', snapshot)[0].content).toBe('# cached')
    expect(applyBootSnapshot([{ ...compacted, modified: true }], 'active', snapshot)[0].content).toBe('')
    expect(applyBootSnapshot([{ ...compacted, filePath: 'D:\\other.md' }], 'active', snapshot)[0].content).toBe('')
  })

  it('rejects corrupt and incompatible snapshots', () => {
    localStorage.setItem(BOOT_SNAPSHOT_STORAGE_KEY, '{broken')
    expect(readBootSnapshot()).toBeNull()
    expect(localStorage.getItem(BOOT_SNAPSHOT_STORAGE_KEY)).toBeNull()

    resetBootSnapshotCacheForTest()
    localStorage.setItem(BOOT_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      version: BOOT_SNAPSHOT_VERSION + 1,
      viewMode: 'edit',
      activeTab: null,
    }))
    expect(readBootSnapshot()).toBeNull()
  })

  it('rejects snapshot bodies above the startup content limit', () => {
    localStorage.setItem(BOOT_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      version: BOOT_SNAPSHOT_VERSION,
      capturedAt: Date.now(),
      viewMode: 'edit',
      readingPosition: null,
      activeTab: {
        id: 'active',
        title: 'active.md',
        filePath: 'D:\\notes\\active.md',
        content: 'x'.repeat(BOOT_SNAPSHOT_CONTENT_LIMIT + 1),
      },
    }))

    expect(readBootSnapshot()).toBeNull()
    expect(localStorage.getItem(BOOT_SNAPSHOT_STORAGE_KEY)).toBeNull()
  })

  it('does not duplicate unsaved tabs into the snapshot', () => {
    const snapshot = createBootSnapshot({
      tabs: [tab({ filePath: null, content: 'unsaved', modified: true })],
      activeTabId: 'active',
      viewMode: 'edit',
      readingPositions: {},
    })
    expect(snapshot.activeTab).toBeNull()
  })
})
