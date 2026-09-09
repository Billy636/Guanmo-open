import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeManager } from '@/features/settings/ThemeManager'
import { useSettingsStore } from '@/stores/settingsStore'

const customThemeJson = JSON.stringify({
  version: 1,
  name: '海盐蓝',
  description: '清爽蓝色',
  colorScheme: 'light',
  colors: {
    canvas: '#F5F8FC', surface: '#FFFFFF', elevated: '#EEF4FA', text: '#1F2937', mutedText: '#64748B',
    border: '#CBD5E1', primary: '#2563EB', onPrimary: '#FFFFFF', accent: '#0F766E', editorBackground: '#FFFFFF',
    heading: '#172554', link: '#1D4ED8', codeBackground: '#EFF6FF', codeText: '#1E3A8A', selection: '#93C5FD',
    success: '#16A34A', warning: '#D97706', error: '#DC2626',
  },
})

describe('ThemeManager', () => {
  beforeEach(() => {
    useSettingsStore.getState().restoreDefaultThemes()
    useSettingsStore.getState().removeTheme('paper')
    useSettingsStore.getState().updateAppearanceSettings({ themeId: 'warm' })
  })

  it('不再渲染已移除的本机说明和顶部复制提示词按钮', () => {
    render(<ThemeManager />)

    expect(screen.queryByText('自定义主题只保存在本机设置中，不会上传到观墨。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制 AI 提示词' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加主题' })).toBeInTheDocument()
  })

  it('通过主题管理弹窗导入合法 JSON 并更新主题槽位', () => {
    render(<ThemeManager />)

    fireEvent.click(screen.getByRole('button', { name: '添加主题' }))
    fireEvent.change(screen.getByLabelText('粘贴主题 JSON'), { target: { value: customThemeJson } })
    fireEvent.click(screen.getByRole('button', { name: '校验并导入' }))

    expect(useSettingsStore.getState().appearance.themeSlots.some((slot) => slot?.kind === 'custom')).toBe(true)
    expect(useSettingsStore.getState().appearance.themeId).toMatch(/^custom-/)
  })
})
