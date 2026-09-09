# 长文档打开与预览首屏性能分阶段实施计划

> 本文件是本任务唯一状态来源。执行者必须使用 `staged-task-handoff` Skill，完整读取本文件后，只执行"当前阶段"，不得提前实施后续阶段。

## 当前状态

- 项目状态：进行中
- 当前阶段：阶段 4｜真实桌面验收与止损收尾
- 阶段状态：未开始（等待 boss 手动验收）
- 上次执行结果（阶段 1–3 验收与修复）：
  - 修复生产虚拟预览的任务列表全局行号、重复 ReactMarkdown 渲染、全文搜索定位、测量缓存失效和异步高度锚点校正
  - 修复跨块 reference/footnote 与安全 HTML 的语义退化：依赖全文上下文时使用同步整篇兼容路径
  - 修复 `markdownPreviewModel` 每块从头扫描 offset 的 O(块数 × 文档长度) 瓶颈，等长规范化直接复用原始 offset
  - 真实浏览器 3 次中位数：50K=138ms、200K=312ms、500K=650ms、1M=1.356s；相对调查基线提升约 87%–89%
  - 首屏挂载 11–16 块、56–240 个 DOM 节点；1M 滚动到 50%/95% 均持续挂载 15 块，无空白，校正后总高度变化约 0.34%
- 验证结果：定向回归 119 通过/2 跳过；语义样本 9 通过；typecheck、定向 ESLint（0 error）、desktop build、bundle budget 通过
- 本阶段剩余：由 boss 按阶段 4 矩阵执行真实打包桌面验收并回填结果
- 本阶段允许修改：阶段 4 反馈前仅更新本文件；若验收失败，只修复明确复现对应的最小范围
- 验收说明：阶段 1 历史改前桌面 A/B 未写入旧计划，无法事后还原；阶段 4 必须以真实打包桌面数据作最终结论
- 阻塞问题：无；等待 boss 手动执行阶段 4
- 下一阶段：无；阶段 4 通过后结束本任务
- 远程操作：禁止提交、推送、打 tag、创建或修改 Release

## 项目目标

解决 Markdown 文档打开延迟随正文规模近似线性增长的问题，同时保持观墨现有编辑、预览和文件安全契约。

最终结果必须满足：

1. 纯编辑模式打开大文档时，不在后台创建整篇隐藏预览 DOM。
2. 直接以预览模式打开时，优先产出可阅读的可视区内容，全文规模不再决定首屏 DOM 数量。
3. 不恢复已经回滚的旧 Worker/HAST/占位加载实现。
4. 保持 GFM、KaTeX、Mermaid、安全 HTML、任务列表、目录、滚动同步、预览内编辑和选择上下文能力。
5. 所有性能结论来自用户真实操作路径和真实浏览器/桌面数据，不以单元测试、JSDOM、类型检查或构建成功代替体验验收。
6. 任何生产渲染架构变化必须先通过隔离原型 A/B，并在获得 boss 明确确认后才能修改预览契约和接入生产。

## 技术栈与关键入口

- 运行环境：Tauri 桌面应用，前端运行于 WebView
- 语言：TypeScript、React、Rust
- 编辑器：CodeMirror 6
- Markdown：`react-markdown`、remark、rehype、GFM、KaTeX、Mermaid
- 状态：Zustand
- 测试：Vitest、React Testing Library、项目脚本、真实浏览器/桌面性能面板
- 构建：Vite、`npm run build:desktop`
- 文件读取入口：`src/services/fileSystem.ts` → `src/hooks/useTauri.ts` → Rust `read_text_file_by_path`
- 编辑器/预览编排：`src/components/editor/EditorArea.tsx`
- 编辑器实例：`src/components/editor/CodeMirrorEditor.tsx`
- 预览实例：`src/components/editor/MarkdownPreview.tsx`
- 顶层块和源码 offset：`src/services/markdownBlocks.ts`
- 模式预热/资源策略：`src/services/editorSession.ts`

## 执行前必读

执行任何阶段前必须重新读取：

