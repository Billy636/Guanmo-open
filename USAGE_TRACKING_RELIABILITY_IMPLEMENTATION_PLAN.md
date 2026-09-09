# 使用时长统计可靠性修复分阶段实施计划

> 本文件是本任务唯一状态来源。执行者必须使用 staged-task-handoff Skill，完整读取本文件后，只执行“当前阶段”，不得提前实施后续阶段。

## 当前状态

- 项目状态：已完成
- 当前阶段：阶段 5｜真实 Tauri 验收与收尾
- 阶段状态：已完成
- 上次执行结果：
  - 阶段 3 已完成：新增匿名 UsageTrackingError 状态，逐字段识别窗口查询失败，并增加有限启动重试
  - SQLite 读写失败可观察；pending 失败保留，成功重试后只扣除已确认整秒；flush/clear 共用串行边界
  - 阶段 4 已完成：设置页消费运行/未激活/错误状态；不足一分钟显示“少于 1 分钟”；刷新先结算当前有效区间；卸载失效旧查询并取消订阅
  - 未修改 Schema、数据库初始化或统计范围
- 验证结果：
  - npx vitest run tests/settings/usageActivity.test.tsx tests/usage/usageTracking.test.ts tests/usage/usageTracking.lifecycle.test.ts：74 项通过
  - npm run typecheck：通过
  - npx eslint src/features/settings/UsageActivity.tsx src/services/usageTracking.ts tests/settings/usageActivity.test.tsx tests/usage/usageTracking.test.ts：通过
  - src/styles/global.css：ESLint 按项目配置忽略，未产生错误
  - git diff --check：通过
  - 执行前检查发现 guides/compatibility.md 不存在，未自行编造兼容规则
  - npm run build:desktop：通过；桌面入口 1,342,419 bytes，JS 总量 5,592,187 bytes，预算通过
  - HEAD 基线对照入口 1,347,986 bytes，确认本任务增量触发过入口预算；启动 Hook 已改为按需加载统计服务后恢复通过
  - 已用独立 identifier 启动隔离 Tauri：应用数据位于 com.guanmo.app.codex-test，页面来自当前工作区，Vite 1420、WebView2 CDP 9223 已确认
  - 隔离实例聚焦运行后 UI 与测试 SQLite 均记录 150 秒；一次失焦尝试期间 Windows 会话进入锁屏，数据库从 150 秒增至 240 秒，证据判定无效
  - 解锁 Windows 会话后，用户确认已在隔离 Tauri 实例中完成真实验收矩阵；运行无异常，时长记录和内存占用正常
  - 真实 Tauri 失焦/最小化/刷新/重启/开关/写入失败恢复、默认宽度和长时间内存验收均已通过人工验收
  - 临时基线 Junction 清理误影响 node_modules，已按 package-lock 执行 npm ci 恢复；未修改 package.json 或 lockfile
  - 本阶段剩余：无
- 本阶段允许修改：
  - AI_IMPLEMENTATION_PLAN.md
- 阻塞问题：无；阶段 5 真实桌面验收已完成
- 下一阶段：无（当前为最终验收阶段）
- 远程操作：禁止提交、推送、打 tag、创建 PR 或 Release

## 项目目标

用最小、可验证的实现恢复桌面端使用时长统计，并消除 checkpoint 相关内存暴涨。

最终必须满足：

1. 仅统计开关启用且窗口聚焦、可见、未最小化时的前台时间。
2. checkpoint、失焦、关闭开关和退出时能够准确结算，不重复、不遗漏。
3. 时间拆分对小数、非法值、午夜边界和系统时间变化均能有限返回，任何输入都不得导致无限循环或持续分配。
4. SQLite 暂时失败时保留未写增量并可重试，不得静默假装成功。
5. 启动或窗口状态查询失败后能够被观察并恢复，不得在本次应用生命周期中永久失效。
6. 关闭应用前完成最后一次结算，StrictMode 和快速焦点变化不得产生多个计时器或监听器。
7. 单元测试、类型检查和构建不能替代真实 Tauri 桌面验收；最终必须完成聚焦、失焦、最小化、刷新、重启和长时间内存验证。

## 当前技术栈与关键入口

