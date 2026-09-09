import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'animal-island-ui'
import { ThemePicker } from './ThemePicker'
import {
  createAppearanceRegistry,
  createCustomThemeDefinition,
  isCustomThemeImport,
} from '@/services/appearance/appearanceRegistry'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ThemeDefinition } from '@/services/appearance/appearanceRegistry'
import { toast } from '@/services/toast'

const THEME_GENERATION_PROMPT = `你是Markdown软件的主题设计助手。请根据我的描述或者逐项询问我：
1. 主题名称、简介和整体氛围；
2. 明亮或深色模式，以及应用背景、面板、浮层、正文、次要文字和边框颜色；
3. 主色、主色上的文字、强调色；
4. 编辑器背景、标题、链接、代码块背景和代码文字；
5. 选区颜色，以及成功、警告、错误颜色。

来确定主题风格。在我确认全部细节后，只输出一个 JSON 对象，不要 Markdown 代码围栏，不要额外解释。所有颜色必须是 6 位十六进制格式 #RRGGBB，字段必须完整：
{ "version": 1, "name": "主题名称", "description": "一句话简介", "colorScheme": "light", "colors": { "canvas": "#RRGGBB", "surface": "#RRGGBB", "elevated": "#RRGGBB", "text": "#RRGGBB", "mutedText": "#RRGGBB", "border": "#RRGGBB", "primary": "#RRGGBB", "onPrimary": "#RRGGBB", "accent": "#RRGGBB", "editorBackground": "#RRGGBB", "heading": "#RRGGBB", "link": "#RRGGBB", "codeBackground": "#RRGGBB", "codeText": "#RRGGBB", "selection": "#RRGGBB", "success": "#RRGGBB", "warning": "#RRGGBB", "error": "#RRGGBB" } }`

