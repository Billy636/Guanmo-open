import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownImage } from '@/components/editor/MarkdownImage'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'

const mocks = vi.hoisted(() => ({
  desktop: true,
  prepare: vi.fn<(markdown: string, image: string) => Promise<string>>(),
  convert: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}))
vi.mock('@/hooks/useTauri', () => ({
  isTauri: () => mocks.desktop,
  prepareMarkdownImage: mocks.prepare,
}))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: mocks.convert }))

beforeEach(() => {
  mocks.desktop = true
  mocks.prepare.mockReset().mockImplementation(async (_markdown, image) => image)
})
afterEach(cleanup)

describe('Markdown image preview authorization', () => {
  it('authorizes a typed Chinese sibling image before emitting an asset URL', async () => {
    let authorize!: (path: string) => void
    mocks.prepare.mockReturnValue(new Promise((resolve) => { authorize = resolve }))
    const onZoom = vi.fn()
    render(<MarkdownImage src="模型111极图_文献配色.png" filePath={'C:\\notes\\新建文本文档.md'} alt="Fig2test" onZoom={onZoom} />)
    expect(mocks.prepare).toHaveBeenCalledWith('C:\\notes\\新建文本文档.md', 'C:/notes/模型111极图_文献配色.png')
    expect(screen.getByAltText('Fig2test').getAttribute('src')).toBeNull()
    expect(mocks.convert).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button'))
    expect(onZoom).not.toHaveBeenCalled()
    await act(async () => authorize('C:/notes/模型111极图_文献配色.png'))
    const src = screen.getByAltText('Fig2test').getAttribute('src')
    expect(src).toContain('asset://localhost/')
    fireEvent.click(screen.getByRole('button'))
    expect(onZoom).toHaveBeenCalledWith({ src, alt: 'Fig2test' })
  })

  it('uses the authorization path in the real Markdown renderer without inserting an image', async () => {
    render(<MarkdownPreview content="![Fig2test](模型111极图_文献配色.png)" filePath="C:/notes/test.md" />)
    await waitFor(() => expect(screen.getByAltText('Fig2test').getAttribute('src')).toContain('asset://localhost/'))
    expect(mocks.prepare).toHaveBeenCalledWith('C:/notes/test.md', 'C:/notes/模型111极图_文献配色.png')
  })

  it.each([
    ['./assets/figure.png', 'C:/notes/assets/figure.png'],
    [encodeURI('模型 图.png'), 'C:/notes/模型 图.png'],
    ['C:\\notes\\figure.png', 'C:/notes/figure.png'],
    ['//server/share/figure.png', '//server/share/figure.png'],
    ['/notes/figure.png', '/notes/figure.png'],
    ['100%bad.png', 'C:/notes/100%bad.png'],
  ])('resolves %s before requesting authorization', async (src, path) => {
    render(<MarkdownImage src={src} filePath="C:/notes/test.md" alt="figure" onZoom={vi.fn()} />)
    await waitFor(() => expect(screen.getByAltText('figure').getAttribute('src')).toBeTruthy())
    expect(mocks.prepare).toHaveBeenCalledWith('C:/notes/test.md', path)
  })

  it.each(['https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:example', 'asset://localhost/a', 'file:///a.png', '#figure'])('leaves %s unchanged', (src) => {
    render(<MarkdownImage src={src} filePath="C:/notes/test.md" alt="figure" onZoom={vi.fn()} />)
    expect(screen.getByAltText('figure').getAttribute('src')).toBe(src)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('preserves browser and unsaved-document behavior', () => {
    mocks.desktop = false
    const { rerender } = render(<MarkdownImage src="figure.png" filePath="C:/notes/test.md" alt="figure" onZoom={vi.fn()} />)
    expect(screen.getByAltText('figure').getAttribute('src')).toBe('figure.png')
    mocks.desktop = true
    rerender(<MarkdownImage src="figure.png" filePath={null} alt="figure" onZoom={vi.fn()} />)
    expect(screen.getByAltText('figure').getAttribute('src')).toBe('figure.png')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('does not issue an asset request when authorization fails', async () => {
    mocks.prepare.mockRejectedValue(new Error('outside the Markdown directory'))
    render(<MarkdownImage src="C:/private/secret.png" filePath="C:/notes/test.md" alt="figure" onZoom={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button').getAttribute('title')).toContain('无法加载图片'))
    expect(screen.getByAltText('figure').getAttribute('src')).toBeNull()
    expect(mocks.convert).not.toHaveBeenCalled()
  })

  it('ignores an old authorization result after switching documents', async () => {
    let resolveOld!: (path: string) => void
    mocks.prepare.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const { rerender } = render(<MarkdownImage src="figure.png" filePath="C:/old/test.md" alt="figure" onZoom={vi.fn()} />)
    rerender(<MarkdownImage src="figure.png" filePath="C:/new/test.md" alt="figure" onZoom={vi.fn()} />)
    await waitFor(() => expect(screen.getByAltText('figure').getAttribute('src')).toContain(encodeURIComponent('C:/new/figure.png')))
    await act(async () => resolveOld('C:/old/figure.png'))
    expect(screen.getByAltText('figure').getAttribute('src')).toContain(encodeURIComponent('C:/new/figure.png'))
  })

  it('does not keep a previous image visible while a new path is awaiting authorization', async () => {
    const { rerender } = render(<MarkdownImage src="first.png" filePath="C:/notes/test.md" alt="figure" onZoom={vi.fn()} />)
    await waitFor(() => expect(screen.getByAltText('figure').getAttribute('src')).toBeTruthy())
    mocks.prepare.mockReturnValue(new Promise(() => {}))
    rerender(<MarkdownImage src="second.png" filePath="C:/notes/test.md" alt="figure" onZoom={vi.fn()} />)
    expect(screen.getByAltText('figure').getAttribute('src')).toBeNull()
  })
})
