import { appearanceRegistry, type AppearanceRegistry, type ThemeDefinition } from './appearanceRegistry'
import type { AppearanceConfigV1, ThemeId } from './appearanceSchema'

let activeAppearanceRegistry: AppearanceRegistry = appearanceRegistry

export function setAppearanceRegistry(registry: AppearanceRegistry) {
  activeAppearanceRegistry = registry
}

export function resolveThemeDefinition(themeId: unknown): ThemeDefinition {
  return activeAppearanceRegistry.getTheme(themeId)
}

export function applyAppearanceToDocument(
  config: Pick<AppearanceConfigV1, 'themeId'>,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): ThemeDefinition | null {
  if (!root) return null
  const theme = resolveThemeDefinition(config.themeId)
  root.dataset.themeId = theme.id
  root.dataset.theme = theme.colorScheme
  root.dataset.themeKind = theme.palette ? 'custom' : 'builtin'
  root.style.colorScheme = theme.colorScheme
  clearCustomThemeVariables(root)
  root.style.setProperty('--gmss-canvas', theme.tokens.canvas)
  root.style.setProperty('--gmss-surface', theme.tokens.surface)
  root.style.setProperty('--gmss-border', theme.tokens.border)
  root.style.setProperty('--gmss-text', theme.tokens.text)
  root.style.setProperty('--gmss-placeholder', theme.tokens.placeholder)
  root.style.setProperty('--gmss-placeholder-strong', theme.tokens.placeholderStrong)
  if (theme.palette) applyCustomPalette(root, theme)
  delete root.dataset.lightPalette
  return theme
}

export function syncDocumentTheme(themeId: ThemeId): ThemeDefinition | null {
  return applyAppearanceToDocument({ themeId })
}

const CUSTOM_THEME_VARIABLES = [
  '--gm-canvas', '--gm-surface', '--gm-surface-elevated', '--gm-surface-overlay', '--gm-surface-hover',
  '--gm-primary', '--gm-primary-hover', '--gm-primary-active', '--gm-primary-subtle', '--gm-accent',
  '--gm-accent-subtle', '--gm-text', '--gm-text-secondary', '--gm-text-tertiary', '--gm-text-disabled',
  '--gm-text-on-primary', '--gm-user-bubble-bg', '--gm-user-bubble-text', '--gm-active-indicator',
  '--gm-border', '--gm-border-subtle', '--gm-border-strong', '--gm-border-focus', '--gm-border-hover',
  '--gm-success', '--gm-warning', '--gm-error', '--gm-info', '--gm-editor-bg', '--gm-editor-selection',
  '--gm-editor-line-highlight', '--gm-editor-gutter', '--gm-editor-heading', '--gm-editor-quote',
  '--gm-editor-code', '--gm-editor-link', '--gm-editor-list', '--gm-markdown-heading', '--gm-markdown-quote-bg',
  '--gm-code-bg', '--gm-code-text', '--gm-code-muted', '--gm-code-command', '--gm-code-path',
  '--gm-code-error', '--gm-code-info', '--gm-tooltip-bg', '--gm-tooltip-border', '--gm-settings-mask-bg',
  '--gm-settings-modal-bg', '--gm-settings-modal-border', '--gm-fullscreen-control-bg',
  '--gm-fullscreen-control-border', '--gm-fullscreen-control-hover', '--gm-fullscreen-control-text',
  '--gm-fullscreen-control-muted', '--gm-scrollbar-track', '--gm-scrollbar-thumb', '--gm-scrollbar-thumb-hover',
] as const

function clearCustomThemeVariables(root: HTMLElement) {
  for (const variable of CUSTOM_THEME_VARIABLES) root.style.removeProperty(variable)
}

function mix(color: string, percentage: number, base = 'transparent') {
  return `color-mix(in srgb, ${color} ${percentage}%, ${base})`
}

function applyCustomPalette(root: HTMLElement, theme: ThemeDefinition) {
  const palette = theme.palette!
  const set = (name: string, value: string) => root.style.setProperty(name, value)
  const textSecondary = palette.mutedText
  set('--gm-canvas', palette.canvas)
  set('--gm-surface', palette.surface)
  set('--gm-surface-elevated', palette.elevated)
  set('--gm-surface-overlay', palette.elevated)
  set('--gm-surface-hover', mix(palette.primary, 8, palette.surface))
  set('--gm-primary', palette.primary)
  set('--gm-primary-hover', mix(palette.primary, 82, palette.onPrimary))
  set('--gm-primary-active', mix(palette.primary, 72, palette.text))
  set('--gm-primary-subtle', mix(palette.primary, 12, palette.canvas))
  set('--gm-accent', palette.accent)
  set('--gm-accent-subtle', mix(palette.accent, 10))
  set('--gm-text', palette.text)
  set('--gm-text-secondary', textSecondary)
  set('--gm-text-tertiary', mix(textSecondary, 70, palette.canvas))
  set('--gm-text-disabled', mix(textSecondary, 45, palette.canvas))
  set('--gm-text-on-primary', palette.onPrimary)
  set('--gm-user-bubble-bg', mix(palette.primary, 18, palette.surface))
  set('--gm-user-bubble-text', palette.text)
  set('--gm-active-indicator', palette.primary)
  set('--gm-border', palette.border)
  set('--gm-border-subtle', mix(palette.border, 60, palette.surface))
  set('--gm-border-strong', mix(palette.border, 72, palette.text))
  set('--gm-border-focus', palette.primary)
  set('--gm-border-hover', mix(palette.border, 70, palette.text))
  set('--gm-success', palette.success)
  set('--gm-warning', palette.warning)
  set('--gm-error', palette.error)
  set('--gm-info', palette.link)
  set('--gm-editor-bg', palette.editorBackground)
  set('--gm-editor-selection', mix(palette.selection, 28))
  set('--gm-editor-line-highlight', mix(palette.primary, 8))
  set('--gm-editor-gutter', palette.surface)
  set('--gm-editor-heading', palette.heading)
  set('--gm-editor-quote', palette.accent)
  set('--gm-editor-code', palette.accent)
  set('--gm-editor-link', palette.link)
  set('--gm-editor-list', palette.primary)
  set('--gm-markdown-heading', palette.heading)
  set('--gm-markdown-quote-bg', mix(palette.accent, 10))
  set('--gm-code-bg', palette.codeBackground)
  set('--gm-code-text', palette.codeText)
  set('--gm-code-muted', textSecondary)
  set('--gm-code-command', palette.link)
  set('--gm-code-path', palette.accent)
  set('--gm-code-error', palette.error)
  set('--gm-code-info', palette.link)
  set('--gm-tooltip-bg', palette.elevated)
  set('--gm-tooltip-border', mix(palette.border, 50))
  set('--gm-settings-mask-bg', mix(palette.text, 38))
  set('--gm-settings-modal-bg', palette.elevated)
  set('--gm-settings-modal-border', mix(palette.border, 60))
  set('--gm-fullscreen-control-bg', mix(palette.elevated, 92, palette.canvas))
  set('--gm-fullscreen-control-border', mix(palette.border, 55))
  set('--gm-fullscreen-control-hover', mix(palette.primary, 12, palette.elevated))
  set('--gm-fullscreen-control-text', palette.text)
  set('--gm-fullscreen-control-muted', textSecondary)
  set('--gm-scrollbar-track', 'transparent')
  set('--gm-scrollbar-thumb', palette.border)
  set('--gm-scrollbar-thumb-hover', mix(palette.border, 72, palette.text))
}
