# GuanMo 冷启动最小优化任务计划

## 当前状态

- 项目状态：已完成（收益不足，已回滚）
- 当前阶段：阶段 1｜AI runtime 移出首包
- 阶段状态：已完成
- 上次执行结果：
  - Trae 尝试把 `src/App.tsx` 的 `aiClient` 静态导入改为 idle warmup 内动态导入；其记录的实验 entry 为 913,715 B，较基线增加 937 B
  - 静态调用链复核确认 `settingsStore`、`settingsSecrets` 等首屏依赖仍会拉入 `aiClient`、`webSearch`、RAG indexer 与 `externalHttp`
  - 已按停止条件完整回滚实验代码；`src/App.tsx` 与 app warmup 检查脚本没有遗留该 MVP 的修改
  - 回滚后重新构建确认 entry 恢复 912,778 B，HTML initial JS 1,054,514 B，JS 总量 5,688,039 B，89 chunks
- 验证结果：
  - `npm run test:app-warmup`：通过
  - `npm run typecheck`：通过
  - `npx eslint src/App.tsx`：通过，0 error
  - 计划内联合 ESLint：失败；仅 `scripts/run-app-warmup-check.mjs:20` 存在未修改脚本的既有 `console` no-undef
  - `npm run build:desktop`：通过；回滚后 Bundle 与基线一致
  - `npm run check:bundle:desktop`：通过
  - `git diff --check`：通过
- 本阶段剩余：无；收益门槛未达到，按停止条件结束
- 本阶段允许修改：`src/App.tsx`、必要的 app warmup 检查脚本、本文件
- 阻塞问题：无；AI runtime 无法在当前允许范围内移出，已执行预定停止条件
- 下一阶段：无；任务结束
- 远程操作：禁止提交、推送、打 tag 或发布

## 项目目标

在不继续扩大当前修改面的前提下，只完成一个最可能降低正常桌面冷启动成本的 MVP：把 `src/App.tsx` 静态引用的 AI runtime 移出首包，并用 Bundle 与真实冷启动数据判断是否保留。

## 当前基线

- Desktop entry：912,778 B
- HTML initial JS：1,054,514 B
- JS 总量：5,688,039 B
- chunks：89
- 初始 preload：仅 React
- 第一阶段既有完整进程冷启动中位数：
  - frontend bootstrap：45.7ms
  - first React render：143.9ms
  - active document first visible：158.2ms
  - AppShell first visible：158.3ms
  - AppShell interactive：276.1ms

## 总体约束

- 只做 AI runtime 动态导入，不追加第二项优化。
- 保留当前 dirty worktree，所有已有修改均视为用户修改，不覆盖、不回滚、不顺带格式化。
- 不修改 `AI_IMPLEMENTATION_PLAN.md`、数据库契约、既有未跟踪文档或 `src-tauri/Cargo.toml`。
- 不修改 Editor、Preview、Diff、SQLite、Boot Snapshot、文件恢复、CSP、Vite `manualChunks` 或持久化格式。
- 不新增依赖、缓存抽象、服务层或兼容分支。
- 不用 Skeleton 或延后真实内容制造指标提升。
- 代码、Bundle 和实测结果优先于计划描述。
- 不提交、不推送、不打 tag、不构建安装包、不发布。

## 阶段计划

### 阶段 1｜AI runtime 移出首包

- 目标：让 AI Provider、Embedding、Web Search、外部 HTTP 和状态校验运行时代码不再因 `App.tsx` 静态导入进入正常首屏依赖链。
- 范围：`src/App.tsx`；仅当现有静态门禁与新加载方式冲突时，最小修改直接相关的 app warmup 检查脚本；本文件只维护真实状态。
- 验收标准：AI 行为和 secrets 等待语义不变；Desktop entry 至少减少 5 KB；初始 preload 仍仅 React；相关门禁通过；冷启动关键指标不回退。
- 暂不处理：Editor/Preview/Diff 拆分、AppShell 其他静态依赖、原生文件关联意图、数据库时序和安装包验收。

## 当前阶段详细任务

### 目标

删除 `src/App.tsx` 对 `src/services/ai/aiClient.ts` 的静态运行时导入，把聊天 Provider、Embedding Provider 和 AI 状态校验放到既有首屏后任务中动态加载。动态 import 使用模块系统自身的 Promise 去重，不增加新的单例或缓存层。

### 允许修改

- `src/App.tsx`
- `scripts/run-app-warmup-check.mjs`，仅当门禁断言必须同步加载契约时
- `COLD_START_MVP_IMPLEMENTATION_PLAN.md`

### 实施任务

1. 从 `src/App.tsx` 移除 `initAiClient`、`initEmbeddingClient`、`isLocalApi`、`validateAiStatus` 的静态运行时导入。
2. 在聊天和 Embedding 的既有 idle warmup 回调中动态导入 `aiClient`，保持 secrets ensure Promise、配置判断、优先级、日志与异常处理顺序不变。
3. 在既有 3 秒状态校验入口动态导入 `validateAiStatus`，保持失败降级行为不变。
4. 不改变用户主动打开 AI、发送消息或请求 Embedding 时的现有消费入口。
5. 构建后核对 AI runtime 是否真正离开 Desktop entry；若仍被其他首屏静态依赖拉回，只记录调用链并执行回滚，不扩大本阶段范围。
6. Bundle 收益达到门槛后，使用与既有基线一致的隔离 identifier 和完整进程方式执行三次 Release 冷启动，报告中位数，不打安装包。

