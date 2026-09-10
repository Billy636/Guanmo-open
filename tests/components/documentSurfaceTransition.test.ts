import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDocumentSurfaceTransition } from '@/components/common/documentSurfaceTransition'
import { useSettingsStore } from '@/stores/settingsStore'

describe('文档正文过渡协调', () => {
  beforeEach(() => {
    useSettingsStore.getState().updateAppearanceSettings({ documentTransitionEnabled: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia
    delete (document as Document & { startViewTransition?: unknown }).startViewTransition
  })

  it('开关关闭时直接更新且不调用 View Transition', () => {
    const startViewTransition = vi.fn()
    Object.assign(document, { startViewTransition })
    useSettingsStore.getState().updateAppearanceSettings({ documentTransitionEnabled: false })
    const update = vi.fn()

    runDocumentSurfaceTransition(update, { animate: true })

    expect(update).toHaveBeenCalledOnce()
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('系统减少动态效果时直接更新', () => {
    const startViewTransition = vi.fn()
    Object.assign(document, { startViewTransition })
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia
    const update = vi.fn()

    runDocumentSurfaceTransition(update, { animate: true })

    expect(update).toHaveBeenCalledOnce()
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('指针切换使用 View Transition，更新回调完成后可继续下一次切换', async () => {
    const skipTransition = vi.fn()
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition,
      }
    })
    Object.assign(document, { startViewTransition })
    const first = vi.fn()
    const second = vi.fn()

    runDocumentSurfaceTransition(first, { animate: true })
    runDocumentSurfaceTransition(second, { animate: true })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(startViewTransition).toHaveBeenCalledTimes(2)
  })
})
