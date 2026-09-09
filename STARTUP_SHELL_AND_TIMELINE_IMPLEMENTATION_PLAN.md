# GuanMo Startup Shell 与启动时间线任务计划

## 当前状态

- 项目状态：已完成（阶段 2 为最后阶段，未实施第三阶段优化）
- 当前阶段：阶段 2｜启动性能埋点与测量报告
- 阶段状态：已完成
- 上次执行结果（阶段 2）：
  - `startupPerformance.ts` 扩展启动链点位并统一 `guanmo:startup:` 前缀；DEV 一次性时间线报告（链路摘要 + 按序表格 + 语义 + missing 标注），生产构建可裁剪
  - `index.html` 增加 `html-start`/`startup-shell-dom-ready`/`html-parsed`/`main-module-requested` 同步 mark；`src/main.tsx` 幂等记录模块/`createRoot`/render/mount/Shell 移除点位
  - `AppLayout.tsx` 既有 RAF callback 内记录 `first-animation-frame`；`App.tsx` `restoreTabs()` 各路径旁路记录匿名 outcome（外部打开/无活动标签/正常/失败），不改变恢复语义
  - `scripts/measure-cold-start.mjs`：白名单与汇总增量更新；修复 seed 竞态（旧文档 beforeunload 延迟持久化 flush 会覆写直写的测量态，改用 CDP `Page.addScriptToEvaluateOnNewDocument` 在新文档应用脚本前重写 seed）；两个 surface 必需 marker 补齐 `active-document-first-visible`
  - 隔离 Release 完成 Edit/Preview 各 3 次完整进程冷启动采样，必需点位无缺失（见“阶段 2 测量结果”）
- 验证结果：
  - `npm run test:session-restore`：通过
  - `npm run test:app-warmup`：通过
  - `npm run typecheck`：通过
  - 范围内文件定向 ESLint（含 measure 脚本）：通过，0 error
  - `npm run build` / `npm run build:desktop`：通过，Web/Desktop Bundle 门禁通过
  - `npm run test:cold-start`（edit/preview 各 3 次，隔离 Release EXE）：通过，6/6 样本必需点位齐全
  - `git diff --check`（范围内文件）：通过
- 本阶段剩余：无
- 本阶段允许修改：`index.html`、`src/main.tsx`、`src/App.tsx`、`src/components/layout/AppLayout.tsx`、`src/services/startupPerformance.ts`、`scripts/measure-cold-start.mjs`、`package.json`（仅 `test:cold-start` 一项）、本任务文件
- 阻塞问题：无（遗留临时脚本待用户决定是否删除：`scripts/_tmp_startup_shell_capture.ps1`、`scripts/_tmp_probe_webview2_targets.cjs`，均标注用后删除）
- 下一阶段：无（项目结束）
- 远程操作：禁止提交、推送、打 tag 或发布

## 项目目标

用两个严格分离的阶段改善 GuanMo 冷启动体验并建立可信测量：先用不依赖 React 的静态 HTML 骨架消除 `#f8f4e8` 纯色空屏，再在不改变业务启动顺序的前提下补齐启动时间线，完成真实测量、定位主要瓶颈后停止，不继续实施第三阶段优化。

## 已核实的项目现状