1. `AGENTS.md`
2. `AI_IMPLEMENTATION_PLAN.md`
3. 当前阶段列出的实际源码
4. `docs/agent-contracts/markdown-editor.md`
5. 涉及文件打开或 Rust 文件读取时，额外读取 `docs/agent-contracts/file-access.md`
6. 涉及设置持久化时，额外读取 `guides/compatibility.md`；若仓库中不存在该文件，记录缺失，不得自行编造规则

额外要求：

- 开始前执行 `git status --short`，现有修改全部视为用户修改。
- 本任务开始时已存在 `AI_IMPLEMENTATION_PLAN.md` 修改和多项无关未跟踪文件；不得覆盖、删除、格式化、暂存或提交这些文件。
- 本任务属于 Markdown 渲染、状态/资源生命周期和性能架构范围；探索和 review 必须先使用 `code-review-graph` 最小查询，再进行精确源码搜索。
- 不得自动启用 Trellis。
- 测试 Fixture 只能使用匿名生成内容和临时目录，不得读取真实用户文件。

## 调查基线

### 2026-07-31 浏览器真实路径基线

测试方式：

- 使用桌面构建模式的真实 React/WebView 等价前端路径。
- 页面初始化前向 Zustand 注入匿名生成 Markdown，避免持久化恢复覆盖夹具。
- 每份文档包含标题、中文正文、英文、数字和普通段落。
- 计时起点为页面导航，终点为 CodeMirror 或 MarkdownPreview DOM 首次挂载。
- 此数据没有包含系统文件选择器和真实磁盘读取，因此只能说明渲染链本身足以产生线性延迟；阶段 1 必须补齐打包桌面的端到端数据。

| 字符数 | 编辑器首次挂载 | 预览首次挂载 | 预览 DOM 节点约数 | 顶层块约数 |
|---:|---:|---:|---:|---:|
| 50,000 | 0.68s | 1.26s | 1,600 | 661 |
| 200,000 | 0.65s | 2.44s | 5,600 | 2,640 |
| 500,000 | 0.74s | 5.44s | 13,700 | 6,598 |
| 1,000,000 | 0.98s | 10.25s | 27,200 | 13,194 |

### 纯派生计算基线

同一匿名样本中，`parseMarkdownBlocks()` 中位耗时：

| 字符数 | `parseMarkdownBlocks()` |
|---:|---:|
| 50,000 | 约 100ms |
| 200,000 | 约 319ms |
| 500,000 | 约 760ms |
| 1,000,000 | 约 1,761ms |

`extractToc()`、LaTeX 规范化和内容签名各自远小于上述耗时。当前预览还会把全文交给 `ReactMarkdown`，再次执行 remark → rehype → React 元素流水线，所以问题不是一个防抖常量可以解决。

### 已验证事实

1. CodeMirror 只绘制可视区附近的编辑器 DOM，编辑器首次挂载随文档增长较缓。
2. `MarkdownPreview` 当前先调用 `parseMarkdownBlocks(displayedContent)`，随后又把全部 `normalizedContent` 交给 `ReactMarkdown`。
3. 预览 DOM 节点数随全文规模近似线性增长。
4. `open-file-complete` 当前在磁盘读取完成后立即结束，发生在 `addTab()` 和编辑器/预览首帧之前，不能代表用户看到文档的时间。
5. 默认“均衡”策略映射到 `smart` 预热；`getNextPrewarmTarget()` 即使对超过 10 万字符的文档也始终把 `preview` 放入候选，导致纯编辑打开后仍可能构建整篇隐藏预览。
6. 单独使用 `content-visibility: auto` 的 A/B 没有稳定收益：它可能减少布局/绘制，但不能避免 Markdown 解析、React 节点创建和 DOM 插入，禁止把它当作主修复。

## 历史失败边界

仓库曾引入大文档 Worker/HAST/分块虚拟化路径，后因真实体验退化而回滚。执行者不得把历史实现误当作当前架构或现成答案。

已知问题：

- Worker 路径曾出现 `DOMParser is not defined`。
- 10 万字符文档编辑时反复显示“正在解析预览”。
- Worker 缓存未在单字符编辑场景稳定复用。
- 专项测试、类型检查和构建通过，但用户真实路径仍无改善。
- 将 Worker 阈值临时设为无限、恢复同步 `ReactMarkdown` 后，用户确认体验恢复。

因此本任务的硬规则是：

