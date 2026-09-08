import { loadDocumentContentHashByPath } from '@/services/database/persistence'
import {
  checkReadingArtifactSource,
  deleteReadingArtifact,
  loadReadingArtifactById,
  loadReadingArtifactsPage,
  persistReadingArtifact,
} from '@/services/database/readingArtifacts'
import type {
  ReadingArtifact,
  ReadingArtifactSourceAnchor,
  ReadingArtifactsPage,
  SourceAnchorCheck,
  PersistReadingArtifactInput,
  LoadReadingArtifactsPageOptions,
} from '@/services/database/readingArtifacts'
import {
  adaptAiReadingArtifact,
  adaptReadingMark,
  buildReadingArtifactItems,
  type ReadingArtifactItem,
} from '@/services/readingArtifactCenter'
import type { ReadingArtifactCenterPageOptions } from '@/services/database/readingArtifactCenter'
import { getReadingMarkById, type ReadingMark } from '@/services/readingMarks'
import type { WorkspaceRoot } from '@/services/workspaceIdentity'

export type {
  ReadingArtifact,
  ReadingArtifactReference,
  ReadingArtifactSourceAnchor,
  ReadingArtifactType,
  SourceAnchorStatus,
  SourceAnchorCheck,
  AnnotationStructuredContent,
  PersistReadingArtifactInput,
  LoadReadingArtifactsPageOptions,
} from '@/services/database/readingArtifacts'

export {
  buildReadingArtifactReferences,
  getAnnotationStructuredContent,
  getReadingArtifactQuestion,
  getReadingArtifactReferences,
  mergeReadingArtifactQuestionMetadata,
  mergeReadingArtifactReferencesMetadata,
  resolveAnnotationPosition,
} from '@/services/database/readingArtifacts'

export async function persistReadingArtifactCommand(input: PersistReadingArtifactInput): Promise<void> {
  return persistReadingArtifact(input)
}

export async function loadReadingArtifactsPageCommand(
  options: LoadReadingArtifactsPageOptions,
): Promise<ReadingArtifactsPage> {
  return loadReadingArtifactsPage(options)
}

export async function loadReadingArtifactByIdCommand(id: string): Promise<ReadingArtifact | undefined> {
  return loadReadingArtifactById(id)
}

export async function loadReadingArtifactItemsPageCommand(
  options: ReadingArtifactCenterPageOptions,
  workspaceRoots: readonly WorkspaceRoot[] = [],
): Promise<{ items: ReadingArtifactItem[]; total: number; hasMore: boolean }> {
  const { loadReadingArtifactCenterItemsPage } = await import('@/services/database/readingArtifactCenter')
  const page = await loadReadingArtifactCenterItemsPage(options)
  return {
    items: buildReadingArtifactItems(page.marks, page.artifacts, workspaceRoots),
    total: page.total,
    hasMore: page.hasMore,
  }
}

export async function loadReadingArtifactItemByKeyCommand(
  key: string,
  workspaceRoots: readonly WorkspaceRoot[] = [],
): Promise<{ item: ReadingArtifactItem; artifact?: ReadingArtifact } | undefined> {
  const match = key.match(/^(mark|ai):([^\s:]+)$/)
  if (!match) return undefined
  if (match[1] === 'mark') {
    try {
      const mark: ReadingMark = await getReadingMarkById(match[2])
      return { item: adaptReadingMark(mark, workspaceRoots) }
    } catch {
      return undefined
    }
  }
  const artifact = await loadReadingArtifactById(match[2])
  if (!artifact || artifact.status !== 'active') return undefined
  return { item: adaptAiReadingArtifact(artifact, workspaceRoots), artifact }
}

export async function deleteReadingArtifactCommand(id: string): Promise<void> {
  return deleteReadingArtifact(id)
}

export async function checkReadingArtifactSourceCommand(
  anchor: ReadingArtifactSourceAnchor,
): Promise<SourceAnchorCheck> {
  return checkReadingArtifactSource(anchor, loadDocumentContentHashByPath)
}

export function loadReadingArtifactSourceContentHash(filePath: string): Promise<string | undefined> {
  return loadDocumentContentHashByPath(filePath)
}
