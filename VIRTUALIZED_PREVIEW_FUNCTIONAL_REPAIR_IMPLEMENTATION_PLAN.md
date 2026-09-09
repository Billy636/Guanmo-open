# 虚拟化预览功能完整性修复实施计划

> 本文件是本任务唯一状态来源。执行者必须使用 `staged-task-handoff` Skill，完整读取本文件后，只执行“当前阶段”，不得提前实施后续阶段。

## 当前状态

- 项目状态：进行中
- 当前阶段：阶段 4｜真实桌面综合验收与无障碍边界
- 阶段状态：阻塞
- 上次执行结果（2026-08-20 验收）：
  - 阶段 2、3 的实现范围与阶段历史一致；未发现需要阻断验收的新增 P0/P1 缺陷
  - 阶段 2、3 核心定向回归通过：7 个测试文件、62/62 用例通过；`MarkdownPreview.html.test.tsx` 仍为已记录的 HEAD 既有 1 例失败
  - `npm run typecheck`、定向 ESLint（0 errors，`EditorArea.tsx` 5 个既有 warnings）、`npm run build:desktop`、desktop bundle budget（entry 923888 bytes）、`git diff --check` 通过
  - 阶段 4 临时材料仅证明在已有 GuanMo 进程中打开 100 万字符匿名文档并保存首屏截图；未启动隔离的新鲜当前构建进程
  - 阶段 4 未记录 20/50/100 万字符三档在 preview / edit-preview / dual-preview 的 5%/50%/95% 路径，也未记录复制、AI 上下文、搜索、锚点、目录、预览内编辑、details、快速切 Tab、DOM 节点数和滚动空白/跳动的真实桌面结果
  - 阶段 4 未记录键盘可达、目录导航、搜索结果播报或屏幕阅读器行为；现有截图显示 100 万字符首屏可见，但不能替代上述验收
- 本阶段剩余：在新鲜、隔离且确认使用当前构建的 Tauri/WebView2 进程中完成阶段 4 全部矩阵，并记录无障碍结论
- 本阶段允许修改：见阶段计划（阶段 4 范围：本任务文件、直接相关测试；验收发现明确回归时仅修改对应阶段的最小文件）
- 阻塞问题：缺少阶段 4 必需的真实桌面交互、性能守恒与键盘/屏幕阅读器验收证据，当前不能标记完成
- 遗留清理：
  - `tests/services/__scratch_probe.test.ts` 为阶段 1 调查用探查文件（5 用例通过），等待用户授权后删除
  - `tests/markdown/MarkdownPreview.html.test.tsx`「渲染 GitHub README 常见的 HTML 混排」为 HEAD 既有失败（源码标注 span 与测试选择器冲突），待用户决定修复方式，不阻塞本计划
- 下一阶段：阶段 4 完成后进入阶段 16｜条件项审计与总体验收（视阶段 4 结果而定）
- 远程操作：禁止提交、推送、打 tag、创建 PR 或 Release

## 项目目标

修复 Markdown 顶层块虚拟化后仍存在的功能退化，同时保留长文档首屏性能、有限 overscan、全文一次建模和同步 `ReactMarkdown` 契约。

最终结果必须满足：

1. 文档级复制、Ctrl+A 和 AI 选区上下文不得静默遗漏公式或安全 HTML 的有效内容。
2. 预览搜索结果必须具有明确且一致的语义；不得出现“计入结果、能够跳转、但页面没有任何可见命中”的静默错觉。
3. 页内锚点可以定位尚未挂载的目标；目录当前项不依赖标题 DOM 是否仍在虚拟窗口内。
4. 虚拟块卸载、重挂载不得破坏预览内编辑状态或受支持的交互 HTML 状态。
5. 不通过恢复全文隐藏 DOM、扩大 overscan、关闭虚拟化或引入 Worker 掩盖问题。
6. 自动检查与真实桌面验收必须分开记录；只有阶段验收真实通过后才能标记完成。