1. 不 cherry-pick、不复制、不恢复旧 Worker/HAST/虚拟化提交。
2. 当前计划默认不引入 Worker，不允许生成 `markdownPreview.worker-*`。
3. 不增加按字符阈值显示“正在解析预览”的占位分支。
4. 不用后台整篇隐藏 DOM 冒充懒加载。
5. 同一根因方向第一次真实 A/B 无收益时重新检查假设；第二次仍无收益必须停止、回退该方向并写止损记录。

## 总体约束

- 每个会话默认只执行一个阶段。
- 只修改当前阶段“允许修改”中的文件。
- 先定义和复测基线，再实施；不得先改代码后补性能故事。
- 不重构无关模块，不升级无关依赖，不清理预先存在的死代码。
- 不新增依赖作为默认方案；确需新增依赖时，必须先记录必要性、许可证、构建体积增量和替代方案，并等待 boss 确认。
- 不改变 `.md` 文件范围、文件授权、数据库、AI、RAG 或 Web 能力边界。
- 不清空或重置用户设置、标签页、最近文件和阅读位置。
- 不自动更新快照。
- 不自动执行全量测试、全量 E2E 或发布门禁。
- 不提交、不推送、不打 tag、不创建 PR 或 Release。
- 阶段状态只能使用：`未开始`、`进行中`、`阻塞`、`已完成`。
- 只有当前阶段验收项和必要检查真实通过，才能标记为已完成。

## 性能指标定义

阶段 1 必须建立下列边界，后续阶段统一复用：

1. `file_read_ms`：开始打开请求到 Rust 文本读取返回。
2. `state_commit_ms`：读取返回到目标标签页成为 active tab。
3. `editor_first_visible_ms`：打开请求到 CodeMirror 内容在下一帧可见。
4. `preview_first_visible_ms`：打开请求到预览首批内容在下一帧可见。
5. `main_thread_long_task_max_ms`：打开期间最长主线程 Long Task。
6. `preview_dom_nodes`：预览区域实际 DOM 节点数。
7. `preview_block_count`：当前已挂载预览块数。
8. `post_open_background_work_ms`：首帧后 3 秒内由预热触发的主线程工作。

隐私要求：

- 埋点只能记录字符数、匿名 size bucket、模式、资源类型和耗时。
- 不记录文件路径、文件名、正文、标题、选区、用户标识或对话信息。
- 不把性能事件持久化到业务数据库。

## 阶段计划

### 阶段 1｜补齐真实指标并消除隐藏全文预热

#### 目标

以最小风险解决纯编辑打开后的后台全文预览开销，并建立后续优化可复用的端到端测量边界。

#### 允许修改

- `src/services/eventMarker.ts`
- `src/services/fileSystem.ts`
- `src/services/editorSession.ts`
- `src/components/editor/EditorArea.tsx`
- `src/components/editor/CodeMirrorEditor.tsx`
- `src/components/devtools/PerfMonitorPanel.tsx`
- `tests/editor/**` 中与预热决策、资源生命周期、事件边界直接相关的测试
- `AI_IMPLEMENTATION_PLAN.md`

#### 实施任务

1. 先在当前代码上，用 20 万、50 万、100 万字符匿名临时 `.md` 文件复测：
   - 普通“打开文件”入口；
   - 当前模式为 `edit`；
   - 当前模式为 `preview`；
   - 默认“均衡”性能策略。
2. 修正性能事件语义：
   - 保留现有 `open-file-complete` 的兼容含义，不能悄悄改变已有事件解释；
   - 新增从文件请求到 active tab、编辑器首帧、预览首帧的可关联事件；
   - 首帧完成点必须位于 DOM commit 后的 `requestAnimationFrame`，不能只以 React render 函数返回或 Zustand set 完成作为“可见”；
   - 所有入口尽量复用同一中央测量边界，不在 Sidebar、CommandPalette、FileTree 等入口复制计时代码；
   - 如果无法以最小改动统一所有入口，当前阶段只覆盖普通打开和现有标签切换，并在计划中明确未覆盖项。
