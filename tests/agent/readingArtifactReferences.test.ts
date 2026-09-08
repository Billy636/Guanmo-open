import { describe, expect, it } from 'vitest'
import {
  extractReadingArtifactReferences,
  mergeReadingArtifactReferences,
  toReadingArtifactMessageReference,
} from '@/services/agent/readingArtifactReferences'

const item = {
  key: 'mark:m1' as const,
  id: 'm1',
  backing: 'reading_mark' as const,
  source: 'user' as const,
  type: 'annotation' as const,
  title: '批注',
  documentRefs: [{ documentId: 'path:doc.md', filePath: 'doc.md', fileName: 'doc.md', locations: [{ startLine: 2, endLine: 3 }] }],
  content: '一段保存的批注',
  createdAt: 2,
  updatedAt: 2,
}

describe('reading artifact message references', () => {
  it('serializes search/detail results and ignores corrupted payloads', () => {
    const ref = toReadingArtifactMessageReference(item)
    expect(extractReadingArtifactReferences('search_reading_artifacts', JSON.stringify({ results: [ref, ref, null] }))).toEqual([ref])
    expect(extractReadingArtifactReferences('get_reading_artifact', JSON.stringify({ result: ref }))).toEqual([ref])
    expect(extractReadingArtifactReferences('search_reading_artifacts', '{broken')).toEqual([])
  })

  it('deduplicates and caps references', () => {
    const refs = Array.from({ length: 12 }, (_, index) => ({ ...toReadingArtifactMessageReference(item), key: `mark:m${index}` as const }))
    expect(mergeReadingArtifactReferences([], refs)).toHaveLength(10)
    expect(mergeReadingArtifactReferences([refs[0]], [refs[0], refs[1]])).toHaveLength(2)
  })
})
