# 观墨 Android 移植分阶段实施计划

> 本文件是 Android 移植任务的唯一状态来源。执行者必须使用 `staged-task-handoff` Skill，完整读取本文件后，只执行“当前阶段”，不得提前实施后续阶段。

## 当前状态

- 项目状态：进行中
- 当前阶段：阶段 1｜Android 最小启动闭环
- 阶段状态：阻塞
- 上次执行结果：
  - 已处理 `D:\Download\platform-36_r02.zip`：直接解压至 `D:\Android-SDK\platforms\android-36`，`android.jar` 可用；未安装其他项目依赖
  - 在 `android-poc` worktree 完成移动入口、Android 配置/capability、Cargo 条件依赖与最小平台 cfg；生成 `src-tauri/gen/android/**` 并调整 `.gitignore` 仅放行 Android 工程源文件
  - `npm run typecheck`、`npm run build:mobile`、Android `cargo check`、Android Rust `cargo build --lib` 均通过；移动 bundle 含 `android-poc@f2781ad` 标识且未发现桌面入口标记
  - `npm run build:desktop`、`npm run check:bundle:desktop`、离线 Rust desktop `cargo check`、`git diff --check` 均通过
  - 用户明确授权后已开启 Windows Developer Mode；官方构建已成功创建 `.so` 符号链接并越过原权限阻塞
  - 已补齐 Gradle Kotlin DSL 5.2.0、`gradle-kotlin-dsl-plugins:5.2.0` 和 Kotlin Gradle Plugin 2.0.21 核心缓存；AndroidX/Google Maven 依赖仍因 Java TLS 握手失败未完成缓存
  - `adb devices` 无可用真机/模拟器，尚未完成安装启动验收
- 验证结果：
  - Platform 36、NDK、adb 和 Rust Android targets：已满足；Rust Android 编译需设置 NDK clang、单并发和 `--sysroot=D:\RustToolchain`（Rust 安装路径含非 ASCII 字符）
  - 移动构建：`npm run build:mobile` 通过；移动产物为 28 个模块，入口约 145 kB，且未加载桌面 shell/文件树/更新逻辑标记
  - 桌面回归：`npm run typecheck`、`npm run build:desktop`、`npm run check:bundle:desktop`、`cargo check --offline --manifest-path src-tauri/Cargo.toml`、`git diff --check` 通过
  - Android debug build：符号链接阶段通过；随后 Google Maven AndroidX 依赖 TLS 握手失败，重试时 Rust 增量编译又遇页面文件不足，未生成 APK
  - 真机/模拟器启动：未执行，当前无 adb 设备或模拟器
- 本阶段剩余：解决 Java 到 Google Maven 的 TLS/依赖缓存问题并稳定 Rust Android 编译；生成 APK 后连接 Android 真机/启动模拟器并确认页面显示构建标识
- 本阶段允许修改：阶段1列出的 Android/移动入口最小范围；不得修改当前工作区用户文件
- 当前工作区：主工作区仍为 `main` / `f2781ad`，用户修改和未跟踪文件保持不动；POC worktree 为 `D:/React/guanmo-android-poc`
- 阻塞问题：SDK/NDK、adb 工具、Rust Android targets、Developer Mode 和 Gradle 核心插件缓存已具备；当前阻塞为 Google Maven TLS/AndroidX 依赖缓存、Rust 页面文件不足和缺少可用 adb 设备，阶段 1 暂停在 Android debug APK/启动验收前
- 下一阶段：阶段 2｜DocumentRef 与 Android SAF 文件闭环
- 远程操作：禁止提交、推送、打 tag 或创建 PR/Release
## 项目目标

在不破坏现有 Windows 桌面版和 Web 能力边界的前提下，在同一 Git 仓库中建立观墨 Android 版：

1. 桌面端继续使用现有 `App.tsx`、文件路径模型和完整桌面功能。
2. Android 使用独立应用入口和移动 UI，不把桌面三栏布局缩小后复用。
3. Markdown 解析模型、渲染能力、AI 传输协议、类型和必要业务规则尽量共享。
4. Windows 路径与 Android `content://` 文档 URI 使用不同平台实现，不伪装成同一种路径。
5. Android MVP 聚焦“打开即读、选中即问、随手可改”：单文档阅读、AI 辅助、段落编辑、保存、最近文档、收藏和阅读位置。
6. 手机与平板共享页面、组件和视觉语言，根据当前窗口宽度采用单栏或多栏组合。
7. 每个高风险能力先完成真机 POC；关键链路失败时及时停止，不以大规模重构桌面代码换取移动端可行性。