- 运行环境：Tauri v2、WebView2
- 语言：TypeScript、React
- 状态：Zustand
- 持久化：tauri-plugin-sql、SQLite usage_daily
- 测试：Vitest、伪时钟、轻量数据库和窗口 mock
- 应用入口：src/App.tsx
- 启动 Hook：src/hooks/useUsageTracking.ts
- 核心服务：src/services/usageTracking.ts
- 设置页：src/features/settings/UsageActivity.tsx
- Schema：src/services/database/schema.ts
- 数据库初始化：src/services/database/db.ts
- 相关测试：
  - tests/usage/usageTracking.test.ts
  - tests/usage/usageTracking.lifecycle.test.ts

## 执行前必读

每个阶段开始前必须：

1. 读取 AGENTS.md 和本文件。
2. 执行 git status --short，现有修改全部视为用户修改。
3. 只读取当前阶段允许范围和直接相关调用链。
4. 生命周期、资源或性能分析先用 code-review-graph 最小查询，再进行精确符号搜索。
5. 涉及窗口生命周期或性能监测时读取 docs/agent-contracts/desktop-services.md。
6. 涉及 SQLite、Schema、数据清理或恢复时读取 docs/agent-contracts/database.md。
7. 涉及设置页状态或 UI 层级时读取 docs/agent-contracts/ui.md。
8. 涉及配置兼容时读取 guides/compatibility.md；文件不存在则记录缺失，不得自行编造规则。
9. 不自动启用 Trellis。
10. 不读取真实用户数据库；测试只使用 mock、匿名 Fixture、临时目录和临时数据库。

## 已确认的问题与边界

### 1. 时间拆分仍有无限循环风险

splitIntervalByMidnight 当前使用 Date 保存游标。若 endMs 带小数，new Date(segmentEnd).getTime() 会截断小数，游标可能不再前进，而循环条件持续成立，result 不断增长。

computeElapsed 当前使用 Math.floor，能够保护现有内部 checkpoint 入口，但这只是调用方防线，不是切分函数自身的完整修复。必须同时规范输入并验证每轮 segmentEnd 大于 cursor。

### 2. 启动失败后没有可靠恢复

startUsageTracking 在数据库探测、监听注册或首次窗口查询失败时抛出。Hook 虽重置 startedRef，但 ready 通常不再变化，因此 Effect 不会自动重试。

### 3. 窗口状态错误被伪装成普通 inactive

queryWindowState 中任意窗口 API 调用失败都会被统一转换为 focused=false、visible=false、minimized=true，没有具体错误和恢复状态，可能导致统计永久不启动。

### 4. 数据库写入失败被静默吞掉

flushPending 保留 pending 是正确方向，但 catch 完全无反馈。UI 和日志无法区分“没有使用时间”与“写入持续失败”。

### 5. 关闭生命周期实现缺失

测试要求 onCloseRequested、preventDefault、最终结算和 destroy；当前生产服务没有注册关闭监听。现有生命周期测试因此有 3 项失败。

### 6. 短时显示可能造成误判

formatDuration 对不足 60 秒显示 0 分钟。它不是内存暴涨根因，但会放大“没有统计”的用户感知。

## 总体约束

- 每个会话默认只执行一个阶段。
- 优先最小修改，不重构无关模块，不新增依赖。
- 不更换数据库，不新增后台常驻服务。
- 不读取、清空、重置或迁移真实用户使用数据。
- usage_daily 继续只保存整秒；不足一秒余数保留在内存。
- 单次计入上限保持 60 秒，checkpoint 目标周期保持约 30 秒。
- 不统计键盘、文档、AI、文件路径或用户行为明细。
- 错误必须可观察，但不得记录用户内容或敏感数据。
- 不用放宽测试、超时、内存或构建门槛规避问题。
- 不自动执行全量测试、全量 E2E 或发布门禁。
- 不提交、不推送、不打 tag、不创建 PR 或 Release。
- 阶段状态只允许：未开始、进行中、阻塞、已完成。
- 只有当前阶段验收项与检查真实通过后，才能标记已完成。

## 阶段计划

### 阶段 1｜时间计算止血与可复现基线

#### 目标

先消除已经确认的无限分配条件，并建立后续阶段可复用的新鲜运行基线。当前阶段不改生命周期、数据库错误策略或 UI。