- `index.html` 当前只有固定浅色背景、空的 `#root` 和一个 `frontend-bootstrap` mark；React 执行前没有可见结构。
- `src/main.tsx` 由 Vite 的 `@app-entry` 在 Desktop/Web 间选择 `App.tsx` 或 `WebApp.tsx`，因此 Shell 接管必须在共享入口处理，不能只在 Desktop `AppLayout` 中移除。
- `AppLayout` 的真实桌面骨架为 38px 标题栏、默认折叠的 56px 侧栏轨道、主内容区和底部状态栏；默认侧栏展开宽度为 260px，但 `sidebarCollapsed` 启动默认值为 `true`。
- 项目已有 `startupPerformance.ts`、`performance.mark('guanmo:startup:*')`、`eventMarker` 和冷启动测量脚本，不得另起一套不兼容的计时系统。
- 已有标记覆盖 `frontend-bootstrap`、首次 React render、AppShell 首次可见/可交互、数据库、活动标签磁盘读取、真实文档首次可见和 `app-ready`；当前工作区还存在用户新增的 Editor/Preview 首次可见标记，必须保留并增量兼容。
- `restoreTabs()` 只等待活动标签恢复；其余标签在后台继续恢复。因此“启动恢复完成”只能定义为启动关键路径上的活动会话/活动文档恢复完成，不能误报为全部后台标签已完成。
- `appReady` 当前表示数据库与启动关键路径恢复完成，历史隔离 Release 中约为 630ms；它不是首屏可见指标。Shell 可见、React Shell、真实文档和后台就绪必须分别报告。
- 当前工作区非干净状态，`AI_IMPLEMENTATION_PLAN.md`、`package.json`、`src/services/startupPerformance.ts`、`EditorArea.tsx` 等已有用户修改；本任务不得覆盖、回滚、格式化或夹带这些修改。
- 既有 `COLD_START_MVP_IMPLEMENTATION_PLAN.md` 已结束且记录了另一项回滚实验；本任务使用独立文件，不修改或重启旧任务。

## 技术栈

- 运行环境：Tauri 2、WebView2、Vite 6
- 前端：React 18、TypeScript、Zustand、Tailwind CSS
- 性能基础：Performance API、现有 `startupPerformance.ts`、现有隔离冷启动测量脚本
- 构建入口：`npm run build`（Web）与 `npm run build:desktop`（Desktop）
- 主要验证：TypeScript、ESLint、Web/Desktop 构建与 Bundle 门禁、真实 Tauri 冷启动、隔离 Release 三次采样

## 成功标准

- 冷启动时先看到与真实界面布局接近的静态骨架，不再持续显示整块 `#f8f4e8` 纯色空屏。
- Shell 不依赖 React、业务模块、外部资源或新增依赖；React 未成功启动时 Shell 不会被定时移除。
- React 第一次真实 DOM commit 后同步接管，Shell 与真实界面不重叠、不闪回、无明显尺寸跳变。
- 开发环境输出一次清晰的启动时间线，包含绝对耗时、相邻阶段耗时和语义说明；生产版不输出详细日志。
- 现有 Release 测量仍可读取轻量 mark，且不新增仅为监测服务的生产 Timer、Observer、事件监听或额外 RAF。
- 阶段 2 完成后交付实际测量表与主要瓶颈，只提出后续候选方向，不实施任何第三阶段性能优化。

## 总体约束

- 每次只执行当前阶段；阶段 1 完成并更新本文件后，才允许开始阶段 2。
- 只做最小修改，不重构 App、AppLayout、Session Restore、数据库、Editor、Preview 或构建分包。
- 不通过动态 import、`manualChunks`、延迟真实内容、空 fallback 或 Skeleton 改写测量结果。
- Startup Shell 只改善空屏感知，不得作为“真实 AppShell 已可交互”或“真实文档已可读”的性能收益。
- 保留既有 Boot Snapshot、活动文档优先恢复、`app-shell-interactive` passive effect、数据库后置和 `appReady` 语义。
- 首次 RAF 只记录“RAF callback 到达”；不得替代既有 `app-shell-interactive`，WebView2 窗口动画下 RAF 不是可靠的交互就绪定义。
- 埋点 metadata 只能包含状态、数量、模式等匿名信息；禁止记录完整路径、文档内容、用户名、凭据或会话内容。
- Web 与 Desktop 共用 `index.html`/`main.tsx`；Web 基础阅读能力和两种构建边界必须保持不变。
- 不新增依赖，不修改持久化格式、数据库 schema、文件授权、CSP、Tauri 配置、Rust 代码或体积阈值。
- 不读取真实用户数据库；Release 测量只使用匿名文档、隔离 identifier/应用数据目录和当前源码构建的 EXE。
- 不提交、不推送、不打 tag、不构建安装包、不创建 Release。

## 阶段计划

### 阶段 1｜HTML Startup Shell