需求与证据优先级：实际代码和当前 Git diff > `AGENTS.md` 与强制契约 > 本文件当前状态 > `docs/android-migration-plan.md` > `docs/android-feasibility-report.md` > 历史会话建议。后两份文档只作背景，不再作为执行状态源。

## 技术路线

- 仓库：单仓库；POC 推荐独立 `android-poc` 分支和 worktree，正式代码验证后再决定合并方式。
- 壳与构建：Tauri 2 Android、Vite 独立 `mobile` mode、`src/App.mobile.tsx`。
- 前端：React、TypeScript、现有 Markdown 语法模型与主题令牌。
- 原生层：Rust 保留跨平台命令；Android SAF、Intent、Keystore 等能力按需使用 Kotlin Tauri mobile plugin。
- 数据：正式业务状态使用 SQLite；不得为 Android 恢复 IndexedDB 业务回退或形成长期 localStorage 双写。
- 网络：对话、模型和其他外部请求继续统一通过 `src/services/externalHttp.ts` 与受限 Rust 代理；禁止 WebView 原生 `fetch` 回退。
- 安全存储：Android API Key 必须由 Android Keystore 或经验证的等价安全实现保护；禁止沿用非 Windows 明文 secret 回退。
- 配置：保留 `src-tauri/tauri.conf.json` 作为公共/桌面基线，新增 `src-tauri/tauri.android.conf.json` 进行平台覆盖。
- 版本：桌面继续现有 `vX.Y.Z` 语义；Android 可使用 `android-vX.Y.Z`，不得追溯改写已有桌面 tag。

## 核心架构边界

### 文档身份模型

平台边界必须建立在文档引用而非路径字符串上：

```typescript
type DocumentRef =
  | {
      kind: 'desktop-path'
      canonicalPath: string
      identityKey: string
      displayName: string
    }
  | {
      kind: 'android-content-uri'
      uri: string
      identityKey: string
      displayName: string
      mimeType: string | null
      persistedPermission: 'read-write' | 'read-only' | 'none'
    }
```

不可变要求：

- `content://` URI 不是文件系统路径，不得传入 `PathBuf::canonicalize()`。
- 文件选择器返回 `DocumentRef`，不是裸字符串。
- 最近文档、收藏、阅读位置和会话恢复以 `identityKey` 关联，不以 Windows 路径比较规则处理 Android URI。
- 桌面文件权限继续受现有 `FsAccessState` 约束；Android 由 SAF 授权和持久 URI permission 约束。
- Android 权限失效必须进入可恢复状态，不能静默复制成新文件或扩大访问范围。

### 共享层分级

确认可优先共享：

- Markdown 纯解析/model：`markdownBlocks.ts`、`markdownPreviewModel.ts`、`markdownToc.ts`、`markdownMath.ts`。
- AI 协议与传输组件：`aiClient` 中与平台无关的请求构造、SSE 解析、错误类型。
- 运行时类型、schema、主题令牌、通用格式化工具。
- Rust HTTP 安全策略和可跨平台编译的数据库事务核心。

必须先验证再共享：

- `MarkdownPreview.tsx`、`CodeMirrorEditor.tsx`、`InlineMarkdownBlockEditor.tsx`。
- 图片、导出、路径 identity、会话恢复、最近文件和收藏逻辑。
- Zustand stores 中带标签页、工作区、窗口或路径语义的状态。
- SQLite 初始化、迁移、备份和恢复链。
- DOM 选区、目录活动标题、滚动恢复、虚拟预览高度测量。

移动端不直接复用：

- 桌面 App shell、TitleBar、Sidebar、FileTree、TabBar、Diff、窗口管理、拖放、桌面快捷键和性能监控 UI。
- 完整 `useAiChat` Agent/RAG/Memory 编排；MVP 使用独立精简 AI 流程。
- 桌面 `EditorContextMenu`、CommandPalette 和鼠标悬停交互。

### 移动布局