## 技术栈与关键入口

- 运行环境：Tauri / WebView2、React、TypeScript
- Markdown：`react-markdown`、remark/rehype、GFM、KaTeX、Mermaid、安全 HTML
- 文档 Source of Truth：`src/stores/editorStore.ts` 中 Tab 的 `content`
- 预览全文模型：`src/services/markdownPreviewModel.ts`
- DocumentRange / DOM 映射：`src/services/previewHighlight.ts`
- 虚拟块渲染与交互：`src/components/editor/MarkdownPreview.tsx`
- 预览编排、目录与 AI 选区：`src/components/editor/EditorArea.tsx`
- 目录活跃状态：`src/hooks/useActiveHeading.ts`
- 搜索入口：`src/components/editor/SearchOverlay.tsx`
- 安全 HTML：`src/services/markdownHtml.ts`

## 执行前必读

每个阶段开始前必须重新读取：

1. `AGENTS.md`
2. 本任务文件全文
3. `docs/architecture/state-ownership.md`
4. `docs/agent-contracts/markdown-editor.md`
5. `docs/AI_REVIEW_PROJECT.md`
6. 涉及 AI 选区时额外读取 `docs/agent-contracts/ai-selection.md`
7. 当前阶段列出的实际源码和直接相关测试

执行前先运行：

```powershell
git status --short
```

现有修改和未跟踪文件全部视为用户改动。尤其不得覆盖其他 `*_IMPLEMENTATION_PLAN.md`、`.trae/`、启动性能修改、Rust 修改及既有未跟踪契约测试。

## 调查基线与已确认缺陷

### 1. 公式与安全 HTML 被逻辑复制静默遗漏

- `collectTextSegments()` 只收集 `text`、`inlineCode`、`code` 和 hard break，跳过 `math`、`inlineMath`、`html`。
- `getTextForSourceRange()` 只拼接 `textSegments`。
- Ctrl+C、右键复制和 AI 选区快照复用该结果。
- 当前最小复现中，`alpha $x^2$ omega` 与 `<div>visible html</div>` 被复制为 `alpha  omega`，公式和 HTML 内容消失。

### 2. 未挂载页内锚点无法跳转

- 普通 hash 链接只查询当前预览 DOM 与 `document.getElementById()`。
- 目标位于远端、尚未进入虚拟窗口时没有模型定位回退，但 URL hash 仍会更新。
- 脚注回链已有行号估算路径，不应因本次修改回归。

### 3. 长章节目录当前项会变为空

- `useActiveHeading()` 只观察当前挂载标题。
- 章节标题卸载，而下一标题尚未挂载时，目录 active heading 被清空。
- 现有测试覆盖“滚动后观察新标题”，未覆盖长章节中间没有挂载标题的区间。

### 4. 交互 HTML 状态随块卸载重置

- 自包含安全 HTML 保持虚拟化；项目允许 `details/summary`。
- 用户修改 `<details>` 展开状态后，块卸载并重挂载会恢复为 Markdown 初始属性。
- 不得把所有 HTML 改为整篇渲染；只保存项目明确支持且可安全恢复的瞬时交互状态。

### 5. 编辑块重挂载后可能与编辑浮层重叠

- 编辑开始时使用 `data-md-editing` 隐藏原预览块。
- 虚拟块重挂载路径只恢复高亮，没有恢复编辑标记。
- 编辑浮层仍存在时，原渲染正文可能重新显示。

### 6. 搜索存在不可见源码命中

- 预览搜索直接扫描 `model.rawContent`。
- 链接 URL、Markdown 标记、公式源码或 HTML 标签可以被计数和定位，但没有可见 DOM Range。
- 必须先定义预览搜索是“可见文本搜索”还是“源码搜索”；不得继续混合两种语义。

### 7. 无障碍与原生浏览器能力边界

