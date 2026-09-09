export const THEME_IDS = ['warm', 'light', 'dark', 'paper', 'github-light'] as const
export type BuiltInThemeId = typeof THEME_IDS[number]
export type ThemeId = string
export type NonDarkThemeId = string

export const APPEARANCE_CONFIG_VERSION = 2 as const
export type MotionPreference = 'system' | 'reduced' | 'full'
export const ASSISTANT_VISUAL_IDS = ['sprite'] as const
export type AssistantVisualId = typeof ASSISTANT_VISUAL_IDS[number]

export const EDITABLE_THEME_SLOT_COUNT = 2 as const
export const EDITABLE_THEME_IDS = ['paper', 'github-light'] as const
export type EditableBuiltInThemeId = typeof EDITABLE_THEME_IDS[number]

export interface CustomThemePalette {
  canvas: string
  surface: string
  elevated: string
  text: string
  mutedText: string
  border: string
  primary: string
  onPrimary: string
  accent: string
  editorBackground: string
  heading: string
  link: string
  codeBackground: string
  codeText: string
  selection: string
  success: string
  warning: string
  error: string
}

export interface CustomThemeDefinition {
  id: string
  label: string
  description: string
  colorScheme: 'light' | 'dark'
  palette: CustomThemePalette
  startupCanvas: string
}

export type ThemeSlot =
  | { kind: 'builtin'; themeId: EditableBuiltInThemeId }
  | { kind: 'custom'; theme: CustomThemeDefinition }
  | null

export interface AppearanceConfigV1 {
  version: typeof APPEARANCE_CONFIG_VERSION
  themeId: ThemeId
  assistantVisualId: AssistantVisualId
  motionPreference: MotionPreference
  themeSlots: readonly [ThemeSlot, ThemeSlot]
}

export const DEFAULT_APPEARANCE_CONFIG_V1: AppearanceConfigV1 = {
  version: APPEARANCE_CONFIG_VERSION,
  themeId: 'warm',
  assistantVisualId: 'sprite',
  motionPreference: 'system',
  themeSlots: [
    { kind: 'builtin', themeId: 'paper' },
    { kind: 'builtin', themeId: 'github-light' },
  ],
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS.includes(value as BuiltInThemeId) || /^custom-[a-z0-9-]+$/.test(value))
}

export function resolveThemeId(appearance: unknown): ThemeId {
  const saved = asRecord(appearance)
  if (saved && isThemeId(saved.themeId)) return saved.themeId
  if (saved?.theme === 'dark') return 'dark'
  if (saved?.theme === 'light' && saved.lightPalette === 'plain') return 'light'
  return DEFAULT_APPEARANCE_CONFIG_V1.themeId
}

export function resolveLastLightThemeId(appearance: unknown): NonDarkThemeId {
  const saved = asRecord(appearance)
  if (
    saved
    && isThemeId(saved.lastLightThemeId)
    && saved.lastLightThemeId !== 'dark'
  ) {
    return saved.lastLightThemeId
  }
  const themeId = resolveThemeId(saved)
  if (themeId !== 'dark') return themeId
  return saved?.lightPalette === 'plain' ? 'light' : 'warm'
}

export function resolveMotionPreference(value: unknown): MotionPreference {
  return value === 'reduced' || value === 'full' || value === 'system'
    ? value
    : DEFAULT_APPEARANCE_CONFIG_V1.motionPreference
}

export function isAssistantVisualId(value: unknown): value is AssistantVisualId {
  return typeof value === 'string' && ASSISTANT_VISUAL_IDS.includes(value as AssistantVisualId)
}

export function resolveAssistantVisualId(value: unknown): AssistantVisualId {
  return isAssistantVisualId(value)
    ? value
    : DEFAULT_APPEARANCE_CONFIG_V1.assistantVisualId
}

export function resolveAppearanceConfig(appearance: unknown): AppearanceConfigV1 {
  const saved = asRecord(appearance)
  const rawSlots = Array.isArray(saved?.themeSlots) ? saved.themeSlots : null
  const themeSlots: readonly [ThemeSlot, ThemeSlot] = [
    normalizeThemeSlot(rawSlots?.[0], DEFAULT_APPEARANCE_CONFIG_V1.themeSlots[0]),
    normalizeThemeSlot(rawSlots?.[1], DEFAULT_APPEARANCE_CONFIG_V1.themeSlots[1]),
  ]
  return {
    ...DEFAULT_APPEARANCE_CONFIG_V1,
    themeId: resolveThemeId(saved),
    assistantVisualId: resolveAssistantVisualId(saved?.assistantVisualId),
    motionPreference: resolveMotionPreference(saved?.motionPreference),
    themeSlots,
  }
}

function normalizeThemeSlot(value: unknown, fallback: ThemeSlot): ThemeSlot {
  if (value === null) return null
  const slot = asRecord(value)
  if (!slot || (slot.kind !== 'builtin' && slot.kind !== 'custom')) return fallback
  if (slot.kind === 'builtin') {
    return EDITABLE_THEME_IDS.includes(slot.themeId as EditableBuiltInThemeId)
      ? { kind: 'builtin', themeId: slot.themeId as EditableBuiltInThemeId }
      : fallback
  }
  const theme = asRecord(slot.theme)
  if (!theme || typeof theme.id !== 'string' || !/^custom-[a-z0-9-]+$/.test(theme.id)) return fallback
  if (typeof theme.label !== 'string' || theme.label.trim().length < 1 || theme.label.trim().length > 24) return fallback
  if (typeof theme.description !== 'string' || theme.description.trim().length < 1 || theme.description.trim().length > 60) return fallback
  if (theme.colorScheme !== 'light' && theme.colorScheme !== 'dark') return fallback
  if (typeof theme.startupCanvas !== 'string' || !/^#[0-9a-f]{6}$/i.test(theme.startupCanvas)) return fallback
  const palette = asRecord(theme.palette)
  const paletteKeys = ['canvas', 'surface', 'elevated', 'text', 'mutedText', 'border', 'primary', 'onPrimary', 'accent', 'editorBackground', 'heading', 'link', 'codeBackground', 'codeText', 'selection', 'success', 'warning', 'error']
  if (!palette || !Object.keys(palette).every((key) => paletteKeys.includes(key)) || !paletteKeys.every((key) => typeof palette[key] === 'string' && /^#[0-9a-f]{6}$/i.test(palette[key] as string))) return fallback
  return slot as unknown as ThemeSlot
}
