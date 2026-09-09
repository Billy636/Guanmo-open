# 发布新版本前置检查流程

本文档用于 GuanMo 发布新版本前的统一检查，目标是尽量提前发现功能回归、格式/编译问题、发布产物问题和 GitHub Actions 阻断项。

## 1. 确认发布范围

1. 确认当前版本基线和新版本号，检查以下文件版本一致：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `CHANGELOG.md`
   - `README.md` 中存在的版本引用
2. 审计最近一个 tag 之后的全部提交，并按新功能、修复、优化、重构和构建分类整理 Release Notes：

   ```powershell
   git describe --tags --abbrev=0
   git log <最近一个tag>..HEAD --oneline
   ```

3. 检查工作区状态。已有用户修改不得混入版本提交；发布前应只保留本次版本明确需要的文件。

## 2. 执行本地完整质量门禁

在版本提交和打 tag 前执行：

```powershell
npm run check:release
```

该命令覆盖：

- Store 边界检查
- ESLint
- TypeScript 类型检查
- 全部 Vitest 测试：`npm test`
- Web 构建和体积检查
- Rust `fmt`、Clippy、测试和编译检查

命令失败即停止发布，必须修复后从失败项重新执行。

## 3. 执行变更相关专项检查

根据最近 tag 之后实际变更的模块补跑专项检查。以下项目已分别被 `npm run check:release`、`npm test` 或 `npm run tauri build` 覆盖，不要重复执行：

- 全部 Vitest 测试：`npm test`
- Web 构建和 Web 体积检查：`npm run build`
- 桌面前端构建和桌面体积检查：`npm run tauri build` 内部的 `npm run build:desktop`

涉及跨模块功能、核心阅读链路或 AI 功能时，补跑以下未被基础门禁覆盖的专项检查：

```powershell
npm run test:ai-http
npm run test:selection-context
npm run test:session-restore
npm run test:markdown-math
```

涉及文件访问、RAG、更新检查、提醒、冷启动、编辑器性能或 Agent 评测时，还必须执行对应的 `npm run test:*` 检查。专项检查不能用代码阅读代替，未执行的项目必须标记为 `NOT TESTED`。

本次 v1.7.2 候选提交已有以下自动化覆盖，可直接复用，不要为同一行为重复新增测试：

| 行为 | 现有测试覆盖 |
|---|---|
| AI 助手字号、设置持久化和主题配置兼容 | `tests/settings/settingsCompatibility.test.ts`、`tests/agent/aiPanelInteractions.test.tsx` |
| 自定义主题管理 UI、校验、槽位管理和启动恢复 | `tests/settings/ThemeManager.test.tsx`、`tests/settings/appearanceRegistry.test.ts`、`tests/settings/startupTheme.test.ts` |
| 阅读成果检索、引用、详情和原文入口 | `tests/agent/readingArtifactReferences.test.ts`、`tests/agent/readingArtifactTools.test.ts`、`tests/agent/ReadingArtifactCenter.test.tsx` |
| Ctrl+滚轮字号、启动位置和对照阅读位置 | `tests/editor/previewTabSwitchRegression.test.tsx`、`tests/editor/readingPositionSession.test.ts` |
| 空白拖选批注入口 | `tests/markdown/MarkdownPreview.readingMarksUi.test.tsx` |
| 单/双波浪号解析 | `tests/markdown/MarkdownPreview.gfm.test.tsx` |
| 各入口新建文档进入编辑模式 | `tests/editor/TabBar.newDocument.test.tsx`、`tests/editor/documentModelContract.test.ts` |

## 4. 对齐 GitHub Actions

GitHub Release 由推送 `v*` tag 触发，实际包含三个阶段：

1. `security-check`：在 Ubuntu 安装依赖后执行 `node scripts/pre-push-check.mjs --release`。
2. `quality`：执行 Lint、类型检查、全部前端测试、Web 构建、Rust fmt、Clippy、Rust 测试和 Rust check。
3. `release`：在 Windows 上执行 `npm run tauri build`，生成 NSIS、MSI 和免安装 ZIP，并创建 GitHub Release。

因此本地至少必须确认：

```powershell
npm run check:release
npm run tauri build
git diff --check
```

本地发布校验阶段还必须执行：

```powershell
node scripts/pre-push-check.mjs --release
```

该校验应在版本提交完成后、创建 tag 前执行，以便检查最终待发布内容。它失败时不得继续。

## 5. 远程操作安全边界

- 本地检查、构建和提交不等于已获准推送。
- 首次收到“发布/推送/tag”要求时，只执行发布前校验并报告结果；必须等待用户再次明确确认，才能进行对应远程操作。
- 禁止强制推送；不得使用 `--no-verify` 绕过检查。
- 未经明确授权，不得推送 tag、创建或修改 GitHub Release。

## 6. 发布后验收

tag 触发 GitHub Actions 后，确认以下项目全部通过：

- `security-check` 通过
- `quality` 通过
- Windows Tauri 构建通过
- GitHub Release 成功创建
- Release 包含 `.exe`、`.msi` 和免安装 `.zip`
- Release Notes 与实际提交一致

自动化通过后，必须提示用户使用实际 Windows 桌面版本完成以下人工验收。人工验收没有通过或没有执行时，只能报告 `NOT TESTED`，不得报告发布验收完成。

### 人工验收清单

- [ ] 使用新生成的 EXE、MSI 或便携版启动，确认首次启动、重启和升级后启动正常。
- [ ] 在设置→通用切换 AI 助手 12/14/16/18px，确认 AI 对话、输入框、阅读成果、引用、批注和阅读提醒同步变化。
- [ ] 添加、导入、删除和恢复自定义主题，重启后确认主题与字号仍保持；检查浅色、深色和自定义主题下的文字对比度。
- [ ] 使用真实 API/模型检索阅读成果，确认成果卡片、详情、引用和原文入口可用；确认网络或模型异常时有明确提示。
- [ ] 验证空白区域拖选批注、批注高亮和编辑；验证单波浪号文本、双波浪号删除线及各入口新建文档行为。
- [ ] 验证 Ctrl+滚轮缩放、启动位置恢复、编辑/预览切换和对照阅读时位置不跳动。
- [ ] 在窄窗口、不同窗口尺寸和全屏下检查 AI 发送按钮、主题、弹窗、字号和预览布局。
- [ ] 在 GitHub Actions 完成后确认 `security-check`、`quality`、Windows 构建、Release 创建及 EXE/MSI/ZIP 资产均成功。

流程结束时，必须向用户明确列出未完成的人工项目，并使用以下结论之一：

- `人工验收：PASS`：清单已实际完成且通过。
- `人工验收：FAIL`：清单中存在明确失败项，停止发布或修复后重验。
- `人工验收：NOT TESTED`：未执行真实桌面验收，不得宣称发布流程完成。

## 7. 结果记录

每项检查只能记录为：

- `PASS`：已实际执行且通过
- `FAIL`：已实际执行但失败
- `NOT TESTED`：本次未执行

不得用“应该可以”或代码阅读结果代替 `PASS`。
