import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'
import { createMarkdownPreviewModel, getVisibleTextProjection } from '@/services/markdownPreviewModel'

describe('MarkdownPreview GFM 删除线兼容', () => {
  it('关闭 singleTilde 后保留单波浪号并继续支持双波浪号删除线', async () => {
    const content = '1~2、3~4\n\n~测试~\n\n~~测试~~'
    const { container } = render(<MarkdownPreview content={content} />)

    await waitFor(() => expect(container.querySelectorAll('p')).toHaveLength(3))

    const paragraphs = Array.from(container.querySelectorAll('p'))
    expect(paragraphs[0]).toHaveTextContent('1~2、3~4')
    expect(paragraphs[0].querySelector('del')).toBeNull()
    expect(paragraphs[1]).toHaveTextContent('~测试~')
    expect(paragraphs[1].querySelector('del')).toBeNull()
    expect(paragraphs[2].querySelector('del')).toHaveTextContent('测试')

    const model = createMarkdownPreviewModel(content)
    expect(getVisibleTextProjection(model).text).toBe('1~2、3~4\n\n~测试~\n\n测试')
  })
})