- 虚拟窗口外正文不在 DOM 和无障碍树中，屏幕阅读器、浏览器原生查找和原生语义导航只能访问挂载片段。
- 这是架构边界，不允许通过隐藏全文 DOM修复；阶段 4 必须给出可验证的产品级降级或明确阻塞结论。

## Blast Radius

直接影响：

- `markdownPreviewModel`、`previewHighlight`、`MarkdownPreview`、`useActiveHeading`、`SearchOverlay` 和相关定向测试。

间接依赖：

- 右键复制、Ctrl+A/C、AI 选区上下文、双栏预览、目录、页内链接、脚注、预览内编辑、安全 HTML 和阅读位置/滚动同步。

高风险点：

- 核心文档模型、全局源码 offset、虚拟块 mount/unmount、ref 生命周期、高度缓存、文件/标签切换和异步渲染。

禁止影响：

- Tab `content` 与保存基线、编辑器行为、导出链路、任务列表、reference/footnote、跨块 HTML whole-document 兼容、Web 能力边界、文件系统、数据库、AI 路由和 RAG。

风险等级：`HIGH`。核心文档模型与虚拟化生命周期均属于项目 HIGH-Risk Areas。

## 总体约束

- 每个会话默认只执行一个阶段。
- 先用匿名最小夹具稳定复现本阶段缺陷，再修改实现。
- DOM 只能用于交互命中和显示，不能成为全文业务数据源。
- 不增加第二份文档 Source of Truth；派生索引必须能从 Tab content 重建。
- 不改变原始 Markdown offset 坐标系，不使用 DOM 文本长度反推源码位置。
- 不恢复全文隐藏 DOM，不扩大 overscan 规避缺陷，不关闭虚拟化。
- 不引入 Worker、虚拟列表依赖或新的后台服务。
- 不恢复长度阈值分支或“正在解析预览”占位路径。
- 不修改 SQLite、文件授权、RAG、网络、发布或构建阈值。
- 不自动更新快照，不执行无关全量 E2E。
- 不自动调用模型 Reviewer；只有 boss 明确要求 `ai-code-review` 后才执行。
- 不提交、不推送、不打 tag、不创建 PR 或 Release。

## 阶段计划

### 阶段 1｜全文可见文本与搜索语义修复

- 目标：消除复制/AI 上下文内容缺失，并统一预览搜索与可见文本的语义。
- 允许范围：`markdownPreviewModel.ts`、`previewHighlight.ts`、`MarkdownPreview.tsx`、`SearchOverlay.tsx` 及直接相关测试。
- 验收重点：公式和安全 HTML 不再静默丢失；普通文本 offset 不回归；不可见 Markdown 语法不再产生无反馈命中。
- 暂不处理：锚点、目录、交互状态、编辑块生命周期和无障碍。

### 阶段 2｜模型驱动锚点与目录状态

- 目标：将页内锚点定位和目录当前项迁移到完整模型/滚动位置，不依赖目标 DOM 是否挂载。
- 允许范围：`markdownPreviewModel.ts`、`MarkdownPreview.tsx`、`EditorArea.tsx`、`useActiveHeading.ts` 及直接相关测试。
- 验收重点：远端锚点可跳转；长章节持续保持正确目录项；左右预览互不串状态。
- 暂不处理：HTML 交互状态、预览内编辑重挂载和无障碍边界。

### 阶段 3｜虚拟块交互生命周期修复

- 目标：修复预览内编辑块和受支持交互 HTML 在卸载/重挂载后的状态损坏。
- 允许范围：`MarkdownPreview.tsx`、`markdownHtml.ts`、必要的局部样式和直接相关测试。
- 验收重点：编辑草稿不丢失、不重复显示；`details/summary` 状态按文档实例和稳定块身份恢复；切文档不串状态。
- 暂不处理：新增 HTML 标签、表单持久化、媒体播放续播和全局持久化。

### 阶段 4｜真实桌面综合验收与无障碍边界

