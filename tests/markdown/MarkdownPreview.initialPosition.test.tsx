import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const OriginalResizeObserver = globalThis.ResizeObserver

function createPreviewHost() {
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientHeight: { configurable: true, value: 800 },
    clientWidth: { configurable: true, value: 600 },
    scrollTop: { configurable: true, value: 0, writable: true },
  })
  return host
}

function createLongDocument() {
  return Array.from({ length: 180 }, (_, index) => `第 ${index + 1} 段内容`).join('\n\n')
}

beforeEach(() => {
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver
})

describe('MarkdownPreview 初始阅读位置', () => {
  it('首次可见回调前写入精确 scrollTop，并直接挂载目标虚拟窗口', () => {
    const host = createPreviewHost()
    let firstVisibleTop = -1

    render(
      <MarkdownPreview
        content={createLongDocument()}
        documentKey="preview-scroll"
        initialScrollTop={3200}
        onFirstVisible={() => { firstVisibleTop = host.scrollTop }}
      />,
      { container: host },
    )

    const mountedIndices = Array.from(host.querySelectorAll<HTMLElement>('[data-md-block-index]'))
      .map((element) => Number(element.dataset.mdBlockIndex))
    expect(firstVisibleTop).toBe(3200)
    expect(Math.min(...mountedIndices)).toBeGreaterThan(0)
  })

  it('缺少像素位置时使用 topLine 建立首帧虚拟窗口', () => {
    const host = createPreviewHost()
    let firstVisibleTop = -1

    render(
      <MarkdownPreview
        content={createLongDocument()}
        documentKey="preview-line"
        initialTopLine={121}
        onFirstVisible={() => { firstVisibleTop = host.scrollTop }}
      />,
      { container: host },
    )

    const mountedIndices = Array.from(host.querySelectorAll<HTMLElement>('[data-md-block-index]'))
      .map((element) => Number(element.dataset.mdBlockIndex))
    expect(firstVisibleTop).toBeGreaterThan(0)
    expect(Math.min(...mountedIndices)).toBeGreaterThan(0)
  })

  it('隐藏预热实例等到真正可见时才应用初始位置', () => {
    const host = createPreviewHost()
    let firstVisibleTop = -1
    const preview = (
      <MarkdownPreview
        content={createLongDocument()}
        documentKey="preview-hidden"
        initialScrollTop={1800}
        isVisible={false}
        onFirstVisible={() => { firstVisibleTop = host.scrollTop }}
      />
    )
    const { rerender } = render(preview, { container: host })

    expect(host.scrollTop).toBe(0)
    expect(firstVisibleTop).toBe(-1)

    rerender(
      <MarkdownPreview
        content={createLongDocument()}
        documentKey="preview-hidden"
        initialScrollTop={1800}
        isVisible
        onFirstVisible={() => { firstVisibleTop = host.scrollTop }}
      />,
    )

    expect(host.scrollTop).toBe(1800)
    expect(firstVisibleTop).toBe(1800)
  })
})