#### 允许修改

- src/services/usageTracking.ts
- tests/usage/usageTracking.test.ts
- AI_IMPLEMENTATION_PLAN.md

#### 实施任务

1. 开始前确认当前工作区、HEAD、端口 1420 和 GuanMo/Tauri/Vite/WebView2 进程，避免旧 bundle 干扰。
2. 记录当前 usageTracking 纯函数测试结果，以及生命周期测试 3 项已知失败，不在本阶段修复生命周期失败。
3. 加固 splitIntervalByMidnight：
   - 拒绝或安全处理 NaN、Infinity 和非有限输入。
   - 在函数边界统一整数毫秒，明确采用的取整策略。
   - 每轮必须满足 segmentEnd 大于 cursor。
   - 游标不前进时立即有限退出或抛出可定位错误，不允许继续 push。
   - 设置与输入区间相称的最大分段保护，避免异常跨度造成不可控分配。
4. 保留 computeElapsed 的整数化和 60 秒上限，确认墙钟倒退、单调时钟倒退时重置基准且不计入负时间。
5. 增加小数 start/end、小于 1ms、午夜前后、跨多日、非法值和游标边界测试。
6. 使用有限迭代或测试超时验证旧触发条件已经消失，禁止直接运行会导致 OOM 的旧实现。
7. 更新本文件真实结果；只有纯时间计算验收全部通过才能进入阶段 2。

#### 验收标准

- [x] 小数毫秒输入有限返回，执行时间和结果规模有确定上界。
- [x] 任一循环迭代都能证明游标严格前进。
- [x] NaN、Infinity、负区间和反向区间不会产生分配循环。
- [x] 同日、跨午夜、跨多日的整数毫秒结果正确。
- [x] computeElapsed 输出为有限非负整数，且不超过 60 秒。
- [x] tests/usage/usageTracking.test.ts 通过。
- [x] TypeScript、定向 ESLint 和 git diff --check 通过。
- [x] 未修改生命周期、UI、Schema 或数据库初始化代码。

#### 检查命令

~~~powershell
npx vitest run tests/usage/usageTracking.test.ts
npm run typecheck
npx eslint src/services/usageTracking.ts tests/usage/usageTracking.test.ts
git diff --check
git status --short
~~~
#### 暂不处理

- 不修复关闭监听测试。
- 不重写生命周期状态机。
- 不改变数据库写入策略。
- 不修改设置页显示。
- 不做长时间桌面验收。

---

### 阶段 2｜生命周期状态机与关闭结算

#### 目标

统一启动、激活、checkpoint、失活、停止和关闭流程，消除竞态、重复计时器、任务积压与退出丢失。

#### 预计允许修改

- src/services/usageTracking.ts
- src/hooks/useUsageTracking.ts
- tests/usage/usageTracking.lifecycle.test.ts
- AI_IMPLEMENTATION_PLAN.md

#### 实施要求

1. 先读取 desktop-services 契约并用知识图确认实际调用链。
2. 用明确状态表达 stopped、inactive、active、stopping；避免多个布尔变量组合出非法状态。
3. 所有 activate、deactivate、checkpoint、clear 前结算和 close 操作进入同一可推理的串行边界；禁止嵌套等待同一队列。
4. 优先采用“本次 checkpoint 完成后再安排下一次”的调度方式，避免 setInterval 在写入变慢时无界排队。
5. 焦点、可见性和最小化事件只提交状态变化，不并发执行多条计时流程。
6. 恢复 onCloseRequested：阻止默认关闭、只结算一次、等待写入、解除监听并 destroy。
7. 保持 StrictMode start/stop/start 只存在一套监听器和一个调度器。
8. 修复现有 3 项失败，并补充快速失焦/聚焦、慢窗口查询、重复停止和重复关闭测试。

#### 验收标准

- [x] 生命周期测试全部通过。
- [x] 任意时刻最多一个 checkpoint 调度器。
- [x] 写入变慢时不会持续累积定时任务。
- [x] 失焦和最小化后不再计时。
- [x] 重新聚焦后能恢复计时。
- [x] 关闭前最后一段只写入一次。
- [x] StrictMode 不产生重复监听或重复计时。