- 目标：在新鲜 Tauri/WebView2 进程中验收前三阶段，并为虚拟化无障碍/原生浏览器能力给出最小可行处理或阻塞结论。
- 默认允许范围：本任务文件、直接相关测试；验收发现明确回归时仅修改对应阶段的最小文件。
- 验收重点：长文 5%/50%/95% 路径、左右预览、模式切换、复制、AI 上下文、搜索、锚点、目录、编辑、HTML 状态和性能守恒。
- 禁止：以隐藏全文 DOM、显著扩大挂载量或关闭虚拟化换取无障碍表面通过。

## 当前阶段详细任务

### 阶段 1 目标

建立不依赖挂载 DOM 的完整文本投影，使预览逻辑复制、AI 选区上下文和搜索对公式/安全 HTML 具有确定语义，且不破坏现有 DocumentRange offset。

### 阶段 1 允许修改

- `src/services/markdownPreviewModel.ts`
- `src/services/previewHighlight.ts`
- `src/components/editor/MarkdownPreview.tsx`
- `src/components/editor/SearchOverlay.tsx`（仅当统一搜索语义确实需要）
- `tests/services/documentRangeContract.test.ts`
- `tests/services/previewHighlight.test.ts`
- `tests/selection/selectionContextContract.test.ts`
- `tests/editor/SearchOverlay.preview.test.tsx`
- 可新增一个直接描述可见文本投影的定向测试文件
- `VIRTUALIZED_PREVIEW_FUNCTIONAL_REPAIR_IMPLEMENTATION_PLAN.md`

已有未跟踪测试属于用户改动。修改前必须读取并确认内容；能够新增独立测试时优先新增，禁止覆盖或重写既有未跟踪文件。

### 阶段 1 实施任务

1. 用匿名夹具稳定复现并写入测试：
   - 行内/块级数学位于普通文本之间；
   - 自包含安全 HTML 含可见文本；
   - 公式或 HTML 跨越逻辑选区；
   - 链接 URL、Markdown 标记等只存在于源码、不直接显示的文本；
   - LF 与 CRLF。
2. 明确定义文本投影契约：
   - 普通 Markdown 文本保持当前渲染可见文本语义；
   - 数学与安全 HTML 不得静默变成空字符串；
   - 无法精确表示渲染文本的区域，使用稳定、可解释的源码文本回退，并保持原始 offset；
   - 块间分隔不得重复、吞行或制造不存在的空白；
   - 不把 KaTeX/Mermaid 生成 DOM 当作全文数据源。
3. 在完整模型中建立可重建的文本投影或等价索引：
   - 每个投影片段必须能映射到原始 `{from,to}`；
   - 保留 `DocumentRange` 的块 ID + 局部 offset 契约；
   - 内容、文档或版本变化时旧投影必须失效；
   - 不写入 Tab、不引入全局 Store。
4. 修复复制和 AI 选区消费：
   - Ctrl+A/C、跨块拖选、右键复制使用同一投影；
   - AI 上下文仍携带精确原始 selection offset，不能只保存投影字符串位置；
   - KaTeX 等当前原生选区降级路径不得回归。
5. 统一预览搜索语义：
   - 默认以可见文本投影产生结果和计数；
   - 每个结果必须能映射回原始 offset 并定位对应块；
   - 只存在于 Markdown 语法、链接 URL 或 HTML 标签中的文本不得作为无可见反馈的结果；
   - 编辑器模式继续按 CodeMirror 原文搜索，不得被预览语义修改；
   - 如果必须保留源码搜索，必须形成明确可见的独立模式并先请求 boss 决策，本阶段不得擅自新增 UI。
6. 做性能守恒检查：
   - 模型仍只对全文建模一次；
   - 搜索不得为每个虚拟块重复解析全文；
   - 100 万字符匿名样本不得恢复线性 DOM 挂载；
   - 不因文本投影增加无法失效的长期缓存。

### 阶段 1 验收标准