- Compact `< 600dp`：单栏阅读；目录、AI、编辑使用抽屉或 Bottom Sheet；一次只保留一个主要任务。
- Medium `600–839dp`：正文 + 可切换辅助栏；分屏后必须能退回 Compact。
- Expanded `>= 840dp`：目录/最近文档 + 正文，或正文 + AI 双栏；三栏不是 MVP 门槛。
- 使用 CSS media/container query 或 `ResizeObserver` 监听实际窗口，不使用设备型号或固定 `isTablet`。
- 页面和核心组件共享，布局负责组合；不得维护完全独立的 PhoneApp/TabletApp 业务副本。

## 执行前必读

每个阶段开始前必须重新读取：

1. `AGENTS.md`
2. `AI_IMPLEMENTATION_PLAN.md`
3. 当前阶段列出的实际源码和配置
4. 当前阶段对应的 `docs/agent-contracts/*.md`

按范围追加：

- UI 或布局：`docs/agent-contracts/ui.md`
- Web/构建：`docs/web-deploy.md`
- 文件/SAF/Intent：`docs/agent-contracts/file-access.md`
- Markdown：`docs/agent-contracts/markdown-editor.md`
- AI/选区：`docs/agent-contracts/ai-selection.md`
- 外部请求/Origin：`docs/agent-contracts/external-http.md`
- SQLite/迁移：`docs/agent-contracts/database.md`
- RAG/Memory：`docs/agent-contracts/rag-memory.md`
- 壳命令/性能：`docs/agent-contracts/desktop-services.md`
- 交付或上下文切换：`guides/delivery.md`；若仓库中不存在，记录缺失并继续遵守 `AGENTS.md`
- 配置、数据和版本升级：`guides/compatibility.md`；若不存在，记录缺失，不得编造规则

附加规则：

- 架构、Rust command、SQLite、Agent/RAG、生命周期修改必须先使用 `code-review-graph` 做最小影响查询；图过期或无结果后再精确搜索源码。
- 开始修改前执行 `git status --short`；现有修改和未跟踪文件全部视为用户内容。
- 测试只使用匿名生成文档、临时目录、临时数据库和测试 API 配置，不读取真实用户数据。
- 真机行为优先于 JSDOM、类型检查和构建结果；每次真机判断前确认 Android app、Tauri dev、worktree 和 HEAD 均为本次代码。

## 总体禁止事项

- 不自动提交、推送、打 tag、创建 PR 或 Release。
- 不提前实施下一阶段，不为了未来完整性新增当前阶段不需要的抽象。
- 不移动现有桌面组件到新的 `components/desktop/`；POC 期间保留桌面目录，移动端只新增隔离入口和目录。
- 不把 `content://` 当普通路径，不绕过文件授权，不回退到前端直连文件系统。
- 不使用 WebView 原生 `fetch`、Tauri HTTP 插件或浏览器回退请求外部 API。
- 不把真实 API Key 明文写入文件、localStorage、日志或测试 Fixture。
- 不用 localStorage 作为正式最近文档、收藏、阅读位置或聊天主存储。
- 不恢复 IndexedDB 业务回退，不清空、重建或自动迁移真实用户数据。
- 不恢复旧 Markdown Worker/占位解析路径，不为移动端静默破坏 reference、footnote 或安全 HTML 语义。
- 不放宽桌面/Web bundle budget，不以 Android 为由删除 Windows 能力。
- 未经批准不得删除 worktree、分支、生成目录或其他文件。

## 阶段计划

### 阶段 0｜环境、基线与隔离准备

- 目标：只读确认开发环境、工作区和桌面基线；形成安全的 POC 隔离方案，不修改产品代码。
- 允许修改：`AI_IMPLEMENTATION_PLAN.md`；经明确执行授权后允许创建 `android-poc` branch/worktree 元数据。
- 核心任务：
  1. 记录当前 branch、HEAD、`git status --short` 和现有用户文件。
  2. 核实 Node、npm、Rust、Cargo、JDK、Android SDK/NDK、adb、Gradle/Tauri CLI 实际版本。
  3. 以当前锁文件和 Tauri CLI 为准确定 Android 模板要求，不在计划中硬编码过期 API/NDK 版本。
  4. 执行当前桌面最小基线：typecheck、desktop build、Rust check；只处理本阶段新发现且阻断 Android 基线的任务内问题。
  5. 确定 POC 基准 commit 和 worktree 绝对路径；创建前验证目标目录不存在且不覆盖任何文件。
  6. 若创建 worktree，确保本计划在目标 worktree 中仍是唯一状态源；未经提交授权不创建提交。