3. 调整预热决策：
   - 默认 `balanced/smart` 对达到现有“大文档”阈值的文档返回“不预热隐藏 preview”；
   - `memory/off` 继续完全不预热；
   - `speed/turbo` 保留用户明确选择的积极预热语义；
   - 小文档现有预热顺序不得改变；
   - 不新建第二套阈值，优先复用 `MODE_PREWARM_HUGE_DOC_LENGTH` 或抽取单一命名常量。
4. 调整预览模式的隐藏编辑器资源：
   - 验证 `editorMounted` 初始为 `true` 是否导致直接预览打开时无条件创建不可见 CodeMirror；
   - 若证据成立，使预览模式仅在编辑器可见、被合法预热或即将切换到编辑相关模式时创建 CodeMirror；
   - 保留阅读位置、光标、选区、IME、撤销历史初始化和模式切换行为；
   - 如果该修改导致生命周期或恢复行为不稳定，撤回本子任务，不用补丁叠加掩盖问题。
5. 增加定向测试：
   - `smart + >= 大文档阈值` 不返回隐藏 preview 预热目标；
   - `smart + 小文档` 保持原有预热；
   - `turbo + 大文档` 保留 preview 预热；
   - 预览模式不创建无用途编辑器，切到 edit/edit-preview 后正常创建；
   - 文档切换、资源释放和已有草稿保护不回归；
   - 新事件不包含路径或正文。
6. 用相同匿名样本完成改前/改后 A/B，并把中位数、最大值、DOM 节点数和 Long Task 写回本文件。

#### 验收标准

- [ ] 普通文件读取耗时与 UI 首帧耗时可以区分。
- [ ] 性能面板可以看到编辑器首帧和预览首帧事件，且事件之间可关联。
- [ ] 埋点不包含路径、文件名或正文。
- [ ] `balanced/smart` 打开 20 万、50 万、100 万字符文档进入纯编辑模式后，等待 3 秒仍无隐藏 MarkdownPreview 全文 DOM。
- [ ] 上述场景的预览 DOM 节点数为 0，且没有 `prewarm-create` 请求创建 `left-preview`。
- [ ] `speed/turbo` 和小文档预热行为保持原有语义。
- [ ] 直接预览模式仍能显示完整内容；本阶段允许其首次预览耗时尚未根治，但不得比基线恶化超过 15%。
- [ ] 编辑器首次可见时间不得比同环境改前中位数恶化超过 15%。
- [ ] 从 preview 切到 edit/edit-preview 后，编辑器内容、光标/阅读位置和输入正常。
- [ ] 不产生 `markdownPreview.worker-*`。
- [ ] 定向测试、类型检查、定向 Lint、桌面构建和 `git diff --check` 通过。

#### 检查命令

根据实际测试文件名执行最小集合，至少包括：

```powershell
npx vitest run tests/editor/modeResourcePolicy.test.ts tests/editor/EditorArea.resourceLifecycle.test.tsx
npm run typecheck
npx eslint src/services/eventMarker.ts src/services/fileSystem.ts src/services/editorSession.ts src/components/editor/EditorArea.tsx src/components/editor/CodeMirrorEditor.tsx src/components/devtools/PerfMonitorPanel.tsx
npm run build:desktop
git diff --check
git status --short
```

若某个文件未修改，可从定向 ESLint 参数中移除；不得因为计划列出而顺带格式化未修改文件。

#### 暂不处理

- 不改变 `MarkdownPreview` 的生产渲染架构。
- 不实现预览块虚拟化。
- 不引入 Worker。
- 不新增第三方虚拟列表依赖。
- 不修改 Markdown 预览契约。
- 不优化 Rust 文件读取；除非真实指标证明它是当前主瓶颈。

#### 阶段完成后的状态

阶段 1 验收通过后：

- 将阶段 1 写入“阶段历史”。
- 当前阶段切换为“阶段 2｜隔离原型验证单次解析与可视区块渲染”。
- 不在同一提交或同一阶段继续修改 `MarkdownPreview` 生产渲染。

---

### 阶段 2｜隔离原型验证单次解析与可视区块渲染

#### 前置条件

- 阶段 1 已完成并写入真实桌面基线。
- 当前生产契约仍保持“统一同步 ReactMarkdown”；本阶段原型不得接入生产入口。

#### 目标

在隔离环境中验证：能否保持全文 Markdown 语义和源码位置，同时只把可视区附近顶层块转换为 React DOM。先证明方案成立，再讨论生产接入。