- 目标：让 HTML 解析后立即显示与 GuanMo 默认主界面接近的静态骨架，并在共享 React 根组件首次 commit 后无感移除。
- 风险：MEDIUM。修改 Web/Desktop 共享入口和首屏视觉，但不触碰业务状态、文件、数据库或恢复逻辑。
- 允许范围：`index.html`、`src/main.tsx`、本任务文件。
- 验收重点：静态可见、接管时机正确、Web/Desktop 构建兼容、真实 Tauri 视觉无纯色长空屏。
- 暂不处理：新增启动时间点、详细日志、测量脚本和任何性能结论。

### 阶段 2｜启动性能埋点与测量报告

- 目标：在现有启动标记基础上补齐 HTML、模块、React mount、首个 RAF 和启动恢复边界，输出开发时间线，并用隔离 Release 三次采样定位主要瓶颈。
- 风险：HIGH。需要触达 `restoreTabs()` 启动恢复路径；只允许增加旁路标记，不改变恢复分支、错误处理、并发与数据合并语义。
- 允许范围：`index.html`、`src/main.tsx`、`src/App.tsx`、`src/components/layout/AppLayout.tsx`、`src/services/startupPerformance.ts`、`scripts/measure-cold-start.mjs`、`package.json` 中仅 `test:cold-start` 脚本、本任务文件。
- 验收重点：点位语义准确、日志只在 DEV、生产监测开销受控、Session Restore 回归通过、真实测量报告完整。
- 暂不处理：根据结果继续拆包、调整数据库时序、改恢复策略、增加缓存或实施第三阶段优化。

## 当前阶段详细任务

> 本节内容来自阶段 1 完成后的交接契约（原“阶段 2 执行契约”）。

### 目标

补齐并统一以下启动边界，按真实时间排序输出一次时间线：HTML 解析开始、Startup Shell DOM 就绪、HTML 解析完成、主入口请求、App 静态依赖图就绪、`main.tsx` 模块体执行、`createRoot`/render 开始、React 首次 mount、首个既有 RAF callback、活动会话恢复完成、活动文档首次真实可见、App 后台就绪。

### 点位语义

| 点位 | 定义与放置边界 |
|---|---|
| `html-start` | `index.html` `<head>` 中尽可能早的同步 mark；以 `performance.timeOrigin` 作为导航零点，不声称此脚本早于 HTML 字节到达 |
| `startup-shell-dom-ready` | Startup Shell 末尾紧邻的同步 mark，表示静态骨架 DOM 已提交给解析器，不等同于已绘制到屏幕 |
| `html-parsed` | `body` 尾部同步 mark，表示解析器已到达文档尾部；不新增生产 `DOMContentLoaded` listener |
| `main-module-requested` | 模块入口标签之前的同步 mark，表示开始请求/解析 `main.tsx` 依赖图 |
| `app-module-ready` | `main.tsx` 模块体能够执行时，静态 `@app-entry` 及其依赖已完成加载/求值的可观测边界 |
| `main-module-evaluated` | `main.tsx` 顶层业务语句开始执行；与 `app-module-ready` 可能非常接近，不虚构二者间下载耗时 |
| `create-root-start` | 调用 `ReactDOM.createRoot` 之前 |
| `react-render-start` | 调用 root `.render()` 之前 |
| `react-mounted` | 共享 React 接管 wrapper 的首次 `useLayoutEffect`，表示第一次真实 DOM commit 已完成 |
| `startup-shell-removed` | 与 `react-mounted` 同一 layout effect 中，在实际移除 Shell 后记录 |
| `first-animation-frame` | 复用 `AppLayout` 已有、用于启用 Editor surface 的首次 RAF callback；不为监测新增生产 RAF，不作为交互就绪指标 |
| `startup-session-restore-complete` | `restoreTabs()` 启动关键路径完成；metadata 只记录匿名 outcome/count，外部文件打开分支必须记录为 skipped/external-open |
| `active-tab-disk-read-complete` | 保留既有含义：活动标签磁盘读取/校验完成，无活动标签时也要有明确 outcome |
| `active-document-first-visible` | 保留既有真实文档/Boot Snapshot 可见语义；不得用 Startup Shell 触发 |
| `app-ready` | 保留既有后台就绪语义，不更名为首屏完成 |

### ESM 测量约束

