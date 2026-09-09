import { describe, expect, it } from 'vitest'
import { encodeChatMessageMetadata, sanitizeSourceReferenceIds } from '@/stores/chatStore'
import type { ChatMessage } from '@/services/ai/types'

describe('chat message source metadata compatibility', () => {
  it('保存完整候选来源和可选已引用 ID，不覆盖来源快照', () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '匿名回答 [S2]',
      sources: [
        {
          kind: 'local',
          filePath: 'C:\\Temp\\candidate.md',
          fileName: 'candidate.md',
          startLine: 1,
          endLine: 2,
        },
        {
          kind: 'web',
          title: '匿名网页',
          url: 'https://example.com/anonymous',
        },
      ],
      referencedSourceIds: ['S2'],
    }

    expect(JSON.parse(encodeChatMessageMetadata(message)!)).toEqual({
      sources: message.sources,
      referencedSourceIds: ['S2'],
    })
  })

  it('旧 metadata 缺少引用字段且异常 ID 会安全降级', () => {
    expect(sanitizeSourceReferenceIds(undefined)).toBeUndefined()
    expect(sanitizeSourceReferenceIds(['S2', 'S2', 'S0', 'S01', 'Sx', 3])).toEqual(['S2'])
  })
})