#### 默认允许修改

- 新增独立的纯原型/基准文件，例如 `scripts/markdown-preview-prototype/**`
- 新增只被原型引用的纯解析模型，例如 `src/services/markdownPreviewModel.ts`
- 新增对应的匿名 Fixture 和定向测试
- `package.json` 仅允许新增本阶段测试脚本，不允许新增依赖
- `AI_IMPLEMENTATION_PLAN.md`

不得修改：

- `src/components/editor/MarkdownPreview.tsx`
- `src/components/editor/EditorArea.tsx`
- `docs/agent-contracts/markdown-editor.md`
- `scripts/bundle-budget-check.mjs`

#### 候选设计必须满足

1. 全文只建立一次文档级语法模型。
2. 模型保留：
   - 原始 `startOffset/endOffset`；
   - `startLine/endLine`；
   - 稳定块标识；
   - 全局 reference definition、footnote 和 heading ID 所需信息。
3. 可视区只转换和挂载目标顶层块及有限 overscan。
4. 未挂载区域使用高度估计，已挂载块使用真实测量值。
5. 图片、Mermaid、字体、容器宽度变化后能够更新块高，并保持当前阅读锚点稳定。
6. 目录跳转和恢复阅读位置能够先定位块，再在测量后校正。
7. 不把 Markdown 按固定字符数或固定行数随意切片。
8. 不在 Worker 中运行 DOM、KaTeX、Mermaid、安全 HTML 或 React 逻辑。
9. 本阶段默认完全不使用 Worker。

#### 必须覆盖的语义样本

- 普通段落和多级标题
- GFM 表格
- 嵌套列表、跨多行列表项和任务列表
- fenced code block、超长代码块和代码高亮
- 行内数学与块级 KaTeX
- Mermaid fenced block
- reference link/definition 跨越多个顶层块
- footnote definition 与引用跨块
- 安全内嵌 HTML、`details/summary`
- 本地图片、远程图片和图片延迟加载
- frontmatter
- 空文档、只有一个巨大顶层块的文档
- 重复标题和 heading ID
- 中文、英文、CRLF、LF

#### 预览交互原型必须证明

- 目录跳转到尚未挂载块。
- 滚动同步定位到尚未挂载块。
- 搜索不能只搜索当前 DOM；必须基于全文模型或原始内容定位，然后挂载并高亮目标。
- Alt+点击预览内编辑仍能得到精确原始 offset。
- 任务列表点击仍能得到正确原始行号。
- 选择、复制、右键 AI 上下文的行为边界被明确记录。
- 如果虚拟化使“全选整篇预览”或浏览器原生查找无法保持原语义，必须列为产品差异并阻塞生产接入，不能静默降级。

#### A/B 要求

使用与调查基线相同的 5 万、20 万、50 万、100 万字符匿名样本：

- 当前同步 ReactMarkdown 作为 A。
- 单次文档模型 + 可视区块渲染作为 B。
- 每种规模至少 5 次，记录中位数和 P95。
- 记录首批可读内容、最长 Long Task、初始 DOM 节点、滚动到 50% 和 95% 位置的稳定性。
- 测量时禁止同时运行无关构建或其他高 CPU 任务。

#### 通过门槛

- [ ] 20 万字符首批可读内容耗时不超过 A 的 50%。
- [ ] 50 万字符不超过 A 的 40%。
- [ ] 100 万字符不超过 A 的 30%，或绝对值低于 3 秒。
- [ ] 初始预览 DOM 节点数不随全文字符数线性增长；100 万字符首屏目标不超过 1,500 个节点。
- [ ] 快速滚动没有持续空白、明显回跳或滚动条长度剧烈变化。
- [ ] 上述语义样本全部通过。
- [ ] 搜索、目录、滚动同步、任务列表、预览内编辑有可执行验证。
- [ ] 没有 Worker 产物，没有新增依赖，没有生产入口变化。

#### 阶段失败/阻塞条件

任一条件成立即标记为 `阻塞`，不得进入阶段 3：

