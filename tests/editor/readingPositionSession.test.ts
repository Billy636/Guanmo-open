import { describe, expect, it } from 'vitest'

import { ReadingPositionSession } from '@/services/editorSession'

describe('ReadingPositionSession', () => {
  it('跨编辑和预览模式时只保留最近模式的精确滚动位置', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', { previewScrollTop: 320, topLine: 24 })
    session.save('tab-1', { editorScrollTop: 960, topLine: 80 })

    expect(session.get('tab-1')).toMatchObject({
      editorScrollTop: 960,
      previewScrollTop: undefined,
      topLine: 80,
    })

    session.save('tab-1', { previewScrollTop: 1440, topLine: 120 })

    expect(session.get('tab-1')).toMatchObject({
      editorScrollTop: undefined,
      previewScrollTop: 1440,
      topLine: 120,
    })
  })

  it('载入旧版冲突位置时回退到共享行号', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', {
      editorScrollTop: 960,
      previewScrollTop: 1440,
      topLine: 120,
    })

    expect(session.get('tab-1')).toMatchObject({
      editorScrollTop: undefined,
      previewScrollTop: undefined,
      topLine: 120,
    })
  })

  it('进入对照阅读时用共享行号替换栏位旧位置', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', { editorScrollTop: 960, topLine: 80 })
    session.saveForPane('tab-1', 'left', { previewScrollTop: 120 })
    session.saveForPane('tab-1', 'right', { previewScrollTop: 840 })

    expect(session.seedPaneFromSharedPosition('tab-1', 'left')).toEqual({ topLine: 80 })
    expect(session.seedPaneFromSharedPosition('tab-1', 'right')).toEqual({ topLine: 80 })
    expect(session.getForPane('tab-1', 'left')).toEqual({ topLine: 80 })
    expect(session.getForPane('tab-1', 'right')).toEqual({ topLine: 80 })
  })

  it('共享位置缺少行号时回退旧版预览像素位置', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', { previewScrollTop: 480 })

    expect(session.seedPaneFromSharedPosition('tab-1', 'left')).toEqual({ previewScrollTop: 480 })
    expect(session.getForPane('tab-1', 'left')).toEqual({ previewScrollTop: 480 })
  })

  it('没有共享位置时从文档顶部开始', () => {
    const session = new ReadingPositionSession()

    session.saveForPane('tab-1', 'right', { previewScrollTop: 840 })

    expect(session.seedPaneFromSharedPosition('tab-1', 'left')).toEqual({ topLine: 1 })
    expect(session.getForPane('tab-1', 'left')).toEqual({ topLine: 1 })
  })

  it('重复进入对照阅读时采用最新共享位置', () => {
    const session = new ReadingPositionSession()

    session.save('tab-1', { topLine: 40 })
    session.seedPaneFromSharedPosition('tab-1', 'left')
    session.save('tab-1', { topLine: 90 })

    expect(session.seedPaneFromSharedPosition('tab-1', 'left')).toEqual({ topLine: 90 })
    expect(session.getForPane('tab-1', 'left')).toEqual({ topLine: 90 })
  })
})