- [ ] 逻辑全文复制包含行内数学、块级数学和安全 HTML 的确定文本，不再静默遗漏。
- [ ] 跨块选择包含上述区域时，复制结果顺序稳定且无重复内容。
- [ ] 右键“添加到 AI 上下文”保留原始 selection offset，并包含确定的有效文本。
- [ ] 普通 Markdown、代码、中文、英文、LF、CRLF 的现有提取结果不回归。
- [ ] 预览搜索每个计数结果都有可见语义和可定位目标。
- [ ] 搜索链接 URL、Markdown 标记或 HTML 标签不会产生无高亮的幽灵结果。
- [ ] 未挂载匹配仍可定位并在挂载后恢复高亮。
- [ ] 编辑器搜索语义不变。
- [ ] 不恢复全文 DOM，不产生 `markdownPreview.worker-*`。
- [ ] 定向测试、selection context 门禁、typecheck、定向 ESLint、desktop build、bundle budget 和 `git diff --check` 通过。

### 阶段 1 检查命令

根据实际修改文件收窄参数；至少执行：

```powershell
npx vitest run tests/services/documentRangeContract.test.ts tests/services/previewHighlight.test.ts tests/selection/selectionContextContract.test.ts tests/editor/SearchOverlay.preview.test.tsx --maxWorkers=1
npm run test:selection-context
npm run typecheck
npx eslint src/services/markdownPreviewModel.ts src/services/previewHighlight.ts src/components/editor/MarkdownPreview.tsx src/components/editor/SearchOverlay.tsx
npm run build:desktop
npm run check:bundle:desktop
git diff --check
git status --short
```

测试文件不存在时不得伪造 PASS；应改用实际直接相关文件并在状态中记录替代命令。

### 阶段 1 禁止事项

- 不修改阶段 2–4 的实现。
- 不修改 `editorStore`、数据库、文件系统、RAG 或外部 HTTP。
- 不依赖预览 DOM 全文扫描构建复制/搜索数据。
- 不为公式或 HTML 猜测字符级 DOM 映射；无法精确映射时使用已定义的确定回退。
- 不新增搜索模式或设置 UI，除非 boss 先确认产品语义。
- 不修改构建预算阈值，不新增依赖。
- 不提交或推送代码。

## 后续阶段验收要点

### 阶段 2 必须覆盖

- 目标标题/HTML anchor 位于当前窗口上方、下方和文档 95% 位置。
- 目标尚未挂载时先按模型定位，挂载测量后最多进行一次幂等校正；不得形成滚动反馈循环。
- 锚点不存在时不修改滚动位置，并保持安全 no-op。
- 目录当前项按“滚动位置之前最后一个标题”计算，长章节中间不得变空。
- 目录点击、编辑器-预览同步、阅读位置恢复共享现有定位 API，不建立第二套滚动状态。
- 左右预览、快速切 Tab、模式切换不串 active heading 或 hash 目标。

### 阶段 3 必须覆盖

- 编辑中把块滚出 overscan 再滚回：草稿、光标/选择和冲突状态保留，原预览正文仍隐藏，不出现双层内容。
- 外部提交、切 Tab、关闭预览继续遵守现有单次提交和草稿保护契约。
- `<details>` 展开/折叠后滚出再返回保持用户状态；文档内容变化、切文档或块身份变化时旧状态正确失效。
- 交互状态仅保存在预览实例局部 ref/派生状态，不写 Tab content、不持久化到数据库。
- reference、footnote、安全 HTML 和 whole-document 兼容测试继续通过。

### 阶段 4 必须覆盖

