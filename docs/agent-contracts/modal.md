# 软件弹窗模板契约

本契约以 `src/features/settings/AiShortcutSettings.tsx` 中“设置 → 快捷操作 → 新增操作”弹窗为唯一模板。新增或调整软件自有弹窗时，必须优先复用这套结构和令牌，不得另起一套视觉方案。

## 结构

```tsx
<div className="gm-settings-mask gm-ai-shortcut-dialog-mask fixed inset-0 z-[1100] flex items-center justify-center p-4">
  <div className="gm-settings-modal gm-ai-shortcut-dialog-panel w-full max-w-[560px]">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="<unique-title-id>"
      className="max-h-[calc(100vh-32px)] overflow-y-auto"
    >
      <div className="flex items-center justify-between border-b border-gm-border-subtle pb-3">
        {/* 标题 + 关闭按钮 */}
      </div>
      <div className="space-y-4 py-4">
        {/* 表单或说明内容 */}
      </div>
      <div className="flex justify-end gap-2 border-t border-gm-border-subtle pt-3">
        {/* 操作按钮 */}
      </div>
    </div>
  </div>
</div>
```

## 视觉规则

- 遮罩必须使用 `gm-settings-mask`，保留主题遮罩色和背景模糊；入场使用 `gm-ai-shortcut-dialog-mask`。
- 面板必须使用 `gm-settings-modal gm-ai-shortcut-dialog-panel`。面板的圆角、边框、背景、文字色和阴影由 `global.css` 的主题令牌统一提供，不在弹窗组件中重复定义。
- 面板宽度默认 `max-w-[560px]`；内容较长时保留 `max-h-[calc(100vh-32px)] overflow-y-auto`，不得让弹窗超出视口。
- 标题栏使用 `border-b border-gm-border-subtle pb-3`；内容区使用 `space-y-4 py-4`；操作栏使用 `border-t border-gm-border-subtle pt-3` 和 `justify-end gap-2`。
- 关闭按钮使用文本按钮样式，必须有唯一的 `aria-label`；标题必须通过 `aria-labelledby` 与弹窗关联。
- 不得使用 `animal-island-ui` 的 `Modal`，不得在面板上硬编码白色、米色、黑色背景或独立阴影。

## 操作规则

- 普通取消、关闭使用 `type="default"` 或文字按钮；提交、保存、导入等主要操作使用 `type="primary"`。
- 删除、覆盖等危险操作使用组件支持的危险样式（优先 `danger`，否则使用主题错误色文字按钮）。
- 保留遮罩点击关闭和显式关闭按钮；关闭动画沿用 `gm-ai-shortcut-dialog-mask/panel` 及其 `is-closing` 状态，不新增局部动画实现。
- 弹窗只能承载当前功能所需内容，不得改变全局主题、设置存储或其他弹窗行为。