- 当前 `main.tsx` 静态导入 `@app-entry`；ESM 会先加载并求值依赖，再执行 `main.tsx` 模块体。
- 因此 `main-module-requested → app-module-ready/main-module-evaluated` 代表入口依赖图总体成本，无法在不改变加载结构的情况下精确拆出单独 App 下载耗时。
- 不得为制造“main → App loaded”的漂亮顺序改成动态 import。日志应展示真实点位与上述说明，禁止负耗时、重排或虚构阶段。

### 实施任务

1. 扩展现有 `StartupPerformancePoint` 与统一 mark 前缀，保留全部旧点位和现有去重/等待行为；不得新建第二个全局性能收集器。
2. 让 HTML 同步 mark 与模块内 mark 使用同一 `guanmo:startup:` 前缀。内联脚本只调用原生 `performance.mark`，不引入生产 listener、Timer、Observer 或日志。
3. 在共享入口记录模块、createRoot、render、mount 和 Shell 移除点位；所有删除和标记均需在 StrictMode 下幂等。
4. 在 `AppLayout` 已有 RAF callback 内记录 `first-animation-frame`，不得额外调度仅用于埋点的生产 RAF，也不得改变 Editor surface 启用时序。
5. 在 `restoreTabs()` 的正常、无活动标签、外部文件打开和失败路径记录明确 outcome；只能增加旁路标记/metadata，不修改 await 顺序、后台恢复并发、merge 条件、异常传播或通知行为。
6. DEV 模式在必要终点到达后只输出一次启动报告：一行阶段链路摘要，加一张按 `startTime` 排序的表；每行至少包含点位、距 `timeOrigin`、距上一个点位和语义。
7. 报告应同时突出四组用户感知边界：静态 Shell DOM、React AppShell 可见/可交互、活动文档真实可见、后台 `appReady`。缺失点位显示 `missing`，不得填 0 或用其他点位代替。
8. 生产版不输出详细 console 时间线；现有 Release 测量所需的原生 mark 继续保留。详细 reporter 必须能被 Vite 在非 DEV 构建中裁剪，且不安装持续监听。
9. 增量更新现有 `scripts/measure-cold-start.mjs` 的 marker 白名单和汇总，不覆盖其当前 Edit/Preview surface、匿名临时状态、临时目录边界、进程退出与清理保护。
10. `package.json` 已有用户新增的 `test:cold-start`；仅在脚本名或参数确需对齐时最小调整该一项，禁止触碰或重排其他用户脚本。
11. 先完成机器门禁，再用当前源码构建的新鲜 Release EXE、隔离应用数据执行 Edit 与 Preview 各 3 次完整进程冷启动；报告每次样本与中位数，不与旧机器/旧构建数据直接宣称同比收益。
12. 在本文件新增“阶段 2 测量结果”表，记录环境、构建来源、各中位数、最大相邻耗时段、主要瓶颈、异常/缺失点位和结论。随后停止，不实施后续优化。

### 验收标准

- [x] 用户要求的 HTML、main、App ready boundary、createRoot/render、React mount、首个 RAF、会话/活动文档恢复点位全部存在且语义准确。
- [x] 既有 Startup、Editor、Preview、数据库和 `appReady` 点位保持兼容，未删除、重命名或改变原语义。
- [x] DEV 控制台只输出一次清晰时间线，绝对耗时和相邻耗时均为有限非负数；缺失点位明确显示。
- [x] 日志明确区分静态 Shell、真实 AppShell、真实文档与后台就绪，不把 Shell 或 RAF 伪装成交互完成。
- [x] 生产版无详细时间线日志，无新增监测 Timer/Observer/listener/额外 RAF；Release 原生 marks 可被测量脚本读取。
- [x] Session Restore 的外部文件、无活动标签、正常恢复和失败行为未改变，metadata 不含路径或内容。
- [x] `npm run test:session-restore` 通过。
- [x] `npm run test:app-warmup` 通过。
- [x] `npm run typecheck` 通过。
- [x] 相关文件定向 ESLint 通过且不新增 warning。
- [x] `npm run build` 与 `npm run build:desktop` 通过，Web/Desktop Bundle 门禁未放宽。
- [x] 当前源码的新鲜隔离 Release 完成 Edit、Preview 各 3 次冷启动采样，必需点位无缺失。
- [x] 本文件记录实际中位数、主要瓶颈和测量限制；未实施第三阶段优化。
- [x] `git diff --check` 对本任务范围通过，未夹带既有用户修改。