- 使用匿名 20 万、50 万、100 万字符文档，在新鲜 Tauri/WebView2 进程执行。
- 覆盖 preview、edit-preview、dual-preview，检查 5%/50%/95% 滚动位置。
- 覆盖复制、Ctrl+A/C、右键 AI 上下文、搜索、锚点、目录、预览内编辑、`details` 状态和快速切 Tab。
- 记录首屏挂载块数、DOM 节点数、滚动空白/跳动；不得只以 JSDOM、typecheck 或构建代替桌面结论。
- 无障碍至少验证键盘可达、目录导航、搜索结果播报和屏幕阅读器对当前虚拟窗口的行为。
- 若完整文档无障碍语义无法在不恢复全文 DOM 的前提下实现，阶段标记为 `阻塞`，记录可选产品降级并等待 boss 决策，不得私自牺牲性能契约。

## 阶段完成规则

每完成一个阶段：

1. 真实运行该阶段规定的检查。
2. 更新顶部“当前状态”，只保留最近一次执行摘要。
3. 在“阶段历史”记录最终状态、核心改动、验证结果和遗留问题。
4. 当前阶段切换到下一阶段；不得在同一阶段顺带实现后续内容。
5. HIGH 风险任务交接时建议 L3 验收模型，但只有 boss 明确调用后才执行模型 Review。

模型 Review 提示词：

```text
使用 ai-code-review Skill 执行本次模型 Review；只审查当前任务范围，遵循 AGENTS.md 和本项目 Review Profile。
```

## 阶段历史

### 阶段 1｜全文可见文本与搜索语义修复

- 状态：已完成
- 完成内容：
  - 文本投影契约落地：数学以去定界符 LaTeX 源码作为确定回退文本（from/to 逐字符对齐 value 区间）；安全 HTML 按标签切分文本 run（不解码实体、逐字符对齐）；script/style/foreignObject（sanitize strip 列表）内部文本不产生 segment，含跨 mdast 节点的未闭合内联场景
  - 新增 `getVisibleTextProjection`：全文块 textSegments 顺序拼接（块间 `\n\n`），WeakMap 按模型实例缓存，内容变化即新模型实例自动失效；不写 Tab、不引入全局 Store
  - 新增 `searchVisibleText`：预览搜索统一为可见文本投影域，命中映射回原始 offset + blockIndex，与复制域（`getTextForSourceRange`）同一语义；消除链接 URL / Markdown 标记 / HTML 标签的幽灵命中
  - `MarkdownPreview` 预览高亮索引与 `SearchOverlay` 预览搜索改用投影语义；编辑器搜索路径未改动
  - AI 上下文维持 raw slice + 精确 selection offset（调查确认无需修改）
  - 验收返修修正 `inlineCode`、围栏代码与缩进代码的 value 源码映射；代码搜索命中不再落在 Markdown 定界符或缩进，覆盖内容反引号、LF 与 CRLF
- 验证结果：visibleTextProjection 15/15、其余定向回归 13/13（合计 28/28）、selection-context 门禁、typecheck、定向 ESLint（0 errors）、build:desktop、bundle budget、`git diff --check` 全部通过
- 遗留问题：
  - KaTeX 块级公式标注属降级边界（math 走 KaTeX、代码块走 rehypeHighlight 无源码标注），搜索/复制使用确定回退文本，不做字符级 DOM 映射——符合阶段 1 契约，未越界处理
  - `tests/services/__scratch_probe.test.ts`（阶段 1 调查用探查文件，5 用例通过）待用户授权删除

### 阶段 2｜模型驱动锚点与目录状态

- 状态：已完成
- 完成内容：
  - `markdownPreviewModel.ts`：新增 `findAnchorTarget` 与 `PreviewAnchorTarget` 契约（heading-line / heading-slug / html-id 三种命中方式；code/mermaid/frontmatter 块跳过；HTML id 按块内换行计数定位所在行）
  - `useActiveHeading.ts`：重写为"滚动几何 + 模型驱动 resolver"契约（scroll 被动监听 + rAF 节流 + ResizeObserver；容器晚挂载 rAF 重试；resolver 由调用方基于全文模型计算），目录活跃项不再依赖标题 DOM 是否在虚拟窗口内
  - `MarkdownPreview.tsx`：`scrollToLineInternal` 目标未挂载时按全文模型估算即时定位，`pendingLineCorrectionRef` 在目标挂载测量后执行最多一次幂等校正（读取即清空，无滚动反馈循环）；`handleAnchorClick` 实例内 DOM 查找失败后走 `findAnchorTarget` 模型回退，不回退 `document.getElementById`（避免双栏预览同 id 串扰）；锚点不存在时安全 no-op（不滚动、不改 hash）
  - `EditorArea.tsx`：`resolveActiveHeadingByScroll`（滚动位置之前最后一个标题；文档顶部回落视口上半区可见首个标题，与原 IntersectionObserver rootMargin -50% 行为一致）+ 左右预览各自 resolver 接入 `useActiveHeading`，trigger 携带 viewMode/tab/version