---

### 阶段 3｜数据库失败恢复与可观察状态

#### 目标

让启动、窗口查询和 SQLite 写入失败可定位、可重试，并保证未写时长不丢失。

#### 预计允许修改

- src/services/usageTracking.ts
- src/hooks/useUsageTracking.ts
- src/services/database/db.ts，仅在证据证明数据库就绪通知不可避免时
- tests/usage/usageTracking.lifecycle.test.ts
- tests/usage/usageTracking.test.ts
- AI_IMPLEMENTATION_PLAN.md

#### 实施要求

1. 读取 database 和 desktop-services 契约。
2. 启动失败不得仅依赖 ready 变化；在安全事件或明确重试入口恢复，但不得无界高频重试。
3. 分别记录 focused、visible、minimized 查询失败，不得把错误伪装成正常 inactive。
4. 保守停止统计期间保留状态，并在下一次合法窗口事件重新评估。
5. SQLite 写入失败保留 pending，暴露匿名错误状态，并在后续 checkpoint 或手动刷新时重试。
6. 写入成功后只扣除已确认整秒，保留写入期间新增量和不足一秒余数。
7. 清空数据与写入共用串行边界，禁止旧的在途写入在清空后重新写回。

#### 验收标准

- [x] 一次启动失败不会让本次应用生命周期永久失效。
- [x] 单个窗口 API 失败可定位且后续可以恢复。
- [x] SQLite 失败后 pending 不丢失、不重复。
- [x] 恢复写入后数据库累计值正确。
- [x] 清空后旧写入不会回流。
- [x] 不记录用户内容、路径或行为明细。

---

### 阶段 4｜设置页状态与短时显示

#### 目标

消除“正在统计但显示 0”和“保存失败却无反馈”的误导，不新增统计范围或复杂 UI。

#### 预计允许修改

- src/features/settings/UsageActivity.tsx
- src/services/usageTracking.ts，仅暴露阶段 3 已定义的最小状态
- src/styles/global.css，仅必要的现有组件样式
- 与 UsageActivity 直接相关的定向测试
- AI_IMPLEMENTATION_PLAN.md

#### 实施要求

1. 读取 ui 契约。
2. 不足一分钟显示“少于 1 分钟”或现有视觉能容纳的秒级提示。
3. 最小区分：正在统计、当前未激活、保存失败。
4. 手动刷新必须先结算当前有效区间，再加载数据库与 pending。
5. 组件卸载后取消订阅并使在途查询结果失效。
6. 不改热力图视觉方向，不引入新依赖或新弹窗体系。

#### 验收标准

- [x] 有效计时不足一分钟时不再误显示为完全没有统计。
- [x] inactive 与保存失败可区分。
- [x] 手动刷新不重复累计。
- [x] 设置页反复挂载不会泄漏监听器或异步更新。
- [x] 默认窗口宽度通过头部控件换行和状态文本约束避免新增横向溢出；真实窗口仍由阶段 5 复核。

---

### 阶段 5｜真实 Tauri 验收与收尾

#### 目标

使用新鲜 Tauri 进程确认真实功能、持久化和内存稳定性；自动化检查不能代替本阶段。

#### 执行前准备

1. 完整关闭当前仓库的 GuanMo、Tauri、Vite、Cargo 和相关 WebView2 进程。
2. 核对端口 1420、进程命令行、工作区、分支和 HEAD。
3. 设置 WebView2 调试参数并确认 CDP 页面来自当前实例。
4. 使用测试统计数据；不得读取或清空真实用户数据库。

#### 真实验收矩阵

1. [x] 聚焦运行约 70 秒：数据库与 UI 增加约 70 秒；用户确认通过。
2. [x] 失焦 30 秒：不增加；用户确认通过。
3. [x] 重新聚焦 40 秒：继续增加；用户确认通过。
4. [x] 最小化 30 秒：不增加；用户确认通过。
5. [x] 未满 30 秒时手动刷新：立即结算有效增量；用户确认通过。
6. [x] 关闭并重启：累计数据仍存在，关闭前末段不丢失；用户确认通过。
7. [x] 开关关闭：立即结算，关闭期间不增加；重新开启后恢复；用户确认通过。
8. [x] 模拟一次 SQLite 写入失败：pending 保留，恢复后只补写一次；用户确认通过。
9. [x] 连续启用运行至少 10 分钟：checkpoint 持续推进，WebView2 与主进程内存不呈无上限单调增长；用户确认时长记录和内存占用正常。
10. [x] 设置页默认宽度：无横向滚动，状态和刷新控件可用；用户确认通过。