### 检查命令

```powershell
npm run test:session-restore
npm run test:app-warmup
npm run typecheck
npx eslint src/main.tsx src/App.tsx src/components/layout/AppLayout.tsx src/services/startupPerformance.ts scripts/measure-cold-start.mjs
npm run build
npm run build:desktop
git diff --check -- index.html src/main.tsx src/App.tsx src/components/layout/AppLayout.tsx src/services/startupPerformance.ts scripts/measure-cold-start.mjs package.json STARTUP_SHELL_AND_TIMELINE_IMPLEMENTATION_PLAN.md
```

Release 实测前必须明确记录新鲜 EXE 的构建命令、路径、时间和 commit/工作区来源。测量命令按现有脚本实际参数执行，例如：

```powershell
npm run test:cold-start -- --runs=3 --surface=edit --exe=<current-release-exe>
npm run test:cold-start -- --runs=3 --surface=preview --exe=<current-release-exe>
```

### 测量报告最低内容

| 类别 | 必须报告 |
|---|---|
| 环境 | Windows/WebView2、构建模式、EXE 来源、是否隔离数据、样本数 |
| 静态阶段 | launch/timeOrigin → `html-start` → `startup-shell-dom-ready` → `html-parsed` |
| 模块阶段 | `main-module-requested` → `app-module-ready/main-module-evaluated` |
| React 阶段 | `create-root-start` → `react-render-start` → `react-mounted` → `first-animation-frame` |
| 用户可见 | Startup Shell DOM、AppShell 首次可见、AppShell 可交互、活动文档首次可见 |
| 后台阶段 | 活动标签磁盘读取、启动会话恢复完成、数据库 ready、`appReady` |
| 结论 | 最大相邻耗时段、Edit/Preview 差异、主要瓶颈、测量限制、下一步候选但不实施 |

### 停止条件

- 为获得点位必须改变静态 import、恢复 await 顺序、Editor surface 启用时序或数据库启动顺序：停止并记录无法无侵入测量，不扩大实现。
- 新埋点导致 Bundle 明显增长、生产持续监听或冷启动关键指标稳定回退：回滚对应埋点，保留能无侵入采集的最小集合。
- Release EXE 不是当前源码的新鲜构建，或隔离数据/进程退出条件无法确认：不得输出瓶颈结论，阶段标记阻塞。
- 必需 marker 在任一 surface 三次采样中缺失：先修复点位或测量脚本，不用其他 marker 猜测补值。
- 发现主要瓶颈后立即停止在报告阶段；不得顺手实施第三阶段优化。

### Review 与交接

- 阶段 2 按 HIGH 风险执行完整相关 Machine Gate，默认不自动调用模型 Reviewer。
- 交接时提醒用户，如需模型验收可发送：`使用 ai-code-review Skill 执行本次模型 Review；只审查当前任务范围，遵循 AGENTS.md 和本项目 Review Profile。` 建议验收层级：L3。
- 只有测量与报告全部完成后才把项目状态标记为已完成；任何未执行的真实桌面/Release 验收必须写 `NOT TESTED`，不能用代码阅读代替。

## 阶段 2 测量结果

### 环境与构建

| 项 | 值 |
|---|---|
| 系统 | Windows / WebView2，CDP（`--remote-debugging-port`）读取原生 marks |
| 构建命令 | `$env:CARGO_TARGET_DIR='D:\React\guanmo-open\src-tauri\target-cold-start-release'; npx tauri build --no-bundle` |
| EXE 来源 | `src-tauri/target-cold-start-release/release/guanmo.exe`，构建于 2026-08-19 01:57，SHA256 前缀 `9AADD0E06E3622FE`，来源为当前工作区源码（含未提交修改） |
| 隔离 | 每样本独立临时 APPDATA/LOCALAPPDATA/TEMP/WEBVIEW2_USER_DATA_FOLDER，匿名基线文档（无 filePath、无用户数据） |
| 采样 | Edit 3 次 + Preview 3 次，均为完整进程冷启动（setup seed 进程 + 独立测量进程） |

