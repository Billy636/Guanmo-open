import type { ChatMessageSource } from './types'
import { normalizeFilePath } from '@/services/pathIdentity'

export type SourceReferenceId = `S${number}`

export interface SourceReferenceEntry {
  id: SourceReferenceId
  source: ChatMessageSource
}

export interface SourceReferenceRegistry {
  entries: readonly SourceReferenceEntry[]
}

export type StoredSourceReferenceDisplayMode = 'confirmed' | 'web-results' | 'legacy-unconfirmed' | 'hidden'

export interface ParsedSourceReferences {
  content: string
  referencedIds: SourceReferenceId[]
  referencedSources: ChatMessageSource[]
  hasValidReferences: boolean
}

export interface StoredSourceReferenceSelection {
  sources: ChatMessageSource[]
  hasValidReferences: boolean
  displayMode: StoredSourceReferenceDisplayMode
}

export const SOURCE_REFERENCE_INSTRUCTION = '工具结果中的 referenceId 是可引用来源标签；如果回答使用了该结果，必须在对应事实附近保留 [Sx]（例如 [S1]），未使用的结果不要引用。'

const SOURCE_REFERENCE_TOKEN_REGEX = /\[S([1-9]\d*)\]/g

function isValidLineRange(startLine: unknown, endLine: unknown): boolean {
  return typeof startLine === 'number'
    && Number.isInteger(startLine)
    && startLine > 0
    && typeof endLine === 'number'
    && Number.isInteger(endLine)
    && endLine >= startLine
}

export function normalizeSafeWebSourceUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function getSourceIdentity(source: ChatMessageSource): string | null {
  if (source.kind === 'web') {
    const url = normalizeSafeWebSourceUrl(source.url)
    return url ? `web:${url}` : null
  }

  const filePath = normalizeFilePath(source.filePath)
  if (!filePath || !source.fileName.trim() || !isValidLineRange(source.startLine, source.endLine)) {
    return null
  }
  return `local:${filePath}:${source.startLine}:${source.endLine}`
}

function cloneSource(source: ChatMessageSource): ChatMessageSource {
  if (source.kind === 'web') return { ...source }
  return {
    ...source,
    ...(source.titlePath ? { titlePath: [...source.titlePath] } : {}),
  }
}

export function createSourceReferenceRegistry(
  sources: readonly ChatMessageSource[] = [],
): SourceReferenceRegistry {
  return registerSourceReferences({ entries: [] }, sources)
}

export function registerSourceReferences(
  registry: SourceReferenceRegistry,
  sources: readonly ChatMessageSource[],
): SourceReferenceRegistry {
  const entries = [...registry.entries]
  const idsByIdentity = new Map<string, SourceReferenceId>()

  for (const entry of entries) {
    const identity = getSourceIdentity(entry.source)
    if (identity) idsByIdentity.set(identity, entry.id)
  }

  for (const source of sources) {
    const identity = getSourceIdentity(source)
    if (!identity || idsByIdentity.has(identity)) continue

    const id = `S${entries.length + 1}` as SourceReferenceId
    entries.push({ id, source: cloneSource(source) })
    idsByIdentity.set(identity, id)
  }

  return { entries }
}

export function findSourceReferenceId(
  registry: SourceReferenceRegistry,
  source: ChatMessageSource,
): SourceReferenceId | undefined {
  const identity = getSourceIdentity(source)
  if (!identity) return undefined
  return registry.entries.find((entry) => getSourceIdentity(entry.source) === identity)?.id
}

export function parseSourceReferences(
  content: string,
  registry: SourceReferenceRegistry,
): ParsedSourceReferences {
  const entriesById = new Map(registry.entries.map((entry) => [entry.id, entry]))
  const referencedIds: SourceReferenceId[] = []
  const referencedSources: ChatMessageSource[] = []
  const seenIds = new Set<SourceReferenceId>()

  for (const match of content.matchAll(SOURCE_REFERENCE_TOKEN_REGEX)) {
    const id = `S${match[1]}` as SourceReferenceId
    const entry = entriesById.get(id)
    if (!entry || seenIds.has(id)) continue
    seenIds.add(id)
    referencedIds.push(id)
    referencedSources.push(entry.source)
  }

  return {
    content,
    referencedIds,
    referencedSources,
    hasValidReferences: referencedIds.length > 0,
  }
}

/**
 * 从持久化的完整候选来源中恢复正文实际引用的展示子集。
 * 旧消息没有 ID 时安全降级为完整候选来源；新消息没有合法引用时，本地候选保持空展示；安全的 Web 候选单独降级为
 * 未确认的联网检索结果，避免因模型漏写引用而完全丢失可追溯入口。
 */
export function resolveStoredSourceReferences(
  sources: readonly ChatMessageSource[] | undefined,
  referencedIds: readonly SourceReferenceId[] | undefined,
): StoredSourceReferenceSelection {
  const candidates = (sources ?? []).filter((source) => (
    source.kind !== 'web' || normalizeSafeWebSourceUrl(source.url) !== null
  ))
  if (referencedIds === undefined) {
    return {
      sources: candidates,
      hasValidReferences: false,
      displayMode: candidates.length > 0 ? 'legacy-unconfirmed' : 'hidden',
    }
  }

  const registry = createSourceReferenceRegistry(candidates)
  const entriesById = new Map(registry.entries.map((entry) => [entry.id, entry]))
  const selected: ChatMessageSource[] = []
  const seen = new Set<SourceReferenceId>()

  for (const id of referencedIds) {
    if (seen.has(id)) continue
    const entry = entriesById.get(id)
    if (!entry) continue
    seen.add(id)
    selected.push(entry.source)
  }

  return selected.length > 0
    ? { sources: selected, hasValidReferences: true, displayMode: 'confirmed' }
    : (() => {
        const webCandidates = candidates.filter((source) => source.kind === 'web')
        return webCandidates.length > 0
          ? { sources: webCandidates, hasValidReferences: false, displayMode: 'web-results' as const }
          : { sources: [], hasValidReferences: false, displayMode: 'hidden' as const }
      })()
}