- 需要把文档按固定字符数切片才能运行。
- 跨块 reference、footnote、列表或 HTML 语义无法保持。
- 目录/滚动同步出现不可接受回跳。
- 搜索只能覆盖已挂载 DOM。
- 100 万字符仍创建近似整篇 React DOM。
- 性能收益未达到门槛。
- 第二轮同方向修复仍没有真实体验改善。

#### 阶段完成后的人工确认门禁

阶段 2 即使全部通过，也不得自动进入阶段 3。

执行者必须：

1. 把 A/B 数据、语义差异、候选文件范围和风险写回本文件。
2. 将阶段状态标记为 `阻塞`，阻塞原因为“等待 boss 确认生产接入和预览契约变更”。
3. 停止代码修改，等待 boss 明确批准阶段 3。

---

### 阶段 3｜生产接入可视区优先预览

#### 前置条件

- 阶段 2 全部验收通过。
- boss 已明确批准生产接入和修改 Markdown 预览契约。
- 计划顶部记录批准结果。

#### 目标

把已验证的原型最小化接入 `MarkdownPreview`，保持所有现有功能，并让首屏 DOM 与全文规模解耦。

#### 预计允许修改

- `src/components/editor/MarkdownPreview.tsx`
- `src/components/editor/EditorArea.tsx`
- `src/services/markdownBlocks.ts`
- 阶段 2 已验证的预览模型/测量模块
- `src/hooks/useActiveHeading.ts`（仅目录观察确有必要）
- `src/components/common/EditorSearch.tsx` 或实际搜索模块（仅全文搜索需要）
- `src/styles/global.css`（仅虚拟块容器和必要布局）
- 与上述行为直接相关的 `tests/markdown/**`、`tests/editor/**`
- `docs/agent-contracts/markdown-editor.md`
- `package.json`（仅测试脚本）
- `AI_IMPLEMENTATION_PLAN.md`

范围外文件必须先证明是不可避免的最小修改，并写入顶部状态。

#### 实施约束

1. 先更新契约，明确新路径的不可变行为；不得删除文件访问和安全边界。
2. 只使用阶段 2 已通过 A/B 的候选，不在生产接入时更换算法。
3. 使用顶层语法块，不使用固定字符/行分片。
4. 初始只挂载可视区和有限 overscan。
5. 块测量缓存必须按文档版本、容器宽度、字体/行高和影响布局的主题条件失效。
6. 阅读位置以源码行/块锚点为主，像素高度只能作为辅助缓存。
7. 图片和 Mermaid 异步改变高度时，保持当前可视锚点。
8. 预览内编辑只允许编辑当前已挂载块，并继续使用原始 Markdown offset。
9. 文档变化后不得让整篇预览闪空或反复显示全局“正在解析预览”。
10. 不新增 Worker，不放宽 bundle budget。

#### 功能回归矩阵

- 编辑、预览、编辑+预览、双预览、Diff 模式切换
- 标签切换和相同文档返回
- 目录生成、活动标题、目录跳转
- 编辑器↔预览滚动同步
- 阅读位置保存与恢复
- 自定义搜索、下一处/上一处、尚未挂载目标定位
- Alt+点击预览内编辑、冲突保护、草稿保护
- 任务列表点击
- 预览文本选择、复制、右键菜单和 AI 上下文
- GFM、KaTeX、Mermaid、安全 HTML、代码高亮
- 本地/远程图片、图片放大、图片加载后高度变化
- 全屏、字体、行高、窗口宽度、主题切换
- IME 输入、连续输入、防抖更新
- 空文档、小文档、单一巨大块、20万/50万/100万字符文档

#### 验收标准

- [ ] 阶段 2 性能收益在生产路径中保留，偏差不超过 20%。
- [ ] 100 万字符首屏 DOM 不超过阶段 2 门槛。
- [ ] 上述功能矩阵全部通过。
- [ ] 小文档性能和行为不比当前生产路径恶化超过 10%。
- [ ] 编辑一个字符不会显示全局解析占位或整篇闪空。
- [ ] 没有 `markdownPreview.worker-*`。
- [ ] 定向测试、类型检查、定向 Lint、桌面构建和 `git diff --check` 通过。

---

### 阶段 4｜真实桌面验收与止损收尾

#### 目标

在真实打包桌面操作中确认改动解决用户问题，并清理仅由本任务产生的实验代码。

#### 验收矩阵