#### 完成标准

- [x] 上述矩阵全部通过；环境为独立 identifier `com.guanmo.app.codex-test` 的隔离 Tauri 实例，页面来自当前工作区，使用匿名测试数据库；用户确认各步骤无异常。
- [x] 没有 checkpoint 时刻的突发无限分配。
- [x] usage_daily 增量与有效前台时间在调度误差范围内一致；聚焦运行期间 UI 与隔离 SQLite 曾对账为 150 秒，用户确认完整复测通过。
- [x] 定向 usage 测试、typecheck、定向 ESLint、desktop build 和 git diff --check 通过。
- [x] 没有遗留调试开关、误导日志或仅为复现添加的代码。
- [x] 真实桌面长时间运行已完成，满足“未完成时不得标记任务完成”的限制。

## 当前阶段详细任务

### 当前目标

只完成阶段 5：使用新鲜 Tauri 进程完成真实功能、持久化、默认宽度和长时间内存验收，并收尾本计划。不得用自动化测试替代真实桌面证据。

### 允许修改

- AI_IMPLEMENTATION_PLAN.md

### 实施顺序

1. 关闭并核对当前仓库的 GuanMo/Tauri/Vite/Cargo/WebView2 进程、端口 1420、工作区和 HEAD。
2. 运行 `npm run build:desktop`；失败时只修复本任务直接引入的问题，不扩大范围。
3. 启动新鲜桌面实例，确认调试页面来自当前工作区；仅使用匿名测试数据，不读取或清空真实数据库。
4. 按真实验收矩阵记录聚焦、失焦、重新聚焦、最小化、刷新、关闭重启、开关、写入失败恢复、默认宽度和至少 10 分钟内存结果。
5. 运行最终定向 usage 测试、typecheck、定向 ESLint 和 git diff --check。
6. 根据真实结果更新顶部状态、阶段 5 矩阵和阶段历史；所有完成标准通过后才可标记项目完成。

### 验收标准

- [x] 真实验收矩阵全部通过并写回环境、步骤和结果。
- [x] 关闭和重启后累计数据保持，关闭前末段不丢失。
- [x] usage_daily 增量与有效前台时间在调度误差范围内一致。
- [x] 至少 10 分钟运行期间 checkpoint 持续推进，WebView2 与主进程内存无无上限单调增长。
- [x] 默认窗口宽度无横向滚动，状态和刷新控件可用。
- [x] 定向 usage 测试、typecheck、定向 ESLint、desktop build 和 git diff --check 通过。
- [x] 已完成真实桌面长时间运行后标记项目完成。

### 当前验收结果

- 隔离 Tauri 实例已验证来自当前工作区，使用独立 identifier 和测试数据库，不读取默认用户数据库。
- 隔离实例聚焦运行证据有效（UI 与 SQLite 均为 150 秒）；解锁后用户确认重新完成失焦、聚焦、最小化、刷新、关闭重启、开关、SQLite 失败恢复、默认宽度和长时间运行验收，均无异常。
- 用户确认运行期间时长记录正常，内存占用正常；未读取或清空默认用户数据库。

### 禁止事项

- 不读取或清空真实用户数据库；仅使用匿名测试数据。
- 不执行全量测试或全量 E2E。
- 不提交、不推送、不打 tag、不创建 PR 或 Release。
- 不删除任何文件。

## 阶段历史

### 阶段 4｜设置页状态与短时显示

- 状态：已完成
- 完成内容：`formatDuration` 对正数秒级时长显示“少于 1 分钟”；设置页展示运行中、未激活、窗口状态异常、读失败和保存失败状态；手动刷新先执行 checkpoint 再读取数据库与 pending；成功读操作清除数据库读错误；组件卸载取消快照订阅并使旧查询结果失效；头部控件支持换行；新增 UsageActivity 定向测试
- 验证结果：UsageActivity 与 usageTracking 定向测试共 74/74 通过；typecheck、定向 ESLint、git diff --check 通过；CSS 文件按配置被 ESLint 忽略且无错误
- 遗留问题：真实 Tauri 验收、默认窗口宽度实际检查和长时间内存验证留给阶段 5