- 验收标准：工具链状态明确；桌面基线有真实退出码；worktree 策略不丢失当前用户改动；没有产品代码修改。
- 检查命令：见“当前阶段详细任务”。
- 暂不处理：Android init、Cargo 条件依赖、移动入口、任何 UI/SAF/AI 代码。

### 阶段 1｜Android 最小启动闭环

- 目标：Android 工程在模拟器或真机启动最小 React 页面，同时 Windows 桌面构建保持原行为。
- 预计允许修改：
  - `package.json`
  - `vite.config.ts`
  - `src/App.mobile.tsx`
  - 最小移动入口样式
  - `src-tauri/Cargo.toml`
  - `src-tauri/src/lib.rs` 及必要的最小平台 cfg
  - `src-tauri/tauri.android.conf.json`
  - `src-tauri/gen/android/**` 中 Tauri 正常生成且应纳入版本管理的文件
  - Android/mobile capability 文件
  - `.gitignore`（仅生成产物边界）
- 核心任务：
  1. 先验证 `windows-sys`、`sysinfo`、single-instance、perf monitor 和 drag/drop 的真实 Android 编译影响，再做最小条件依赖/cfg。
  2. `windows-sys` 使用明确 Windows target 条件；不得假设 Cargo dependency table 支持自定义 `cfg(desktop)`。
  3. 使用 `tauri android init`，记录生成文件，不手工重建 Gradle 模板。
  4. 增加 Vite `mobile` entry；移动产物不得加载桌面 shell、性能面板、文件树和桌面更新逻辑。
  5. 使用 `tauri.android.conf.json` 覆盖 Android build command、版本、图标和平台权限；不向桌面 `bundle.targets` 添加 `android`。
  6. 真机/模拟器显示带构建标识的最小页面，确认运行的 worktree 和 HEAD。
- 验收标准：Android debug app 构建并启动；移动 bundle 不含桌面入口；`build:desktop`、Rust desktop check 和 bundle budget 通过。
- 检查命令：`npm run typecheck`、阶段新增文件的定向 ESLint、`npm run build:desktop`、`npm run check:bundle:desktop`、`cargo check --manifest-path src-tauri/Cargo.toml`、`npm exec tauri -- android build --debug`、`git diff --check`；真机/模拟器启动另作人工验收。
- 停止条件：需要大规模改写桌面 `lib.rs` 或禁用现有安全边界才能启动。
- 暂不处理：文件选择、Markdown、SQLite、AI、正式移动 UI。

### 阶段 2｜DocumentRef 与 Android SAF 文件闭环

- 目标：在真机上完成选择 `.md` → 读取 → 修改 → 写回 → 杀进程/重启后继续访问的最小闭环。
- 必读：file-access、compatibility。
- 预计允许修改：
  - `src/services/platform/documentRef.ts`
  - `src/services/platform/documentService.ts`
  - `src/services/platform/desktopDocumentService.ts`
  - `src/services/platform/androidDocumentService.ts`
  - `src/hooks/useTauri.ts` 的必要适配，保留现有桌面 API
  - 独立 Rust Android 平台模块
  - 必要 Kotlin Tauri mobile plugin、Manifest 和 mobile capability
  - 最小移动文件 POC 页面
  - 定向测试
- 实施顺序：
  1. 先建立 `DocumentRef`、能力和错误类型；桌面旧路径调用保持兼容。
  2. 验证官方 dialog 返回值、MIME 过滤和运行时 scope；Android 过滤以 MIME 为主并在应用层再次校验 `.md`。
  3. 验证官方 fs 对 `content://` 的读写；不得把 URI 传给现有 Rust `std::fs`/`PathBuf` 命令。
  4. 若官方插件无法满足持久权限或稳定写回，使用最小 Kotlin SAF plugin：`ACTION_OPEN_DOCUMENT`、`ContentResolver`、`takePersistableUriPermission`。
  5. 使用系统 persisted URI permission 列表验证进程重启后的访问，不先建立正式最近文件存储。
  6. 覆盖只读 provider、权限撤销、文件删除、非 `.md`、空文件、UTF-8 错误、写入失败；写入失败时保留内存 draft。