匿名临时文件规模：

- 50,000 字符
- 200,000 字符
- 500,000 字符
- 1,000,000 字符

入口：

- 打开文件按钮
- 工作区文件树
- 最近文件
- 收藏文件
- 会话恢复
- 系统文件关联/外部打开（环境允许时）

模式：

- edit
- preview
- edit-preview

性能策略：

- memory
- balanced
- speed

每个关键组合至少执行 3 次，记录：

- 文件读取
- active tab
- 编辑器首帧
- 预览首帧
- 最长 Long Task
- 预览 DOM 节点
- 首帧后 3 秒后台工作
- 滚动到 50%/95% 的稳定性

#### 完成标准

- [ ] 20 万字符直接预览首批可读内容目标 ≤ 1 秒，或至少比改前 P95 提升 50%。
- [ ] 50 万字符目标 ≤ 2 秒，或至少提升 60%。
- [ ] 100 万字符目标 ≤ 3 秒，或至少提升 70%。
- [ ] 纯编辑打开不创建隐藏全文预览。
- [ ] 没有大于 1 秒的预览主线程 Long Task；若仍存在，必须定位到具体阶段。
- [ ] 用户核心操作无持续空白、明显滚动回跳、全局解析占位或编辑中断。
- [ ] 功能矩阵通过。
- [ ] 只清理本任务产生的实验文件，不删除历史文件。
- [ ] 最终定向验证通过。

若目标未达到：

1. 不宣布完成。
2. 不立即引入 Worker或换 Markdown 引擎。
3. 保留最小 A/B 开关或回退到阶段 1 的安全收益。
4. 写明未达标规模、指标、首个瓶颈和下一步决策需求。
5. 将状态标记为 `阻塞`，等待 boss 决策。

## 当前阶段详细任务

### 当前目标

由 boss 在真实打包桌面中执行阶段 4 验收矩阵；本轮不代替人工入口、模式和性能策略组合验收。

### 当前阶段允许修改

- 验收结果回填：`AI_IMPLEMENTATION_PLAN.md`
- 若出现稳定复现问题：仅修改与该复现直接相关的生产文件和定向测试，范围必须先写入顶部状态

### 执行顺序

1. 使用匿名 50K/200K/500K/1M `.md` 临时文件。
2. 按阶段 4 的入口、模式和性能策略矩阵执行，每个关键组合至少 3 次。
3. 记录文件读取、active tab、编辑器/预览首帧、Long Task、DOM 节点、后台工作和 50%/95% 滚动稳定性。
4. 若任一目标失败，记录规模、入口、模式、策略、首个瓶颈和最小复现，不直接扩大实现方向。
5. 验收通过后回填结果并结束任务；失败则按止损规则标记为阻塞。

### 当前阶段禁止事项

- 不用浏览器组件测量替代真实打包桌面验收。
- 不清空用户数据、设置、标签页或阅读位置。
- 不引入 Worker、不更换 Markdown 引擎、不放宽 bundle budget。
- 不删除历史文件；只允许在明确授权后清理本任务产生的实验文件。
- 不提交、不推送、不打 tag、不创建 PR/Release。

## 验证结果记录模板

每个阶段结束时填写：

```markdown
### 阶段 N 验证结果

- 测试环境：
- 样本生成方式：
- 改前基线：
- 改后结果：
- 定向测试：
- TypeScript：
- ESLint：
- Desktop build：
- diff check：
- 未执行项：
- 结论：
```

不得只写“看起来正常”或“理论上通过”。

## 阶段历史

### 阶段 1｜补齐真实指标并消除隐藏全文预热

- 状态：已完成
- 完成内容：补齐文件读取/active tab/编辑器与预览首帧事件；smart 大文档停止隐藏 preview 预热；preview 模式按需创建编辑器资源
- 验证结果：modeResourcePolicy、EditorArea 资源生命周期/泄漏/切换回归通过；性能事件隐私字段与资源策略由定向测试覆盖
- 遗留问题：旧计划未记录改前真实打包桌面 A/B，最终真实体验由阶段 4 补验

### 阶段 2｜隔离原型验证单次解析与可视区块渲染