### 阶段 5｜真实 Tauri 验收与收尾

- 状态：已完成
- 已完成：desktop build 与 bundle budget 通过；为避免统计服务进入首屏入口，启动 Hook 改为按需加载，功能入口保持不变；隔离 Tauri/Vite/WebView2/CDP 启动证据已确认来自当前工作区；聚焦运行约 150 秒并与隔离 SQLite 对账；用户解锁后确认真实验收矩阵全部通过，时长记录和内存占用正常
- 验收结果：有效失焦、重新聚焦、最小化、刷新、关闭重启、开关、SQLite 失败恢复、默认宽度和至少 10 分钟内存矩阵均通过
- 验证结果：74 项定向测试通过；`npm run typecheck`、定向 ESLint、`npm run build:desktop`、`git diff --check` 均通过；desktop bundle budget 通过
- 遗留问题：无

### 阶段 3｜数据库失败恢复与可观察状态

- 状态：已完成
- 完成内容：新增匿名错误状态；窗口 focused/visible/minimized 查询逐字段失败识别与恢复；启动数据库失败有限重试；SQLite 读写错误可观察；pending 失败保留并可重试；flush、结算和清空共用串行边界
- 验证结果：usageTracking.test.ts 与 usageTracking.lifecycle.test.ts 共 71/71 通过；typecheck、定向 ESLint、git diff --check 通过
- 遗留问题：设置页尚未消费新的 error 状态和短时显示，真实 Tauri 验收留给阶段 5

### 阶段 2｜生命周期状态机与关闭结算

- 状态：已完成
- 完成内容：引入 stopped/inactive/active/stopping 状态；统一生命周期串行队列；checkpoint 改为完成后再调度；焦点/可见性事件串行化；恢复 onCloseRequested、preventDefault、最终结算、解除监听和 destroy；补充快速焦点与慢写入回归
- 验证结果：usageTracking.test.ts 与 usageTracking.lifecycle.test.ts 共 69/69 通过；typecheck、定向 ESLint、git diff --check 通过
- 遗留问题：数据库失败的可观察状态与恢复机制留给阶段 3；真实 Tauri 验收留给阶段 5

### 阶段 1｜时间计算止血与可复现基线

- 状态：已完成
- 完成内容：对 splitIntervalByMidnight 统一采用 Math.trunc 整数毫秒；拒绝非有限和超出 Date 范围输入；增加最大分段保护；每轮校验 cursor 严格前进；补充小数、小于 1ms、非法值、长区间和跨多日测试
- 验证结果：usageTracking.test.ts 35/35 通过；typecheck 通过；定向 ESLint 通过；git diff --check 通过；生命周期测试保持 29/32 通过，3 项关闭监听相关失败留给阶段 2
- 遗留问题：guides/engineering-execution.md 缺失；真实 Tauri 桌面验收和长时间内存验证留给阶段 5

## 新窗口执行提示词

~~~text
请使用 staged-task-handoff Skill，完整读取仓库根目录的
AGENTS.md 和 AI_IMPLEMENTATION_PLAN.md。

只执行当前阶段“阶段 5｜真实 Tauri 验收与收尾”。
使用独立 identifier 的隔离 Tauri 数据目录，不读取默认用户数据库。

开始前执行 git status --short，并核对当前工作区、HEAD、
端口 1420 和相关进程。现有修改和未跟踪文件全部视为用户内容。
生命周期或资源探索先使用 code-review-graph 最小查询。

运行计划列出的真实验收矩阵、定向测试和检查，
根据真实结果更新 AI_IMPLEMENTATION_PLAN.md 的当前状态与阶段历史。

如果 Windows 会话处于锁屏，停止真实焦点验收并等待人工解锁，
不得把后台继续计时或自动化 DOM 证据当作失焦通过。

不要读取或清空真实用户数据库。
不要提交、推送、打 tag、创建 PR 或 Release。
~~~
