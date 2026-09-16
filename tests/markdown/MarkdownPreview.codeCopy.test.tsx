import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard
})

describe('MarkdownPreview 代码块复制', () => {
  it.each([
    ['有语言标记的高亮代码', '```js\nconst answer = 42;\nconsole.log(answer);\n```', '复制 js 代码', 'const answer = 42;\nconsole.log(answer);'],
    ['无语言标记的代码', '```\nplain text\nsecond line\n```', '复制代码', 'plain text\nsecond line'],
  ])('%s 复制原始代码文本', async (_name, content, buttonTitle, expected) => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    render(<MarkdownPreview content={content} />)
    fireEvent.click(screen.getByTitle(buttonTitle))

    expect(writeText).toHaveBeenCalledWith(expected)
  })
})