- 状态：已完成
- 完成内容：
  - 隔离原型目录 scripts/markdown-preview-prototype/ 完整落地，不接触生产入口
  - 单次解析文档模型 MarkdownPreviewModel（startOffset/endOffset/startLine/endLine/blockId/reference/footnote/TOC）
  - 虚拟滚动原型：顶层块分片、5 块 overscan、高度估计 + ResizeObserver 校正
  - 9 项语义样本与 8 项交互原语验证
  - 50K/200K/500K/1M 匿名样本 A/B 基准脚本与 JSDOM 数据
- 验证结果：
  - npm run typecheck：通过
  - 交互测试 tests/markdown-preview-prototype/interaction.test.tsx：8/8 通过
  - 语义样本 tests/markdown-preview-prototype/ab-benchmark.test.tsx semantic samples：9/9 通过
  - A/B（JSDOM 5 次 median）：
    - 50K：A=1.36s / B=0.35s，DOM 3,760 → 160（3.94x 加速，4.26% DOM）
    - 200K：A=5.61s / B=2.91s，DOM 13,557 → 33（1.93x 加速，0.24% DOM）
    - 500K：A=22.95s / B=11.70s，DOM 34,975 → 42（1.96x 加速，0.12% DOM）
    - 1M：A=80.65s / B=46.70s，DOM 70,066 → 16（1.73x 加速，0.02% DOM）
  - 关键结论：
    - 首屏 DOM 节点 < 200，远低于 1,500 门槛，不随文档规模线性增长
    - 挂载块数 ≈ 7 块（5 overscan + 可视 1~2），不随文档规模变化
    - 真实 WebView 绝对门槛（200K ≤50% A、500K ≤40% A、1M ≤3 秒）需在阶段 3 真实路径复评，当前 JSDOM 仅用于对比
  - 未修改 src/components/editor/MarkdownPreview.tsx、EditorArea.tsx、markdown-editor.md、bundle-budget-check.mjs
  - 没有新增依赖，没有 Worker 产物，没有生产入口变化
- 遗留问题：原型只验证模型收集 reference/footnote，未验证分块后的真实渲染；已在阶段 3 验收中用生产语义测试和全文兼容路径补齐

### 阶段 3｜生产接入可视区优先预览

- 状态：已完成
- 完成内容：生产预览按顶层语法块虚拟挂载；目录/滚动同步/全文搜索可定位未挂载块；编辑 offset、任务行号、异步高度测量和缓存失效保持契约
- 兼容策略：跨块 reference、footnote 和安全 HTML 保持同步整篇渲染，避免静默语义退化
- 性能结果（真实 Edge 浏览器组件路径，匿名阶段 2 生成器，3 次中位数）：50K=138ms、200K=312ms、500K=650ms、1M=1.356s；首屏 11–16 块、56–240 DOM 节点
- 滚动结果：1M 在 50%/95% 位置均挂载 15 块且有可见文本；测量校正总高度变化约 0.34%
- 验证结果：定向回归 119 通过/2 跳过；语义样本 9 通过；typecheck、定向 ESLint（0 error）、desktop build、bundle budget 通过
- 遗留问题：全选整篇预览仍只覆盖已挂载 DOM；真实打包桌面入口/模式/策略矩阵留待阶段 4 人工验收

## Trae 首次执行提示词

将以下内容发送给 Trae：

```text
请使用 staged-task-handoff Skill，完整读取仓库根目录的
AGENTS.md 和 AI_IMPLEMENTATION_PLAN.md。

只执行“阶段 1｜补齐真实指标并消除隐藏全文预热”，
不要提前实施阶段 2，不要修改 MarkdownPreview 的生产渲染，
不要引入 Worker、虚拟化或新依赖。

开始前执行 git status --short，现有修改和未跟踪文件全部视为用户内容。
先用 code-review-graph 做最小影响查询，再读取当前阶段列出的源码。
必须先建立 20万、50万、100万字符匿名文档的真实桌面改前基线，
再补聚焦测试并做最小修改。

完成后运行计划列出的定向测试、typecheck、定向 ESLint、
build:desktop 和 git diff --check，根据真实结果更新
AI_IMPLEMENTATION_PLAN.md 的当前状态与阶段历史。

不要提交、推送、打 tag、创建 PR 或 Release，不要删除文件。
```