- 验收标准：至少本地 DocumentsProvider 和一个常见第三方/云 provider 完成真机读写；其他应用能看到写回内容；进程杀死后权限仍有效；权限失效可恢复；桌面文件专项回归通过。
- 检查命令：新增 DocumentRef/文件服务的定向测试、`npm run test:file-access`、`npm run typecheck`、修改文件的定向 ESLint、`npm run build:desktop`、`npm run build:mobile`、Android debug build、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check`；SAF provider 矩阵必须真机人工执行。
- 进入下一阶段门禁：选择、读取、写回和持久权限全部通过。若官方插件失败，允许一次受控 Kotlin fallback；fallback 也失败才评估停止。
- 暂不处理：最近文档 UI、正式 SQLite、文件夹/工作区、分享 Intent。

### 阶段 3｜移动 Markdown 阅读与选区 POC

- 目标：基于已授权 `DocumentRef` 在 Android WebView 中提供稳定阅读、目录、选区和阅读位置锚点。
- 必读：markdown-editor、ai-selection、file-access、ui。
- 预计允许修改：
  - `src/mobile/reader/**`
  - 必要的共享 Markdown model/renderer 参数化
  - 移动主题和阅读样式
  - `DocumentRef` 图片解析适配
  - 定向 Markdown/移动阅读测试与匿名性能 Fixture
- 核心任务：
  1. 复用 `createMarkdownPreviewModel` 和同步 `ReactMarkdown` 语义，不直接复用桌面容器/鼠标交互。
  2. 验证 GFM、KaTeX、Mermaid、代码高亮、表格、任务列表、reference、footnote、安全 HTML和本地/远程图片。
  3. 目录、搜索和阅读位置继续基于 source offset/model API，不能只依赖已挂载 DOM。
  4. 建立 Android 长按选区到文档 source offset/文本上下文的明确边界。
  5. Compact reader 先完成；Medium/Expanded 只搭最小布局骨架，不实现完整平板产品 UI。
  6. 用固定匿名字符数 Fixture 和指定中档真机/WebView 版本记录可读时间、可交互时间、最长帧/Long Task、峰值内存、首屏块数和 50%/95% 滚动稳定性。
- 初始性能门槛：
  - 50K/200K/500K/1M 字符至少各 3 次，记录中位数和最差值；不用“字数”混淆字符数。
  - 200K 首批可读目标不高于 2 秒；500K 不高于 3 秒；超过目标标记警告并定位瓶颈，不自动宣告失败。
  - 首屏挂载块数和 DOM 不随全文规模线性增长；滚动到 50%/95% 无持续空白或明显回跳。
  - Mermaid 单独记录，不把大量图表耗时归入普通 Markdown 门槛。
- 验收标准：核心语义、目录、图片、选区、阅读位置和滚动通过真机验证；桌面 Markdown 定向回归和 desktop build 通过。
- 检查命令：移动 reader/model 定向测试、相关现有 Markdown 语义测试、`npm run test:markdown-math`、`npm run typecheck`、修改文件的定向 ESLint、`npm run build:desktop`、`npm run build:mobile`、Android debug build、`git diff --check`；性能数据和触摸选区只以指定真机结果验收。
- 暂不处理：全文编辑、AI、最近文档、正式收藏和分享。

### 阶段 4｜移动编辑与安全写回 POC

- 目标：验证段落编辑、全文编辑候选和保存冲突行为；MVP 默认采用段落轻量编辑。
- 必读：markdown-editor、file-access、ui。
- 预计允许修改：
  - `src/mobile/editor/**`
  - 必要的共享 offset/draft API
  - Android document write service
  - 定向编辑与保存测试
- 核心任务：
  1. 先实现标准 textarea 的段落编辑，原始 offset 精确替换；切片失效时保留 draft 并提示冲突。
  2. 独立验证 CodeMirror 6：中文 IME、候选词、长按选区、手柄、撤销/重做、软键盘、旋转、返回键、大文档输入。
  3. 全文 CodeMirror 仅在真机体验达标后纳入 MVP；否则使用简单源码 textarea 或推迟全文编辑。
  4. 保存前检测当前文档身份和可用元数据；无法可靠判断外部变化时明确提示风险，不静默覆盖。
  5. 写入失败、权限撤销或前后台切换时保留 draft；不得自动复制到应用私有目录后假装已保存原文件。
- 验收标准：段落编辑和保存闭环稳定；中文 IME 可用；失败保留 draft；其他应用能读取新内容；桌面预览内编辑不回归。
- 检查命令：移动编辑/offset/draft 定向测试、相关桌面预览内编辑测试、`npm run test:editor-input-performance`、`npm run typecheck`、修改文件的定向 ESLint、`npm run build:desktop`、`npm run build:mobile`、Android debug build、`git diff --check`；IME、选区手柄和软键盘必须真机人工验收。
- 降级条件：IME 重复输入、选区不可用、键盘不可修复遮挡或 50K 字符输入延迟持续超过 500ms 时，CodeMirror 不进入 MVP。
- 暂不处理：复杂 Markdown 工具栏、自动保存、协同冲突、完整编辑器功能对齐。

### 阶段 5｜安全存储与精简 AI POC

- 目标：在不启用 RAG/Agent/Memory 的前提下，完成安全 Key、受限 HTTP、流式回答、取消和前后台恢复。
- 必读：external-http、ai-selection、database；若触碰 RAG/Memory 立即停止并重新定界。
- 预计允许修改：
  - Android secret service/Kotlin Keystore plugin
  - `src/mobile/ai/**`
  - 可复用的基础 AI request/message helper
  - `externalHttp.ts` 或 Rust proxy 的最小跨平台修复
  - Android Origin 授权 UI
  - 定向 AI HTTP/selection 测试
- 核心任务：
  1. 先修正 Android secret boundary；真实 Key 不得经过明文文件或 localStorage。
  2. 新建精简移动 AI flow，不直接复用完整 `useAiChat`。
  3. 只支持普通兼容聊天、选中解释、选中翻译、文档/章节总结和连续追问。
  4. 保持 Rust 代理的 URL、Origin、DNS/IP、header、redirect 和资源限额校验；禁止 fetch/EventSource 直连回退。
  5. 验证 SSE/Channel、取消、超时、网络切换、前后台、屏幕旋转和重复提交。
  6. 使用测试账户/测试 Key 和匿名文档；日志不得包含 Key、正文、选区或完整响应。
- 验收标准：Key 重启后可用且落盘不可读明文；普通与流式请求、取消和错误提示通过；选区授权只限本轮；`test:ai-http` 和相关定向测试通过。
- 检查命令：移动 AI/secret 定向测试、`npm run test:ai-http`、`npm run test:selection-context`、`npm run typecheck`、修改文件的定向 ESLint、`npm run build:desktop`、`npm run build:mobile`、Android debug build、Rust 定向测试或 check、`git diff --check`；网络切换、前后台、Keystore 落盘检查必须真机执行。
- 停止条件：只有放宽现有 HTTP 安全策略或 WebView 直连才能请求；安全存储无法落地。
- 暂不处理：Agent 工具、RAG、知识库、长期记忆、联网搜索、自动路由、后台请求。

### 阶段 6｜SQLite 文档状态与自适应 Android MVP

- 目标：把已验证能力组合成可持续使用的手机/平板 MVP，并使用 SQLite 保存业务状态。
- 必读：database、compatibility、file-access、ui、web-deploy。
- 预计允许修改：
  - `src/mobile/app/**`、`src/mobile/layouts/**`、`src/mobile/pages/**`
  - Android 文档 repository/store
  - SQLite schema、迁移和 Rust transaction 的必要最小扩展
  - 移动主题、safe-area、返回键和导航
  - 移动定向集成测试
- MVP 页面：最近文档、收藏、阅读、目录、AI Bottom Sheet、段落编辑、简化设置。
- 核心任务：
  1. 为 Android 文档状态定义兼容 schema：`identity_key`、URI、显示名、MIME、permission state、last opened、favorite、reading offset；不得破坏桌面现有行。
  2. 所有多表/多步骤写入由 Rust 持有同一 SQLx transaction；不在前端拼接事务。
  3. 迁移只作用于测试数据库直到升级/回退验证通过；不自动读取真实旧数据。
  4. 实现 Compact/Medium/Expanded layout；窗口变窄时状态和 draft 不丢失。
  5. 最近/收藏点开前检查权限；失效进入重新选择同一文档恢复流程。
  6. Android 返回键顺序：关闭 sheet/抽屉 → 退出编辑并处理 draft → 返回列表 → 系统退出。
  7. 集成完整路径：打开 → 阅读 → 选中问 AI → 段落编辑 → 保存 → 杀进程 → 恢复最近和阅读位置。
- 验收标准：手机单栏与平板双栏真机可用；SQLite 升级/回退安全；无 localStorage 主存储；完整路径稳定；desktop/Web 构建和数据库定向回归通过。
- 检查命令：新增移动 repository/layout/integration 定向测试、`npm run test:runtime-schemas`、`npm run test:file-access`、受影响数据库专项测试、`npm run typecheck`、修改文件的定向 ESLint、`npm run build`、`npm run build:desktop`、`npm run build:mobile`、Android debug build、Rust 定向测试、`git diff --check`；手机/分屏/平板完整路径必须人工验收。
- 暂不处理：工作区、目录授权、文件树、多标签、Diff、RAG、云同步、后台索引、iOS、三栏高级布局。

### 阶段 7｜硬化、发布准备与交付门禁

- 目标：完成发布级风险验证和文档，但不自动执行任何远程发布动作。
- 必读：push-safety、release-process、delivery、全部受影响契约。
- 测试矩阵：
  - Android 版本和 targetSdk/minSdk 以执行时 Tauri/Play 要求为准，不使用计划中的静态猜测。
  - 至少低/中/高三档设备；主要 WebView 版本；手机、折叠屏/分屏、平板。
  - 本地 DocumentsProvider、常见第三方/云 provider、只读/删除/移动/撤权。
  - 主流中文输入法、横竖屏、前后台、进程回收、网络中断、低内存。
  - 50K/200K/500K/1M 字符文档、复杂 Mermaid/KaTeX/表格/图片。
  - SQLite 首装、升级、失败回滚；Key 安全存储；日志隐私。
  - Windows 受影响模块定向回归，Web 基础阅读与 bundle 边界。
- 构建：使用 Tauri Android 官方命令生成 APK/AAB；`--target` 仅用于 CPU 架构，不写虚构的 `--target aab`。
- CI：Android 专属变更运行 Android gate；任何 shared/Rust/config 变更必须同时运行桌面定向 gate，不能通过“CI 互不触发”跳过桌面验证。
- 发布策略：桌面 tag 保持 `vX.Y.Z`；Android 使用 `android-vX.Y.Z`；版本源和 changelog 分离但由明确脚本校验一致性。
- 远程门禁：收到发布指令后只运行 `node scripts/pre-push-check.mjs --release`，展示结果并等待第二次明确确认；本阶段计划本身不授权 push/tag/Release。
- 检查命令：根据最终影响范围运行 `npm run check:release`、Android APK/AAB release build、签名/安装/升级验证、`git diff --check`；仅在收到明确发布指令后运行 `node scripts/pre-push-check.mjs --release`，通过后仍不得自动远程操作。
- 完成标准：所有阻断项关闭；发布构建可重复；升级/回退与隐私通过；用户完成关键真机体验验收；交付文档和阶段历史完整。

## 全局停止条件

满足任一条件时停止当前方向、保留证据并请求决策：

1. 官方插件和一次受控 Kotlin SAF fallback 都无法稳定读写并持久授权外部文档。
2. Android 只能通过绕过 `FsAccessState`/SAF、放宽 HTTP 安全代理或明文存储 Key 才能工作。
3. Markdown 核心语义在 Android WebView 中无法保持，且修复要求替换现有共享渲染链。
4. 移动入口仍不可避免地打包并启动大量桌面组件，最小隔离方案失败。
5. Android 改造要求破坏桌面 SQLite 事务、文件授权或已有数据兼容。
6. 同一根因方向连续两次真机修复无收益；转为最小 A/B、二分或功能开关，不继续叠加补丁。

不构成整体停止的情况：

- CodeMirror 不适合作为移动全文编辑器：降级为段落编辑/简单源码编辑。
- Mermaid 个别大图较慢：延迟渲染、手动展开或后续优化。
- RAG/后台索引不可行：继续保持 MVP 禁用。
- 三栏平板布局不成熟：保留单栏/双栏。
- 单个第三方 provider 行为异常：记录兼容矩阵，不掩盖本地 provider 的真实结果。

## 当前阶段详细任务

### 当前目标

完成 Android 最小启动闭环：使用独立移动入口启动最小 React 页面，并保持 Windows 桌面构建与原有能力边界不变。

### 当前阶段允许修改

- `package.json`
- `vite.config.ts`
- `src/App.mobile.tsx`
- 最小移动入口样式
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs` 及必要的最小平台 cfg
- `src-tauri/tauri.android.conf.json`
- `src-tauri/gen/android/**` 中 Tauri 正常生成且应纳入版本管理的文件
- Android/mobile capability 文件
- `.gitignore`（仅生成产物边界）

### 实施任务

1. Android 工具链恢复后，先验证 `windows-sys`、`sysinfo`、single-instance、性能监测和拖放相关代码的真实 Android 编译影响。
2. 使用明确 Windows target 条件处理 `windows-sys`，不假设 Cargo dependency table 支持自定义 `cfg(desktop)`。
3. 使用 `tauri android init` 生成 Android 工程，记录生成文件，不手工重建 Gradle 模板。
4. 增加 Vite `mobile` entry；移动产物不得加载桌面 shell、性能面板、文件树和桌面更新逻辑。
5. 使用 `tauri.android.conf.json` 覆盖 Android build command、版本、图标和平台权限，不向桌面 `bundle.targets` 添加 Android。
6. 在模拟器或真机显示带构建标识的最小页面，并确认运行的 worktree 和 HEAD。

### 验收标准

- [ ] Android debug app 构建并启动。
- [ ] 移动 bundle 不含桌面入口、文件树和桌面性能 UI。
- [ ] `npm run build:desktop`、Rust desktop check 和 bundle budget 通过。
- [ ] 没有破坏当前工作区用户文件或桌面/Web 能力边界。

### 检查命令

```powershell
npm run typecheck
npm run build:desktop
cargo check --manifest-path src-tauri/Cargo.toml
npm exec --no -- tauri android build --debug
git diff --check
```

真机/模拟器启动另作人工验收。

### 当前阶段禁止事项

- Android 工具链未准备好前，不执行 `tauri android init/dev/build`。
- 不安装 SDK、NDK、JDK、Rust target 或 npm/Cargo 依赖。
- 不修改无关文件，不提前处理文件选择、Markdown、SQLite 或 AI。
- 不创建提交、不推送、不合并、不打 tag。
- 不移动、复制或删除现有用户文件。
- 不恢复 IndexedDB 或使用明文 secret 回退。
## 阶段验证记录模板

```markdown
### 阶段 N 验证结果

- 执行环境：
- branch / HEAD / worktree：
- 修改范围：
- 自动检查：
- 真机/模拟器：
- 人工验收：
- 未执行项：
- 阻塞项：
- 结论：
```

## 阶段历史

### 阶段 0｜环境、基线与隔离准备

- 状态：已完成
- 完成内容：记录主工作区 branch/HEAD/用户文件；核实 Node、npm、Rust、Cargo、JDK、Tauri CLI、Android 环境和 Rust targets；创建 `android-poc` 分支及 `D:/React/guanmo-android-poc` worktree，并同步本计划。
- 验证结果：`npm run typecheck`、`npm run build:desktop`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check` 通过。
- 遗留问题：Android SDK/NDK、adb 和 Rust Android targets 缺失，阶段1 Android init/build 待工具链准备后执行；未修改产品代码，未提交或远程操作。

### 阶段 1｜Android 最小启动闭环（本次执行）

- 状态：阻塞
- 完成内容：完成移动最小入口、Android 工程配置和平台 cfg；补齐 Platform 36；用户授权后开启 Developer Mode；补齐 Gradle Kotlin DSL/Kotlin Gradle Plugin 核心缓存。
- 验证结果：官方构建已成功创建 Rust `.so` 符号链接；移动/桌面/Android Rust 检查通过；AndroidX/Google Maven 依赖 TLS 握手和 Rust 页面文件问题仍阻塞 APK。
- 遗留问题：未生成 APK，未连接手机或执行真机启动验收；未提交、推送或删除文件。
## 新会话继续提示词

```text
请使用 staged-task-handoff Skill，完整读取 AGENTS.md 和
AI_IMPLEMENTATION_PLAN.md，根据顶部“当前状态”只执行当前阶段。

开始前执行 git status --short，所有现有修改和未跟踪文件都视为用户内容。
不要重复已完成工作，不提前实施后续阶段；完成后运行当前阶段列出的检查，
按真实结果更新当前状态和阶段历史。

不要提交、推送、打 tag、创建 PR 或 Release，不要删除文件。
```