### 中位数（进程启动 → 点位，ms）

| 指标 | Edit | Preview |
|---|---|---|
| timeOrigin（WebView2 首个文档） | 819 | 803 |
| html-start | 847 | 832 |
| startup-shell-dom-ready | 876 | 858 |
| html-parsed | 876 | 859 |
| app-module-ready / main-module-evaluated | 930 | 912 |
| react-mounted（与 Shell 移除同帧） | 943 | 927 |
| first-animation-frame | 952 | 946 |
| startup-session-restore-complete | 972 | 954 |
| active-document-first-visible | 1042 | 1040 |
| surface（Edit=editor-first-visible / Preview=preview-render-complete） | 1042 | 1028 |
| app-ready | 1032 | 1015 |

前端内相对耗时（frontend-bootstrap → 点位中位数）：Edit 文本 200ms / 表面 200ms / appReady 197ms；Preview 文本 206ms / 表面 194ms / appReady 181ms。

### 样本明细（进程启动 → 点位，ms，依次为 html-start / shell-dom-ready / html-parsed / module-ready / react-mounted / first-frame / session-restore / active-doc-visible / surface / app-ready）

- Edit run1：847 / 876 / 876 / 930 / 943 / 952 / 972 / 1042 / 1042 / 1032
- Edit run2：856 / 882 / 894 / 948 / 962 / 970 / 994 / 1056 / 1056 / 1053
- Edit run3：803 / 830 / 831 / 886 / 901 / 923 / 944 / 1014 / 1014 / 1007
- Preview run1：832 / 858 / 858 / 907 / 921 / 946 / 967 / 1042 / 1035 / 1038
- Preview run2：834 / 859 / 859 / 912 / 927 / 934 / 954 / 1040 / 1028 / 1015
- Preview run3：831 / 857 / 869 / 912 / 929 / 947 / 953 / 1030 / 1018 / 994

### 最大相邻耗时段（按文档时间中位数）

1. 进程启动 → timeOrigin：约 774–827ms（原生壳 + WebView2 初始化，前端不可控，约占总冷启动 78%）
2. html-parsed → app-module-ready：Edit 55ms / Preview 53ms（入口依赖图加载与求值）
3. startup-session-restore-complete → app-ready（数据库链）：Edit 60ms / Preview 61ms
4. startup-session-restore-complete → preview-render-complete：Preview 约 74ms（与数据库链交错）

### 异常与缺失点位

- 6/6 样本必需点位齐全，无 missing、无负值、无乱序时间线。
- 测量基建问题（非应用缺陷）：seed 直写 localStorage 后 `location.reload()` 会让旧文档延迟持久化队列在 beforeunload flush，用旧文档内存默认空态覆写测量态（表现为 Preview 必需点位缺失）；已改为 CDP `Page.addScriptToEvaluateOnNewDocument` 在新文档任何应用脚本执行前重写 seed，仅修改测量脚本，应用持久化语义未动。
- `app-ready` 与 `preview-render-complete` 相对顺序在样本间有交错（均落在文档时间约 190–235ms 区间），中位数按各自独立计算。

### 结论与候选方向（仅记录，不实施）

- 主要瓶颈：进程/WebView2 启动（约 0.8s，前端外）＞ 入口依赖图求值（约 55ms）＞ 数据库后台链（约 60ms）＞ Preview 渲染（约 70ms，与数据库交错）。
- Edit 与 Preview 表面差异在采样噪声内（中位数差 ≤ 14ms），无表面特定回退。
- 候选方向（不实施）：入口依赖图拆分/预加载评估、数据库初始化与前端模块加载并行化评估、进程级 WebView2 预热。
- 测量限制：单机 3 次/surface 采样，中位数仅代表当前机器与负载；launch→timeOrigin 波动约 ±30ms；测量态 seed 由测量脚本注入，不代表真实用户会话规模。

## 禁止事项

