import { describe, expect, it } from 'vitest'
import { getAgentProgressText, getAgentToolLabel } from '@/hooks/useAiChat'

describe('Agent 阶段展示文案', () => {
  it('为上下文读取显示开始阶段文案', () => {
    expect(getAgentProgressText({
      type: 'action',
      content: '调用工具: read_context_file',
      toolName: 'read_context_file',
      timestamp: 0,
    })).toBe('正在读取上下文...')
    expect(getAgentToolLabel('read_context_file')).toBe('上下文读取')
  })

  it('为文档修改工具显示开始阶段文案', () => {
    expect(getAgentProgressText({
      type: 'action',
      content: '调用工具: replace_current_tab_text',
      toolName: 'replace_current_tab_text',
      timestamp: 0,
    })).toBe('正在调用文档修改工具...')
    expect(getAgentToolLabel('replace_current_tab_text')).toBe('文档修改工具调用')
  })
})