- 验证结果：阶段 2 核心六文件 41/41 通过；定向回归 123/124（`MarkdownPreview.html.test.tsx` 1 例为 HEAD 既有失败，独立 worktree 复现确认与本阶段无关）；typecheck、定向 ESLint（0 errors）、build:desktop、bundle budget（entry 923888 bytes）、`git diff --check` 全部通过
- 遗留问题：
  - `tests/markdown/MarkdownPreview.html.test.tsx`「渲染 GitHub README 常见的 HTML 混排」为 HEAD 既有失败（阶段 1 源码标注 span 注入改变 `blockquote span` 选择器匹配），待用户决定修复方式，不阻塞本计划

### 阶段 3｜虚拟块交互生命周期修复

- 状态：已完成
- 完成内容：
  - `MarkdownPreview.tsx`：交互 HTML 瞬时状态契约落地——`interactiveHtmlStateRef`（键 `blockId#块内序号`，值 details open，仅存预览实例局部 ref，不写 Tab content、不持久化）；渲染期失效键（`documentKey + displayedContent` 变化即整体清除，执行早于本帧块挂载 ref callback，避免"先恢复旧状态、又被清空"的时序倒置）；`restoreInteractiveHtmlState` 在块（重）挂载时恢复 details 用户态；root 捕获阶段委托监听 toggle（不冒泡事件）
  - `MarkdownPreview.tsx`：编辑块重挂载修复——编辑浮层定位 layout effect 依赖扩展至 `visible.startIndex/endIndex`，块滚出 overscan 卸载再滚回后恢复 `data-md-editing` 标记（原正文仍隐藏，不与编辑浮层形成双层内容）并按新挂载位置重算浮层矩形；外部提交、切 Tab、关闭预览的既有单次提交与草稿保护契约未改动
  - `markdownHtml.ts`：无需修改（details 状态恢复在预览实例层完成，未触碰 sanitize/渲染链路）
  - 测试：新增 `tests/markdown/MarkdownPreview.interactiveState.test.tsx`（6 用例）
- 验证结果：interactiveState 6/6、inlineEdit 30/30、anchor 4/4、layout 2/2、markdownReferenceVirtualization 3/3、html 3/4（1 例为 HEAD 既有失败，与本阶段无关）；typecheck、定向 ESLint（0 errors 0 warnings）、build:desktop、bundle budget（entry 923888 bytes）、`git diff --check` 全部通过
- 遗留问题：无（交互状态仅覆盖项目明确支持的 `details/summary`，不含表单、媒体播放等未支持交互）

## Trae 新会话启动提示词

```text
请使用 staged-task-handoff Skill，完整读取 VIRTUALIZED_PREVIEW_FUNCTIONAL_REPAIR_IMPLEMENTATION_PLAN.md，
根据“当前状态”只执行当前阶段，不重复已完成内容，不提前实施后续阶段。

开始前读取 AGENTS.md、当前阶段要求的契约和实际源码，并执行 git status --short。
保留所有既有修改和未跟踪文件；先稳定复现，再按最小范围实现。
完成后执行当前阶段规定的检查，更新任务文件中的当前状态和阶段历史。
不要提交、推送、打 tag、创建 PR 或 Release。
```