function createThemeId() {
  try {
    return `custom-${crypto.randomUUID()}`
  } catch {
    return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

export function ThemeManager() {
  const appearance = useSettingsStore((state) => state.appearance)
  const addCustomTheme = useSettingsStore((state) => state.addCustomTheme)
  const removeTheme = useSettingsStore((state) => state.removeTheme)
  const restoreDefaultThemes = useSettingsStore((state) => state.restoreDefaultThemes)
  const registry = useMemo(() => createAppearanceRegistry(appearance.themeSlots), [appearance.themeSlots])
  const [dialog, setDialog] = useState<'add' | 'delete' | null>(null)
  const [closing, setClosing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ThemeDefinition | null>(null)
  const closeTimerRef = useRef<number>()
  const hasEmptySlot = appearance.themeSlots.some((slot) => slot === null)

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
  }, [])

  const finishClose = () => {
    setDialog(null)
    setPendingDelete(null)
    setClosing(false)
  }

  const closeDialog = () => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose()
      return
    }
    setClosing(true)
    closeTimerRef.current = window.setTimeout(finishClose, 160)
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(THEME_GENERATION_PROMPT)
      toast.success('主题提示词已复制')
    } catch {
      toast.error('复制失败，请手动选择提示词')
    }
  }

  const openAdd = () => {
    setDraft('')
    setError('')
    setClosing(false)
    setDialog('add')
  }

  const importTheme = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch {
      setError('JSON 格式不正确，请粘贴 AI 输出的完整 JSON。')
      return
    }
    if (!isCustomThemeImport(parsed)) {
      setError('主题字段不完整或颜色不是 #RRGGBB 格式，请按提示词重新生成。')
      return
    }
    const theme = createCustomThemeDefinition(parsed, createThemeId())
    if (!addCustomTheme(theme)) {
      setError(hasEmptySlot ? '已有同名主题，请修改名称后再导入。' : '主题槽位已满，请先删除后两个槽位中的主题。')
      return
    }
    closeDialog()
    setDraft('')
    toast.success(`主题“${theme.label}”已导入`)
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const label = pendingDelete.label
    removeTheme(pendingDelete.id)
    closeDialog()
    toast.success(`主题“${label}”已删除`)
  }

  return (
    <div className="gm-theme-manager">
      <div className="gm-theme-manager__toolbar">
        <div>
          <span className="text-body text-gm-text">主题管理</span>
          <p className="mt-0.5 text-caption text-gm-text-tertiary">前三个系统主题不可删除，后两个槽位可由你自由替换。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="default" size="small" disabled={!hasEmptySlot} onClick={openAdd}>添加主题</Button>
          <Button type="text" size="small" onClick={() => { restoreDefaultThemes(); toast.success('已恢复默认主题列表') }}>恢复默认主题</Button>
        </div>
      </div>
      <ThemePicker
        value={appearance.themeId}
        onChange={(themeId) => useSettingsStore.getState().updateAppearanceSettings({ themeId })}
        themes={registry.themes}
        slots={appearance.themeSlots}
        onAddSlot={openAdd}
        onRemove={(theme) => { setPendingDelete(theme); setDialog('delete') }}
      />
      {dialog === 'add' && (
        <div className={`gm-settings-mask gm-ai-shortcut-dialog-mask fixed inset-0 z-[1100] flex items-center justify-center p-4 ${closing ? 'is-closing pointer-events-none' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
          <div className={`gm-settings-modal gm-ai-shortcut-dialog-panel w-full max-w-[560px] ${closing ? 'is-closing' : ''}`}>
            <div role="dialog" aria-modal="true" aria-labelledby="theme-import-title" className="max-h-[calc(100vh-32px)] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-gm-border-subtle pb-3">
                <div>
                  <h2 id="theme-import-title" className="text-heading font-bold text-gm-text">导入主题</h2>
                  <p className="mt-1 text-caption text-gm-text-tertiary">复制提示词到任意 AI，让它完成追问后生成 JSON，再粘贴到这里。</p>
                </div>
                <button
                  type="button"
                  onClick={closeDialog}
                  aria-label="关闭主题导入弹窗"
                  className="rounded-lg px-2 py-1 text-body text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4 py-4">
                <div className="rounded-xl border border-gm-border-subtle bg-gm-surface-elevated p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-caption font-semibold text-gm-text">主题生成提示词</span>
                    <Button type="default" size="small" onClick={() => void copyPrompt()}>复制</Button>
                  </div>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-micro leading-relaxed text-gm-text-secondary">{THEME_GENERATION_PROMPT}</pre>
                </div>
                <label className="block" htmlFor="theme-import-json">
                  <span className="block text-caption font-semibold text-gm-text">粘贴主题 JSON</span>
                  <textarea id="theme-import-json" value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} rows={10} spellCheck={false} className="mt-2 min-h-40 w-full resize-y rounded-xl border border-gm-border bg-gm-surface-elevated px-3 py-2 font-mono text-micro leading-relaxed text-gm-text outline-none transition-colors focus:border-gm-primary" placeholder={'{\n  "version": 1,\n  ...\n}'} />
                  {error && <span className="mt-2 block text-caption text-gm-error" role="alert">{error}</span>}
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-gm-border-subtle pt-3">
                <Button type="default" size="small" onClick={closeDialog}>取消</Button>
                <Button type="primary" size="small" disabled={!draft.trim()} onClick={importTheme}>校验并导入</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialog === 'delete' && pendingDelete && (
        <div className={`gm-settings-mask gm-ai-shortcut-dialog-mask fixed inset-0 z-[1100] flex items-center justify-center p-4 ${closing ? 'is-closing pointer-events-none' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
          <div className={`gm-settings-modal gm-ai-shortcut-dialog-panel w-full max-w-[560px] ${closing ? 'is-closing' : ''}`}>
            <div role="dialog" aria-modal="true" aria-labelledby="theme-delete-title" className="max-h-[calc(100vh-32px)] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-gm-border-subtle pb-3">
                <h2 id="theme-delete-title" className="text-heading font-bold text-gm-text">删除主题</h2>
                <button
                  type="button"
                  onClick={closeDialog}
                  aria-label="关闭删除主题弹窗"
                  className="rounded-lg px-2 py-1 text-body text-gm-text-secondary hover:bg-gm-surface-hover hover:text-gm-text"
                >
                  ×
                </button>
              </div>
              <div className="space-y-4 py-4">
                <p className="text-body font-semibold text-gm-text">确定删除“{pendingDelete.label}”？</p>
                <p className="mt-2 text-caption leading-relaxed text-gm-text-secondary">自定义主题删除后无法找回；系统主题可以通过“恢复默认主题”重新加入。</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-gm-border-subtle pt-3">
                <Button type="default" size="small" onClick={closeDialog}>取消</Button>
                <Button type="default" size="small" danger onClick={confirmDelete}>删除主题</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