### 验收标准

- [ ] `src/App.tsx` 不再静态导入 `aiClient` 运行时。
- [ ] 聊天与 Embedding idle warmup 仍先等待 secrets hydration，再读取最终配置并初始化。
- [ ] AI 状态校验仍在首屏后执行，动态模块加载失败不会阻断 AppShell。
- [x] `npm run test:app-warmup` 通过。
- [x] `npm run typecheck` 通过。
- [x] 实际业务改动文件 `src/App.tsx` 的定向 ESLint 为 0 error，不新增 warning；计划内联合命令仅命中未修改脚本的既有问题。
- [x] `npm run build:desktop` 与 Desktop Bundle 门禁通过。
- [ ] Desktop entry 相比 912,778 B 至少减少 5 KB；未达到则回滚 MVP。
- [ ] HTML initial JS 同步下降，初始 preload 仍仅 React。
- [ ] 三次隔离 Release 完整进程冷启动无关键指标稳定回退；报告各项中位数和样本边界。
- [x] `git diff --check` 通过，未夹带本阶段范围外文件。

### 检查命令

```bash
npm run test:app-warmup
npm run typecheck
npx eslint src/App.tsx scripts/run-app-warmup-check.mjs
npm run build:desktop
npm run check:bundle:desktop
git diff --check
```

Release 实测只在代码已变化且 Bundle 收益达到 5 KB 门槛后执行；使用隔离应用数据，不读取或修改默认用户数据库。

### 停止条件

- Desktop entry 减少不足 5 KB：恢复本阶段对 `src/App.tsx` 和门禁脚本的修改，记录“收益不足”，结束任务。
- AI runtime 仍被其他首屏依赖静态拉入：不继续拆相邻模块，回滚并结束任务。
- AI warmup、secrets 等待或状态校验语义无法在最小修改内保持：标记阻塞，不扩大范围。
- Bundle 下降但三次冷启动出现稳定回退：保留测量证据，回滚并结束任务。

### 风险与回滚

- 主要风险：idle warmup 的动态模块加载失败、配置读取时序变化或静态门禁失配。
- 回滚方式：恢复 `aiClient` 静态 import 和原调用形式；恢复仅因本阶段调整的门禁断言。
- 不涉及数据库、文件内容、配置、缓存或持久化迁移，回滚不需要数据处理。

### 禁止事项

- 不修改允许范围外的业务代码。
- 不顺带拆分 Editor、Preview、Diff 或 AppShell 其他依赖。
- 不提高 Bundle 阈值，不用新的 `manualChunks` 掩盖首包依赖。
- 不重复执行无关测试、全量 E2E、安装包构建或发布检查。
- 不提交、推送、打 tag 或创建 Release。

## 阶段历史

### 阶段 1｜AI runtime 移出首包

- 状态：已完成（收益不足，按停止条件回滚）
- 尝试内容：将 `src/App.tsx` 对 `aiClient`（`initAiClient`、`initEmbeddingClient`、`isLocalApi`、`validateAiStatus`）的静态导入改为 idle warmup 回调内 `await import()`，保持 secrets 等待、配置判断、优先级、日志与异常处理顺序不变
- 阻断调用链（AI runtime 仍被 entry-level 静态拉回）：
  - `src/stores/settingsStore.ts:5` 静态导入 `inferProvider`（来自 aiClient）→ 拉入 aiClient.ts 及其顶层依赖 `OpenAICompatibleProvider`、`externalHttp`、`webSearch`
  - `src/stores/settingsStore.ts:7` 静态导入 `updateSearchConfig`（来自 webSearch）→ 拉入 `externalHttp`
  - `src/stores/settingsStore.ts:17` 静态导入 `rag/indexer` → 拉入 `aiClient`、`externalHttp`（经 pipeline、nativeIndex）
  - `src/services/settingsSecrets.ts:3` 静态导入 `webSearch` → 拉入 `externalHttp`
  - `src/App.tsx` 静态依赖 `settingsStore` 和 `settingsSecrets`，因此 `aiClient` 和 `externalHttp` 从未离开 entry
  - `vite.config.ts` 无 `manualChunks` 分配 `aiClient`/`externalHttp`
  - 动态 import wrapper（3 处）净增约 937 B，entry 不降反升
- 验证结果：验收重新执行 `typecheck`、`test:app-warmup`、`build:desktop`、Desktop Bundle 门禁和 `git diff --check` 均通过；回滚后 entry 为 912,778 B，与基线一致；Trae 记录的实验值 913,715 B 未在验收阶段重复构建
- 遗留问题：要将 AI runtime 真正移出 entry，需切断 `settingsStore` 对 `aiClient`/`webSearch`/`rag-indexer` 的静态导入，以及 `settingsSecrets` 对 `webSearch` 的静态导入，超出现有 MVP 允许修改范围（仅 `src/App.tsx`）
