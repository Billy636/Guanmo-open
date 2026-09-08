import type { ReadingArtifactMessageReference } from '@/services/ai/types'
import type { ReadingArtifactItem } from '@/services/readingArtifactCenter'

export const MAX_ARTIFACT_REFERENCES = 10
const PREVIEW_LIMIT = 240

function trimPreview(value: unknown, limit = PREVIEW_LIMIT): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function toReadingArtifactMessageReference(
  item: ReadingArtifactItem,
  previewLimit = PREVIEW_LIMIT,
): ReadingArtifactMessageReference {
  const content = item.content || item.quote || item.question || item.title
  return {
    key: item.key,
    backing: item.backing,
    type: item.type,
    title: trimPreview(item.title, 120) || '阅读成果',
    preview: trimPreview(content, previewLimit),
    documentRefs: item.documentRefs.slice(0, 8).map((ref) => ({
      documentId: ref.documentId,
      ...(ref.filePath ? { filePath: ref.filePath } : {}),
      fileName: ref.fileName,
      locations: ref.locations.slice(0, 8).map((location) => ({
        ...(typeof location.startLine === 'number' ? { startLine: location.startLine } : {}),
        ...(typeof location.endLine === 'number' ? { endLine: location.endLine } : {}),
        ...(typeof location.startOffset === 'number' ? { startOffset: location.startOffset } : {}),
        ...(typeof location.endOffset === 'number' ? { endOffset: location.endOffset } : {}),
      })),
    })),
  }
}

function isReference(value: unknown): value is ReadingArtifactMessageReference {
  if (!value || typeof value !== 'object') return false
  const ref = value as Partial<ReadingArtifactMessageReference>
  return typeof ref.key === 'string'
    && /^(mark|ai):[^\s:]+$/.test(ref.key)
    && (ref.backing === 'reading_mark' || ref.backing === 'reading_artifact')
    && typeof ref.title === 'string'
    && typeof ref.preview === 'string'
    && Array.isArray(ref.documentRefs)
}

export function extractReadingArtifactReferences(
  toolName: string,
  rawResult: string,
): ReadingArtifactMessageReference[] {
  if (toolName !== 'search_reading_artifacts' && toolName !== 'get_reading_artifact') return []
  try {
    const parsed = JSON.parse(rawResult) as { results?: unknown[]; result?: unknown }
    const values = toolName === 'search_reading_artifacts'
      ? (Array.isArray(parsed.results) ? parsed.results : [])
      : (parsed.result ? [parsed.result] : [])
    const seen = new Set<string>()
    const refs: ReadingArtifactMessageReference[] = []
    for (const value of values) {
      if (!isReference(value) || seen.has(value.key)) continue
      seen.add(value.key)
      refs.push(value)
      if (refs.length >= MAX_ARTIFACT_REFERENCES) break
    }
    return refs
  } catch {
    return []
  }
}

export function mergeReadingArtifactReferences(
  current: readonly ReadingArtifactMessageReference[],
  next: readonly ReadingArtifactMessageReference[],
): ReadingArtifactMessageReference[] {
  const merged = [...current]
  const seen = new Set(merged.map((ref) => ref.key))
  for (const ref of next) {
    if (seen.has(ref.key)) continue
    seen.add(ref.key)
    merged.push(ref)
    if (merged.length >= MAX_ARTIFACT_REFERENCES) break
  }
  return merged
}
