import { describe, expect, it } from 'vitest'
import {
  appearanceRegistry,
  createAppearanceRegistry,
  createCustomThemeDefinition,
  isCustomThemeImport,
  isThemeDefinition,
} from '@/services/appearance/appearanceRegistry'
import {
  DEFAULT_APPEARANCE_CONFIG_V1,
  resolveAppearanceConfig,
} from '@/services/appearance/appearanceSchema'
import { syncDocumentTheme } from '@/services/appearance/appearanceDom'

describe('Appearance Schema 与 Registry', () => {
  it('提供五个内置主题 descriptor 和版本化默认配置', () => {
    expect(appearanceRegistry.builtInThemes.map((theme) => theme.id)).toEqual([
      'warm',
      'light',
      'dark',
      'paper',
      'github-light',
    ])
    expect(DEFAULT_APPEARANCE_CONFIG_V1).toMatchObject({
      version: 2,
      themeId: 'warm',
      assistantVisualId: 'sprite',
      motionPreference: 'system',
    })
  })

  it('迁移旧主题字段并回退未知的新外观字段', () => {
    expect(resolveAppearanceConfig({ theme: 'dark' })).toMatchObject({ version: 2, themeId: 'dark' })
    expect(resolveAppearanceConfig({
      version: 99,
      themeId: 'removed-theme',
      assistantVisualId: 'user-code',
      motionPreference: 'invalid',
    })).toEqual(DEFAULT_APPEARANCE_CONFIG_V1)
  })

  it('只接受结构完整的 descriptor，并对未知 ID 安全回退', () => {
    const custom = {
      id: 'custom-theme',
      label: '自定义',
      description: '测试主题',
      colorScheme: 'light',
      tokens: {
        canvas: '#fff',
        surface: '#fff',
        border: '#eee',
        text: '#111',
        placeholder: 'rgba(0, 0, 0, .1)',
        placeholderStrong: 'rgba(0, 0, 0, .2)',
      },
      startupCanvas: '#fff',
    }
    expect(isThemeDefinition(custom)).toBe(true)
    const registry = createAppearanceRegistry([custom, { id: 'broken' }])
    expect(registry.getTheme('custom-theme').label).toBe('自定义')
    expect(registry.getTheme('removed-theme').id).toBe('warm')
  })

  it('DOM applicator 使用 descriptor 的启动颜色并同步主题属性', () => {
    syncDocumentTheme('dark')
    expect(document.documentElement.dataset.themeId).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--gmss-canvas')).toBe('#15130f')
  })

  it('校验 AI 主题 JSON 并生成内部主题 ID', () => {
    const input = {
      version: 1,
      name: '海盐蓝',
      description: '清爽的蓝色阅读主题',
      colorScheme: 'light',
      colors: {
        canvas: '#F5F8FC', surface: '#FFFFFF', elevated: '#EEF4FA', text: '#1F2937', mutedText: '#64748B',
        border: '#CBD5E1', primary: '#2563EB', onPrimary: '#FFFFFF', accent: '#0F766E', editorBackground: '#FFFFFF',
        heading: '#172554', link: '#1D4ED8', codeBackground: '#EFF6FF', codeText: '#1E3A8A', selection: '#93C5FD',
        success: '#16A34A', warning: '#D97706', error: '#DC2626',
      },
    } as const
    expect(isCustomThemeImport(input)).toBe(true)
    expect(createCustomThemeDefinition(input, 'custom-salt-blue')).toMatchObject({
      id: 'custom-salt-blue',
      label: '海盐蓝',
      startupCanvas: '#F5F8FC',
    })
    expect(isCustomThemeImport({ ...input, colors: { ...input.colors, primary: 'url(x)' } })).toBe(false)
  })
})
