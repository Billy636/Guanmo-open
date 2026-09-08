import { describe, expect, it } from 'vitest'
import { registerBuiltinTools } from '@/services/agent/tools'
import { getTool } from '@/services/agent/toolRegistry'
import { detectIntentScores } from '@/services/agent/intentDetector'

describe('reading artifact agent tools', () => {
  it('registers read-only search and detail contracts', () => {
    registerBuiltinTools()
    const search = getTool('search_reading_artifacts')
    const detail = getTool('get_reading_artifact')
    expect(search?.effect).toBe('read')
    expect(search?.confirmationPolicy).toBe('never')
    expect(search?.parameters.map((item) => item.name)).toEqual(['query', 'types', 'documentPath', 'limit'])
    expect(detail?.effect).toBe('read')
    expect(detail?.confirmationPolicy).toBe('never')
    expect(detail?.parameters.map((item) => item.name)).toEqual(['key'])
  })

  it('routes artifact lookup separately from save proposals', () => {
    const read = detectIntentScores('搜索最近的阅读成果')
    expect(read.candidates).toContain('artifact_read')
    expect(read.required).toContain('artifact_read')
    expect(detectIntentScores('阅读成果有哪些').required).toContain('artifact_read')
    const save = detectIntentScores('保存为阅读成果')
    expect(save.candidates).toContain('action')
    expect(save.candidates).not.toContain('artifact_read')
  })
})