- 不修改本任务允许范围外的业务文件。
- 不覆盖或回退当前工作区已有的 `startupPerformance.ts`、`EditorArea.tsx`、`package.json`、测量脚本及其他用户修改。
- 不改数据库 schema、Session Restore 数据格式、Boot Snapshot 上限、文件授权或本地存储结构。
- 不用假的 Skeleton、空白 fallback、延迟真实文档或提前改名 `appReady` 制造数字改善。
- 不把 `requestAnimationFrame` 当作 AppShell 可交互或首帧已绘制的充分证据。
- 不新增第三方埋点 SDK、依赖、后台服务、遥测上传或跨会话历史存储。
- 不提高 Bundle 阈值，不强制 `manualChunks`，不为测量更改模块加载架构。
- 不运行全量 E2E、发布门禁或安装包构建；除非本文件明确列出，不扩大验证范围。
- 不提交、推送、打 tag、创建 PR 或 Release。

## 阶段历史

### 阶段 1｜HTML Startup Shell

- 状态：已完成
- 完成内容：`index.html` 新增静态 `#guanmo-startup-shell`（内联 CSS；38px 标题区、56px 折叠侧栏轨道、主内容占位条；颜色取默认浅色主题实际值，根背景 `#f8f4e8`；`pointer-events: none`、`aria-hidden`、无可聚焦元素）；`src/main.tsx` 新增 `StartupShellBoundary` 共享接管边界，首次真实 DOM commit 的 `useLayoutEffect` 中幂等移除 Shell，React 初始化失败时 Shell 保留；未改动 `@app-entry` 静态导入与 StrictMode
- 验证结果：`npm run typecheck`、`npx eslint src/main.tsx`、`npm run build`（Web 门禁通过）、`npm run build:desktop`（Desktop 门禁通过）、`git diff --check`（范围内三文件）全部通过；真实 Tauri 冷启动 3 次逐帧采样（dev 模式，当前源码调试 EXE + vite dev server）均为 纯米色首绘（WebView2 首绘延迟，约 0.6–0.85s）→ 静态骨架壳 → 真实界面，接管无白闪/重叠/双重标题栏/残留，进程均干净退出；Web 冒烟（WebApp 启动、Shell 接管移除、控制台无错误）通过；构建产物中骨架为纯静态内联
- 遗留问题：无阻塞项。备注：桌面视觉采样在 dev 模式完成（非 Release 构建），Release 三次采样按计划在阶段 2 执行；仓库中存在本次验收临时脚本 `scripts/_tmp_startup_shell_capture.ps1`，待用户决定是否删除

### 阶段 2｜启动性能埋点与测量报告

- 状态：已完成
- 完成内容：扩展 `startupPerformance.ts` 点位（HTML/main/App 边界、createRoot/render/mount、Shell 移除、首个 RAF、会话恢复 outcome）并统一 `guanmo:startup:` 前缀；`index.html` 同步 mark；`src/main.tsx` 幂等记录启动链；`AppLayout.tsx` 既有 RAF 内记录 `first-animation-frame`；`App.tsx` `restoreTabs()` 各路径旁路匿名 outcome；DEV 一次性时间线报告（生产可裁剪）；`measure-cold-start.mjs` 白名单/汇总增量更新、修复 seed 竞态（CDP `Page.addScriptToEvaluateOnNewDocument` 前置重写）、必需 marker 补齐 `active-document-first-visible`；隔离 Release Edit/Preview 各 3 次冷启动采样与报告完成（见“阶段 2 测量结果”）
- 验证结果：`test:session-restore`、`test:app-warmup`、`typecheck`、范围内定向 ESLint、`build`（Web 门禁）、`build:desktop`（Desktop 门禁）、`test:cold-start`（edit/preview 各 3 次，6/6 样本必需点位齐全）、`git diff --check` 全部通过
- 遗留问题：无阻塞项。备注：临时脚本 `scripts/_tmp_probe_webview2_targets.cjs`（seed 覆写排查探针）与阶段 1 的 `scripts/_tmp_startup_shell_capture.ps1` 均待用户决定是否删除；主要瓶颈结论与候选方向已记录，未实施第三阶段优化
