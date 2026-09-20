import { describe, expect, it } from 'vitest'
import { hideLikelyToolJsonPrefix } from '@/services/agent/toolCallParser'

describe('流式工具调用展示过滤', () => {
  it('在工具 JSON 尚未完整时隐藏结构化前缀', () => {
    expect(hideLikelyToolJsonPrefix('{')).toBe('')
    expect(hideLikelyToolJsonPrefix('{tool')).toBe('')
    expect(hideLikelyToolJsonPrefix('{"tool"')).toBe('')
    expect(hideLikelyToolJsonPrefix('{n')).toBe('')
    expect(hideLikelyToolJsonPrefix('{"n')).toBe('')
    expect(hideLikelyToolJsonPrefix('{"needsEditConfirmation"')).toBe('')
  })

  it('完整工具 JSON 仍不会泄漏到聊天消息', () => {
    expect(hideLikelyToolJsonPrefix('{"tool":"replace_current_tab_text","args":{}}')).toBe('')
  })

  it('普通正文不因以大括号开头而被隐藏', () => {
    expect(hideLikelyToolJsonPrefix('{这是普通正文')).toBe('{这是普通正文')
    expect(hideLikelyToolJsonPrefix('普通回答')).toBe('普通回答')
  })
})
