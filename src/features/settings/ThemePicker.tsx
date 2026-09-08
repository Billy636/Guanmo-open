import type { CSSProperties } from 'react'
import { appearanceRegistry } from '@/services/appearance/appearanceRegistry'
import type { ThemeDefinition } from '@/services/appearance/appearanceRegistry'
import type { ThemeId, ThemeSlot } from '@/services/appearance/appearanceSchema'
import './theme-picker.css'

const PROTECTED_THEME_IDS = new Set(['warm', 'light', 'dark'])

export function ThemePicker({
  value,
  onChange,
  themes = appearanceRegistry.builtInThemes,
  slots,
  onAddSlot,
  onRemove,
}: {
  value: ThemeId
  onChange: (value: ThemeId) => void
  themes?: readonly ThemeDefinition[]
  slots?: readonly [ThemeSlot, ThemeSlot]
  onAddSlot?: (index: number) => void
  onRemove?: (theme: ThemeDefinition) => void
}) {
  const themesById = new Map(themes.map((theme) => [theme.id, theme]))
  const options = slots
    ? [
        ...['warm', 'light', 'dark'].map((id) => themesById.get(id)).filter(Boolean) as ThemeDefinition[],
        ...slots.map((slot, index) => ({ slot, index })),
      ]
    : themes

  return (
    <div className="gm-theme-picker" role="radiogroup" aria-label="主题">
      {options.map((entry) => {
        if ('slot' in entry) {
          if (!entry.slot) {
            return (
              <button key={`empty-${entry.index}`} type="button" className="gm-theme-card gm-theme-card--empty" onClick={() => onAddSlot?.(entry.index)}>
                <span className="gm-theme-card__empty-icon" aria-hidden="true">+</span>
                <span className="gm-theme-card__label">添加主题</span>
                <span className="gm-theme-card__description">空闲槽位</span>
              </button>
            )
          }
          const themeId = entry.slot.kind === 'builtin' ? entry.slot.themeId : entry.slot.theme.id
          const theme = themesById.get(themeId)
          if (!theme) return null
          return <ThemeCard key={theme.id} theme={theme} value={value} onChange={onChange} onRemove={onRemove} />
        }
        return <ThemeCard key={entry.id} theme={entry} value={value} onChange={onChange} onRemove={onRemove} />
      })}
    </div>
  )
}

function ThemeCard({
  theme,
  value,
  onChange,
  onRemove,
}: {
  theme: ThemeDefinition
  value: ThemeId
  onChange: (value: ThemeId) => void
  onRemove?: (theme: ThemeDefinition) => void
}) {
  const active = value === theme.id
  const locked = PROTECTED_THEME_IDS.has(theme.id)
  const previewStyle = theme.palette
    ? {
        '--gm-preview-canvas': theme.palette.canvas,
        '--gm-preview-surface': theme.palette.surface,
        '--gm-preview-text': theme.palette.text,
        '--gm-preview-primary': theme.palette.primary,
        '--gm-preview-border': theme.palette.border,
      } as CSSProperties
    : undefined
  return (
    <div
      className="gm-theme-card"
      data-preview-theme={theme.id}
      data-active={active}
      role="radio"
      aria-checked={active}
      tabIndex={0}
      onClick={() => onChange(theme.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onChange(theme.id)
        }
      }}
    >
      <span className="gm-theme-card__preview" style={previewStyle} aria-hidden="true">
        <span className="gm-theme-card__surface">
          <span className="gm-theme-card__heading" />
          <span className="gm-theme-card__line" />
          <span className="gm-theme-card__line gm-theme-card__line--short" />
          <span className="gm-theme-card__accent" />
        </span>
      </span>
      <span className="gm-theme-card__meta">
        <span className="gm-theme-card__label">{theme.label}</span>
        {locked && <span className="gm-theme-card__lock" title="系统主题不可删除" aria-label="系统主题">锁定</span>}
      </span>
      <span className="gm-theme-card__description">{theme.description}</span>
      {!locked && onRemove && (
        <button
          type="button"
          className="gm-theme-card__remove"
          aria-label={`删除主题 ${theme.label}`}
          onClick={(event) => { event.stopPropagation(); onRemove(theme) }}
        >
          删除
        </button>
      )}
    </div>
  )
}
