import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { Activity, Bot, Download, Gauge, Pause, Play, Radio, Settings2, Trash2, X } from 'lucide-react'
import { usePerfMonitor } from '@/hooks/usePerfMonitor'
import { saveFileDialog, writeFile } from '@/hooks/useTauri'
import { eventMarker, type PerfEvent } from '@/services/eventMarker'
import { perfCollector } from '@/services/perfCollector'
import { PERF_SCHEMA_VERSION, withLegacyPerfFields, type PerfData } from '@/services/perfTypes'
import { getPerfHistory, usePerfStore, type PerfBaseline, type SampleIntervalMs } from '@/stores/perfStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { toast } from '@/services/toast'
import {
  clearAgentDiagnostics,
  exportAgentDiagnostics,
  useAgentDiagnosticsStore,
  type AgentTraceRecord,
} from '@/services/devAgentDiagnostics'

type PanelSection = 'overview' | 'processes' | 'resources' | 'context' | 'events'
type DiagnosticsSection = 'settings' | 'performance' | 'agent'

const EMPTY: PerfData = {
  timestamp: 0,
  appWorkingSetKb: 0,
  appPrivateWorkingSetKb: 0,
  appPrivateBytesKb: 0,
  webviewWorkingSetKb: 0,
  webviewPrivateWorkingSetKb: 0,
  webviewPrivateBytesKb: 0,
  rustWorkingSetKb: 0,
  rustPrivateWorkingSetKb: 0,
  rustPrivateBytesKb: 0,
  webviewProcessCount: 0,
  rendererProcessCount: 0,
  gpuProcessCount: 0,
  utilityProcessCount: 0,
  cpuPercent: 0,
  cpuNormalizedPercent: 0,
  cpuCoreEquivalent: 0,
  systemCpuPercent: 0,
  processBreakdown: [],
  fps: 0,
  jsHeapUsedMb: 0,
  jsHeapTotalMb: 0,
  domNodeCount: 0,
  detachedDomNodes: 0,
  activeTimeoutCount: 0,
  activeIntervalCount: 0,
  activeRafCount: 0,
  eventListenerCount: 0,
  eventListenerWindowCount: 0,
  eventListenerDocumentCount: 0,
  eventListenerDomCount: 0,
  eventListenerUnknownCount: 0,
  mutationObserverCount: 0,
  resizeObserverCount: 0,
  intersectionObserverCount: 0,
  activeObjectUrlCount: 0,
  longTaskCount: 0,
  longTaskTotalDurationMs: 0,
  longTaskMaxDurationMs: 0,
  lastLongTaskAt: null,
  lastLongTaskMode: null,
  lastLongTaskUserAction: null,
  monacoModelCount: 0,
  monacoModelTotalChars: 0,
  monacoEditorInstanceCount: 0,
  monacoDiffEditorInstanceCount: 0,
  monacoDecorationCount: 0,
  monacoMarkerCount: 0,
  monacoModels: [],
  currentMode: 'edit',
  docCharCount: 0,
  activeDocumentCount: 0,
  activeDocumentCharCount: 0,
  totalOpenDocumentCharCount: 0,
  activeDocumentLineCount: 0,
  previewInstanceCount: 0,
  editorInstanceCount: 0,
  aiPanelOpen: false,
  isFullscreen: false,
  totalCollectDurationMs: 0,
  processQueryDurationMs: 0,
  jsMetricDurationMs: 0,
  storeUpdateDurationMs: 0,
  panelRenderDurationMs: 0,
}
const EVENT_LABELS: Record<PerfEvent['type'], string> = {
  'frontend-bootstrap': '前端启动',
  'first-react-render': 'React 首次渲染',
  'app-shell-first-visible': '应用外壳首次可见',
  'app-shell-interactive': '应用外壳可交互',
  'secrets-hydrated': '密钥水合完成',
  'database-init-start': 'SQLite 初始化开始',
  'database-plugin-loaded': 'SQLite 插件加载完成',
  'database-connection-opened': 'SQLite 连接打开',
  'database-schema-gate-complete': 'SQLite Schema Gate 完成',
  'database-ready': '数据库就绪',
  'active-tab-disk-read-complete': '活动标签读盘完成',
  'active-document-first-visible': '活动文档首次可见',
  'app-start': '应用启动',
  'app-ready': '应用就绪',
  'open-file-start': '开始打开文件',
  'open-file-complete': '文件打开完成',
  'close-file': '关闭文件',
  'switch-document': '切换文档',
  'document-size-change': '文档大小变化',
  'switch-tab': '切换标签',
  'switch-mode-start': '开始切换模式',
  'switch-mode-complete': '模式切换完成',
  'mode-settled': '模式稳定',
  'preview-render-start': '开始渲染预览',
  'preview-render-complete': '预览渲染完成',
  'editor-create': '创建编辑器',
  'editor-dispose': '释放编辑器',
  'model-create': '创建模型',
  'model-dispose': '释放模型',
  'diff-create': '创建 Diff',
  'diff-dispose': '释放 Diff',
  'ai-panel-open': '打开 AI 面板',
  'ai-panel-close': '关闭 AI 面板',
  'enter-fullscreen': '进入全屏',
  'exit-fullscreen': '退出全屏',
  'baseline-set': '设置基线',
  'memory-snapshot': '内存快照',
  'policy-change': '策略切换',
  'prewarm-schedule': '预热调度',
  'prewarm-create': '预热创建请求',
  'prewarm-cancel': '预热取消',
  'resource-release': '资源回收请求',
  'open-file-read-complete': '文件读取完成',
  'editor-first-visible': '编辑器首帧可见',
  'preview-first-visible': '预览首帧可见',
}

function formatKb(kb: number) {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(2)} GB` : `${(kb / 1024).toFixed(1)} MB`
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function delta(current: number, baseline: number) {
  const value = current - baseline
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function safeData(data: PerfData) {
  return {
    ...withLegacyPerfFields(data),
    lastLongTaskUserAction: data.lastLongTaskUserAction && /^(click|keydown|pointerdown):[a-z0-9-]+$/.test(data.lastLongTaskUserAction)
      ? data.lastLongTaskUserAction
      : data.lastLongTaskUserAction ? '[redacted-action]' : null,
    monacoModels: data.monacoModels.map((model) => ({ ...model, uri: '[redacted-uri]' })),
  }
}

function extractWebViewVersion() {
  return navigator.userAgent.match(/Edg(?:A|iOS)?\/([\d.]+)/)?.[1] ?? 'unknown'
}

async function exportReport() {
  const state = usePerfStore.getState()
  const current = state.current
  const logicalCpuCount = navigator.hardwareConcurrency || 1
  const report = {
    schemaVersion: PERF_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    environment: {
      platform: navigator.platform,
      language: navigator.language,
    },
    testContext: {
      modePerformancePolicy: useSettingsStore.getState().editor.modePerformancePolicy,
    },
    buildMode: document.querySelector('meta[name="guanmo-build-mode"]')?.getAttribute('content') ?? 'unknown',
    appVersion: await getVersion().catch(() => 'unknown'),
    webview2Version: extractWebViewVersion(),
    osVersion: navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] ?? navigator.platform,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    logicalCpuCount,
    cpuNormalization: {
      logicalCpuCount,
      formula: 'cpuNormalizedPercent = cpuRawPercent ÷ logicalCpuCount',
      description: '归一化 CPU 百分比，与 Windows 任务管理器口径一致',
    },
    monitorSettings: state.settings,
    experimentalMetrics: ['eventListenerCount', 'detachedDomNodes'],
    baseline: state.baseline
      ? {
          kind: state.baseline.kind,
          setAt: state.baseline.setAt,
          snapshot: safeData(state.baseline.snapshot),
        }
      : null,
    processBreakdown: current?.processBreakdown ?? [],
    cpuMetrics: current ? {
      cpuRawPercent: current.cpuPercent,
      cpuNormalizedPercent: current.cpuNormalizedPercent,
      cpuCoreEquivalent: current.cpuCoreEquivalent,
      systemCpuPercent: current.systemCpuPercent,
    } : null,
    collectorOverhead: current ? {
      totalCollectDurationMs: current.totalCollectDurationMs,
      processQueryDurationMs: current.processQueryDurationMs,
      jsMetricDurationMs: current.jsMetricDurationMs,
      storeUpdateDurationMs: current.storeUpdateDurationMs,
      panelRenderDurationMs: current.panelRenderDurationMs,
    } : null,
    events: eventMarker.exportEvents(),
    history: getPerfHistory().map(safeData),
  }

  const path = await saveFileDialog(`perf-report-${Date.now()}.json`, [{ name: 'JSON', extensions: ['json'] }])
  if (!path) return false
  await writeFile(path, JSON.stringify(report, null, 2))
  return true
}

function MetricCard({
  label,
  value,
  numeric,
  baseline,
  peak,
  format = (item) => item.toFixed(1),
}: {
  label: string
  value: string
  numeric?: number
  baseline?: number
  peak?: number
  format?: (value: number) => string
}) {
  return (
    <div className="rounded border border-gray-700 bg-gray-800/60 p-2">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="text-sm text-white">{value}</div>
      {numeric !== undefined && baseline !== undefined && (
        <div className="mt-1 grid grid-cols-2 gap-x-2 text-[9px] text-gray-400">
          <span>基线 {format(baseline)}</span><span>变化 {delta(numeric, baseline)}</span>
          <span>峰值 {format(peak ?? numeric)}</span><span>残留 {delta(numeric, baseline)}</span>
        </div>
      )}
    </div>
  )
}

function Overhead({ data }: { data: PerfData }) {
  const level = data.totalCollectDurationMs > 50 ? 'text-red-400' : data.totalCollectDurationMs > 16 ? 'text-yellow-400' : 'text-green-400'
  return (
    <div className={`mt-2 rounded border border-gray-700 p-2 ${level}`}>
      监测开销 {data.totalCollectDurationMs.toFixed(1)}ms
      <span className="ml-2 text-[9px] text-gray-400">
        进程 {data.processQueryDurationMs.toFixed(1)} / JS {data.jsMetricDurationMs.toFixed(1)} /
        Store {data.storeUpdateDurationMs.toFixed(1)} / 面板 {data.panelRenderDurationMs.toFixed(1)}ms
      </span>
    </div>
  )
}

function Overview({ data, baseline, peaks }: { data: PerfData; baseline: PerfBaseline | null; peaks: Partial<Record<keyof PerfData, number>> }) {
  const base = baseline?.snapshot
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      <MetricCard label="应用私有内存" value={formatKb(data.appPrivateWorkingSetKb)} numeric={data.appPrivateWorkingSetKb} baseline={base?.appPrivateWorkingSetKb} peak={peaks.appPrivateWorkingSetKb} format={formatKb} />
      <MetricCard label="WebView 私有内存" value={formatKb(data.webviewPrivateWorkingSetKb)} numeric={data.webviewPrivateWorkingSetKb} baseline={base?.webviewPrivateWorkingSetKb} peak={peaks.webviewPrivateWorkingSetKb} format={formatKb} />
      <MetricCard label="Rust 私有内存" value={formatKb(data.rustPrivateWorkingSetKb)} numeric={data.rustPrivateWorkingSetKb} baseline={base?.rustPrivateWorkingSetKb} peak={peaks.rustPrivateWorkingSetKb} format={formatKb} />
      <div className="col-span-1 rounded border border-gray-700 bg-gray-800/60 p-2">
        <div className="text-[10px] text-gray-400">CPU 占用</div>
        <div className="mt-1 flex items-baseline gap-3">
          <div>
            <div className="text-[9px] text-gray-500">观墨</div>
            <div className="text-sm text-white">{data.cpuNormalizedPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500">系统</div>
            <div className="text-sm text-gray-400">{data.systemCpuPercent.toFixed(1)}%</div>
          </div>
        </div>
        {base?.cpuNormalizedPercent !== undefined && (
          <div className="mt-1 grid grid-cols-2 gap-x-2 text-[9px] text-gray-400">
            <span>基线 {base.cpuNormalizedPercent.toFixed(1)}%</span><span>变化 {delta(data.cpuNormalizedPercent, base.cpuNormalizedPercent)}</span>
            <span>峰值 {peaks.cpuNormalizedPercent?.toFixed(1) ?? data.cpuNormalizedPercent.toFixed(1)}%</span><span></span>
          </div>
        )}
      </div>
      <MetricCard label="FPS" value={String(data.fps)} />
      <MetricCard label="Long Task" value={`${data.longTaskCount} / max ${data.longTaskMaxDurationMs.toFixed(1)}ms`} />
      <div className="col-span-3"><Overhead data={data} /></div>
    </div>
  )
}

function Processes({ data }: { data: PerfData }) {
  const rows = data.processBreakdown.filter((process) => process.processType !== 'rust-main')
  return (
    <div className="max-h-80 overflow-auto p-3">
      <div className="mb-2 text-gray-400">WebView2 进程 {data.webviewProcessCount}：renderer {data.rendererProcessCount} / GPU {data.gpuProcessCount} / utility {data.utilityProcessCount}</div>
      <table className="w-full text-left text-[10px]">
        <thead className="sticky top-0 bg-gray-900 text-gray-400"><tr><th>PID</th><th>类型</th><th>WS</th><th>私有 WS</th><th>Private</th><th>Commit</th><th>CPU</th><th>线程</th><th>Handle</th></tr></thead>
        <tbody>{rows.map((process) => <tr key={process.pid} className="border-t border-gray-800">
          <td>{process.pid}</td><td>{process.processType}</td><td>{formatKb(process.workingSetKb)}</td><td>{formatKb(process.privateWorkingSetKb)}</td><td>{formatKb(process.privateBytesKb)}</td><td>{formatKb(process.commitSizeKb)}</td><td>{process.cpuPercent.toFixed(1)}%</td><td>{process.threadCount}</td><td>{process.handleCount}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="py-8 text-center text-gray-500">暂无 WebView2 子进程数据</div>}
    </div>
  )
}

function Resources({ data }: { data: PerfData }) {
  const entries: Array<[string, string | number]> = [
    ['JS Heap', `${data.jsHeapUsedMb.toFixed(1)} / ${data.jsHeapTotalMb.toFixed(1)} MB`],
    ['DOM', data.domNodeCount], ['Detached DOM（实验性）', data.detachedDomNodes],
    ['Monaco Model', data.monacoModelCount], ['Monaco 字符', data.monacoModelTotalChars],
    ['Monaco Editor', data.monacoEditorInstanceCount], ['Monaco Diff', data.monacoDiffEditorInstanceCount],
    ['Decoration', data.monacoDecorationCount], ['Marker', data.monacoMarkerCount],
    ['Timeout', data.activeTimeoutCount], ['Interval', data.activeIntervalCount], ['RAF', data.activeRafCount],
    ['监听器（实验性·总）', data.eventListenerCount],
    ['监听器（实验性·window）', data.eventListenerWindowCount],
    ['监听器（实验性·document）', data.eventListenerDocumentCount],
    ['监听器（实验性·DOM）', data.eventListenerDomCount],
    ['监听器（实验性·unknown）', data.eventListenerUnknownCount],
    ['MutationObserver', data.mutationObserverCount],
    ['ResizeObserver', data.resizeObserverCount], ['IntersectionObserver', data.intersectionObserverCount],
    ['Object URL', data.activeObjectUrlCount],
  ]
  return <div className="grid grid-cols-4 gap-2 p-3">{entries.map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}</div>
}

function DocumentContext({ data }: { data: PerfData }) {
  const entries: Array<[string, string | number]> = [
    ['活动文档数', data.activeDocumentCount],
    ['活动文档字符', data.activeDocumentCharCount.toLocaleString()],
    ['活动文档行数', data.activeDocumentLineCount.toLocaleString()],
    ['打开文档总字符', data.totalOpenDocumentCharCount.toLocaleString()],
    ['预览实例', data.previewInstanceCount],
    ['编辑器实例', data.editorInstanceCount],
    ['模式', data.currentMode],
    ['AI 面板', data.aiPanelOpen ? '打开' : '关闭'],
    ['全屏', data.isFullscreen ? '是' : '否'],
  ]
  return <div className="grid grid-cols-3 gap-2 p-3">{entries.map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}</div>
}

function Timeline({ events }: { events: PerfEvent[] }) {
  return <div className="max-h-80 overflow-auto p-3">
    {events.slice().reverse().map((event) => {
      const memoryDelta = event.before && event.after
        ? event.after.appPrivateWorkingSetKb - event.before.appPrivateWorkingSetKb
        : null
      const meta = event.metadata
      const metaStr = meta
        ? Object.entries(meta)
            .filter(([, v]) => v != null)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : ''
      return <div key={event.id} className="grid grid-cols-[64px_120px_1fr] gap-2 border-b border-gray-800 py-1">
        <span className="text-gray-500">{formatTime(event.timestamp)}</span>
        <span>{EVENT_LABELS[event.type] ?? event.type}</span>
        <span className="text-gray-400">
          {metaStr && <span className="text-gray-500">{metaStr} </span>}
          {event.durationMs !== undefined ? `${event.durationMs.toFixed(1)}ms` : ''}
          {memoryDelta !== null ? ` · 内存 ${memoryDelta >= 0 ? '+' : ''}${formatKb(memoryDelta)}` : ''}
        </span>
      </div>
    })}
    {!events.length && <div className="py-8 text-center text-gray-500">暂无事件</div>}
  </div>
}

function AgentDiagnosticsView({ runs }: { runs: AgentTraceRecord[] }) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const selected = runs.find((run) => run.runId === selectedRunId) ?? runs[runs.length - 1]
  return (
    <div className="grid min-h-[340px] grid-cols-[230px_1fr] bg-gm-surface-subtle">
      <div className="border-r border-gm-border-subtle bg-gm-surface/70">
        <div className="flex items-center gap-1 border-b border-gm-border-subtle px-3 py-2.5">
          <span className="mr-auto text-[11px] font-semibold uppercase tracking-[0.12em] text-gm-text-muted">最近请求</span>
          <button type="button" aria-label="导出 Agent 诊断" title="导出 Agent 诊断" className="rounded-lg p-1.5 text-gm-text-muted transition-colors hover:bg-gm-surface-elevated hover:text-gm-text" onClick={exportAgentDiagnostics}><Download size={14} /></button>
          <button type="button" aria-label="清空 Agent 诊断" title="清空 Agent 诊断" className="rounded-lg p-1.5 text-gm-text-muted transition-colors hover:bg-red-50 hover:text-red-600" onClick={() => { clearAgentDiagnostics(); setSelectedRunId(null) }}><Trash2 size={14} /></button>
        </div>
        {runs.slice().reverse().map((run) => (
          <button type="button" key={run.runId} className={`block w-full border-b border-gm-border-subtle px-3 py-2.5 text-left transition-colors ${selected?.runId === run.runId ? 'bg-gm-primary-subtle/45 text-gm-text' : 'text-gm-text-muted hover:bg-gm-surface-elevated'}`} onClick={() => setSelectedRunId(run.runId)}>
            <div className="flex items-center gap-2 text-[12px] font-medium"><span className={`h-1.5 w-1.5 rounded-full ${run.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'}`} />{run.mode === 'agent' ? 'Agent' : 'Direct'}<span className="ml-auto font-mono text-[10px] text-gm-text-muted">{run.durationMs?.toFixed(1) ?? '—'}ms</span></div>
            <div className="mt-1 text-[10px] text-gm-text-muted">{run.status} · {run.spans.length} spans</div>
          </button>
        ))}
        {!runs.length && <div className="p-5 text-center text-[11px] leading-5 text-gm-text-muted">开启 Agent 检测后，<br />请求流程会出现在这里</div>}
      </div>
      <div className="overflow-auto p-4">
        {selected ? (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-gm-border-subtle bg-gm-surface p-2.5"><div className="text-[10px] text-gm-text-muted">总耗时</div><div className="mt-1 font-mono text-sm text-gm-text">{selected.durationMs?.toFixed(1) ?? '—'}<span className="ml-1 text-[10px] text-gm-text-muted">ms</span></div></div>
              <div className="rounded-xl border border-gm-border-subtle bg-gm-surface p-2.5"><div className="text-[10px] text-gm-text-muted">状态</div><div className="mt-1 text-sm text-gm-text">{selected.status}</div></div>
              <div className="rounded-xl border border-gm-border-subtle bg-gm-surface p-2.5"><div className="text-[10px] text-gm-text-muted">步骤</div><div className="mt-1 font-mono text-sm text-gm-text">{selected.spans.length}</div></div>
            </div>
            <div className="mb-3 rounded-xl border border-gm-border-subtle bg-gm-surface px-3 py-2 text-[11px] text-gm-text-muted">路由 <span className="font-medium text-gm-text">{String(selected.metadata.routeMode ?? 'unknown')}</span><span className="mx-2 text-gm-border">·</span>原因 <span className="font-medium text-gm-text">{String(selected.metadata.routeReasons ?? 'unknown')}</span></div>
            <div className="overflow-hidden rounded-xl border border-gm-border-subtle bg-gm-surface">
              <div className="grid grid-cols-[1fr_76px_76px_120px] gap-2 border-b border-gm-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-gm-text-muted"><span>阶段</span><span>开始</span><span>耗时</span><span>结果</span></div>
              {selected.spans.map((span) => (
                <div key={span.spanId} className="grid grid-cols-[1fr_76px_76px_120px] gap-2 border-b border-gm-border-subtle px-3 py-2 text-[11px] last:border-b-0">
                  <span className="truncate font-medium text-gm-text">{span.metadata?.tool ? String(span.metadata.tool) : span.phase}</span>
                  <span className="font-mono text-[10px] text-gm-text-muted">{(span.startedAt - selected.startedAt).toFixed(1)}ms</span>
                  <span className="font-mono text-[10px] text-gm-text-muted">{span.durationMs?.toFixed(1) ?? '—'}ms</span>
                  <span className={span.status === 'success' ? 'text-emerald-600' : 'text-amber-600'}>{span.status}{span.metadata?.error ? ` · ${String(span.metadata.error)}` : ''}</span>
                </div>
              ))}
            </div>
          </>
        ) : <div className="flex min-h-[300px] flex-col items-center justify-center text-center text-gm-text-muted"><Bot size={24} strokeWidth={1.5} /><p className="mt-2 text-[12px]">选择一条 Agent 请求查看流程</p></div>}
      </div>
    </div>
  )
}

function ToggleSwitch({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={enabled} onClick={onToggle} className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-gm-primary' : 'bg-gm-border'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'left-6' : 'left-1'}`} /></button>
}

function SettingCard({ icon, title, description, enabled, onToggle, accent, detail }: { icon: ReactNode; title: string; description: string; enabled: boolean; onToggle: () => void; accent: string; detail: string }) {
  return <div className="flex items-start gap-3 rounded-2xl border border-gm-border-subtle bg-gm-surface p-4 shadow-[0_8px_24px_rgba(61,52,40,0.05)]"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}>{icon}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-gm-text">{title}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gm-surface-subtle text-gm-text-muted'}`}>{enabled ? '运行中' : '已关闭'}</span></div><p className="mt-1 text-[11px] leading-5 text-gm-text-muted">{description}</p><p className="mt-2 text-[10px] text-gm-text-muted">{enabled ? detail : '开启后才会收集数据'}</p></div><ToggleSwitch enabled={enabled} onToggle={onToggle} label={`开启${title}`} /></div>
}

function DisabledState({ icon, title, description, onEnable }: { icon: ReactNode; title: string; description: string; onEnable: () => void }) {
  return <div className="flex min-h-[390px] flex-col items-center justify-center bg-gm-surface-subtle px-6 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gm-surface text-gm-text-muted shadow-[0_8px_24px_rgba(61,52,40,0.06)]">{icon}</div><h2 className="mt-4 text-base font-semibold text-gm-text">{title}</h2><p className="mt-1 max-w-sm text-[12px] leading-5 text-gm-text-muted">{description}</p><button type="button" className="mt-5 rounded-xl bg-gm-primary px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5" onClick={onEnable}>立即开启</button></div>
}

function CollapsedDiagnosticEntry({
  performanceEnabled,
  agentEnabled,
  current,
  latestRun,
  onOpen,
}: {
  performanceEnabled: boolean
  agentEnabled: boolean
  current: PerfData | null
  latestRun?: AgentTraceRecord
  onOpen: () => void
}) {
  const hasEnabledDetection = performanceEnabled || agentEnabled
  const enabledLabels = [performanceEnabled ? '性能检测' : null, agentEnabled ? 'Agent 检测' : null].filter(Boolean).join('、')
  const agentStatus = latestRun?.status === 'completed' ? 'bg-emerald-500' : 'bg-amber-500'

  return (
    <button
      type="button"
      aria-label={`打开开发诊断${enabledLabels ? `；已开启${enabledLabels}` : ''}`}
      title={enabledLabels ? `开发诊断 · ${enabledLabels}` : '开发诊断'}
      className={`fixed bottom-5 right-5 z-[9999] flex items-center border border-gm-border bg-gm-surface/95 text-gm-text shadow-[0_10px_30px_rgba(61,52,40,0.16)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-gm-primary hover:text-gm-primary ${hasEnabledDetection ? 'min-h-11 max-w-[calc(100vw-40px)] gap-1.5 rounded-2xl p-1.5' : 'h-11 w-11 justify-center rounded-2xl'}`}
      onClick={onOpen}
    >
      {!hasEnabledDetection ? (
        <>
          <Activity size={18} strokeWidth={1.8} />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gm-border" />
        </>
      ) : (
        <>
          {performanceEnabled && (
            <span className="flex min-w-0 items-center gap-1 rounded-xl bg-blue-50 px-2 py-1.5 text-[10px] font-medium text-blue-700">
              <Gauge size={12} strokeWidth={2} />
              <span className="whitespace-nowrap">内存 {current ? formatKb(current.appPrivateWorkingSetKb) : '—'}</span>
              <span className="whitespace-nowrap text-blue-600/70">· CPU {current ? `${current.cpuNormalizedPercent.toFixed(1)}%` : '—'}</span>
            </span>
          )}
          {agentEnabled && (
            <span className="flex min-w-0 items-center gap-1 rounded-xl bg-amber-50 px-2 py-1.5 text-[10px] font-medium text-amber-700">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${latestRun ? agentStatus : 'bg-amber-300'}`} />
              <span className="whitespace-nowrap">Agent</span>
              <span className="whitespace-nowrap font-mono">{latestRun?.durationMs !== undefined ? `${latestRun.durationMs.toFixed(0)}ms` : '—'}</span>
            </span>
          )}
        </>
      )}
    </button>
  )
}

export function PerfMonitorPanel() {
  const renderStartedAt = performance.now()
  usePerfMonitor()
  const current = usePerfStore((state) => state.current)
  const events = usePerfStore((state) => state.events)
  const baseline = usePerfStore((state) => state.baseline)
  const peaks = usePerfStore((state) => state.testPeaks)
  const settings = usePerfStore((state) => state.settings)
  const isCollapsed = usePerfStore((state) => state.isCollapsed)
  const isPaused = usePerfStore((state) => state.isPaused)
  const performanceEnabled = usePerfStore((state) => state.enabled)
  const agentEnabled = useAgentDiagnosticsStore((state) => state.enabled)
  const runs = useAgentDiagnosticsStore((state) => state.runs)
  const latestAgentRun = runs[runs.length - 1]
  const [diagnosticsSection, setDiagnosticsSection] = useState<DiagnosticsSection>('settings')
  const [section, setSection] = useState<PanelSection>('overview')
  const data = current ?? EMPTY
  const tabs = useMemo<Array<[PanelSection, string]>>(() => [['overview', '概览'], ['processes', 'WebView2 进程'], ['resources', '前端资源'], ['context', '文档负载'], ['events', '事件时间线']], [])

  useLayoutEffect(() => {
    perfCollector.recordPanelRenderDuration(performance.now() - renderStartedAt)
  })

  const setBaseline = useCallback((kind: PerfBaseline['kind']) => {
    const snapshot = usePerfStore.getState().current
    if (snapshot) {
      usePerfStore.getState().setBaseline(kind)
      eventMarker.mark('baseline-set', { kind })
    }
  }, [])
  const handleExport = useCallback(async () => {
    try {
      if (await exportReport()) toast.success('性能报告已导出')
    } catch (error) {
      toast.error(error instanceof Error ? `导出失败：${error.message}` : '导出失败')
    }
  }, [])

  if (!import.meta.env.DEV) return null
  if (isCollapsed) return <CollapsedDiagnosticEntry performanceEnabled={performanceEnabled} agentEnabled={agentEnabled} current={current} latestRun={latestAgentRun} onOpen={usePerfStore.getState().toggleCollapsed} />

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex max-h-[min(760px,calc(100vh-40px))] w-[min(880px,calc(100vw-40px))] flex-col overflow-hidden rounded-[24px] border border-gm-border bg-gm-surface/95 font-sans text-gm-text shadow-[0_24px_70px_rgba(61,52,40,0.2)] backdrop-blur-2xl" style={{ userSelect: 'none' }}>
      <div className="flex items-center gap-3 border-b border-gm-border-subtle px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gm-primary-subtle text-gm-primary"><Activity size={18} /></div>
        <div className="mr-auto"><div className="text-sm font-semibold tracking-tight">开发诊断</div><div className="mt-0.5 text-[11px] text-gm-text-muted">只在开发模式运行 · 数据仅保留在当前会话</div></div>
        <div className="hidden items-center gap-1.5 text-[10px] text-gm-text-muted sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${performanceEnabled || agentEnabled ? 'bg-emerald-500' : 'bg-gm-border'}`} />{performanceEnabled || agentEnabled ? '检测中' : '未启用'}</div>
        <button type="button" aria-label="关闭开发诊断" title="关闭" className="rounded-xl p-2 text-gm-text-muted transition-colors hover:bg-gm-surface-subtle hover:text-gm-text" onClick={usePerfStore.getState().toggleCollapsed}><X size={17} /></button>
      </div>
      <div className="flex border-b border-gm-border-subtle px-3 pt-1">
        {([['settings', '设置', Settings2], ['performance', '性能检测', Gauge], ['agent', 'Agent 检测', Bot]] as const).map(([key, label, Icon]) => <button type="button" key={key} className={`relative flex items-center gap-1.5 px-3 py-3 text-[12px] font-medium transition-colors ${diagnosticsSection === key ? 'text-gm-text' : 'text-gm-text-muted hover:text-gm-text'}`} onClick={() => setDiagnosticsSection(key)}><Icon size={14} />{label}{key === 'performance' && performanceEnabled ? <span className="h-1.5 w-1.5 rounded-full bg-gm-primary" /> : null}{key === 'agent' && agentEnabled ? <span className="h-1.5 w-1.5 rounded-full bg-gm-primary" /> : null}{diagnosticsSection === key && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gm-primary" />}</button>)}
      </div>
      <div className="min-h-0 overflow-auto">
        {diagnosticsSection === 'settings' && <div className="space-y-4 bg-gm-surface-subtle p-5"><div><div className="text-lg font-semibold tracking-tight text-gm-text">选择要观察的信号</div><p className="mt-1 text-[12px] leading-5 text-gm-text-muted">检测默认关闭。只开启当前要排查的链路，减少额外开销和噪声。</p></div><div className="grid gap-3 md:grid-cols-2"><SettingCard icon={<Gauge size={19} />} title="性能检测" description="采集 WebView、进程、资源和事件时间线。关闭时不会安装全局资源追踪器。" enabled={performanceEnabled} onToggle={() => usePerfStore.getState().setEnabled(!performanceEnabled)} accent="bg-blue-50 text-blue-600" detail={`采样间隔 ${settings.sampleIntervalMs}ms`} /><SettingCard icon={<Bot size={19} />} title="Agent 检测" description="记录模型请求、工具执行、路由原因和每个阶段的耗时。不会保存对话正文。" enabled={agentEnabled} onToggle={() => useAgentDiagnosticsStore.getState().setEnabled(!agentEnabled)} accent="bg-amber-50 text-amber-600" detail={`${runs.length} 条请求记录`} /></div><div className="flex items-center gap-2 rounded-xl border border-dashed border-gm-border bg-gm-surface px-3 py-2.5 text-[11px] text-gm-text-muted"><Radio size={14} className="text-gm-primary" />建议只在复现问题时开启对应检测，完成后关闭。</div></div>}
        {diagnosticsSection === 'performance' && <>{!performanceEnabled ? <DisabledState icon={<Gauge size={24} />} title="性能检测未开启" description="在“设置”中开启性能检测后，这里才会显示采样和资源数据。" onEnable={() => usePerfStore.getState().setEnabled(true)} /> : <div className="bg-gm-surface-subtle"><div className="flex flex-wrap items-center gap-2 border-b border-gm-border-subtle px-5 py-3"><div className="mr-auto flex items-center gap-2 text-[11px] text-gm-text-muted"><span className="h-2 w-2 rounded-full bg-emerald-500" />实时采样</div><select aria-label="采样频率" className="rounded-lg border border-gm-border-subtle bg-gm-surface px-2 py-1.5 text-[11px] text-gm-text outline-none" value={settings.sampleIntervalMs} onChange={(event) => usePerfStore.getState().setSampleInterval(Number(event.target.value) as SampleIntervalMs)}><option value={5000}>5s</option><option value={1000}>1s（60秒）</option><option value={500}>500ms（60秒）</option><option value={250}>250ms（60秒）</option></select><button type="button" className="flex items-center gap-1.5 rounded-lg border border-gm-border-subtle bg-gm-surface px-2.5 py-1.5 text-[11px] text-gm-text transition-colors hover:border-gm-primary" onClick={usePerfStore.getState().togglePaused}>{isPaused ? <Play size={13} /> : <Pause size={13} />}{isPaused ? '继续' : '暂停'}</button><button type="button" className="flex items-center gap-1.5 rounded-lg border border-gm-border-subtle bg-gm-surface px-2.5 py-1.5 text-[11px] text-gm-text transition-colors hover:border-gm-primary" onClick={() => { eventMarker.mark('memory-snapshot'); void handleExport() }}><Download size={13} />导出 JSON</button></div><div className="flex gap-1 overflow-x-auto border-b border-gm-border-subtle px-4 pt-1">{tabs.map(([key, label]) => <button type="button" key={key} className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-medium ${section === key ? 'border-b-2 border-gm-primary text-gm-text' : 'text-gm-text-muted'}`} onClick={() => setSection(key)}>{label}</button>)}</div>{section === 'overview' && <Overview data={data} baseline={baseline} peaks={peaks} />}{section === 'processes' && <Processes data={data} />}{section === 'resources' && <Resources data={data} />}{section === 'context' && <DocumentContext data={data} />}{section === 'events' && <Timeline events={events} />}<div className="flex flex-wrap gap-2 border-t border-gm-border-subtle px-5 py-3"><button type="button" className="rounded-lg border border-gm-border-subtle bg-gm-surface px-2.5 py-1.5 text-[11px] text-gm-text-muted hover:text-gm-text" onClick={() => setBaseline('idle')}>设置空闲基线</button><button type="button" className="rounded-lg border border-gm-border-subtle bg-gm-surface px-2.5 py-1.5 text-[11px] text-gm-text-muted hover:text-gm-text" onClick={() => setBaseline('document')}>设置文档基线</button><button type="button" className="rounded-lg border border-gm-border-subtle bg-gm-surface px-2.5 py-1.5 text-[11px] text-gm-text-muted hover:text-gm-text" onClick={usePerfStore.getState().clearBaseline}>清除基线</button><button type="button" className="ml-auto rounded-lg border border-gm-border-subtle bg-gm-surface px-2.5 py-1.5 text-[11px] text-gm-text-muted hover:text-gm-text" onClick={() => { eventMarker.clearEvents(); usePerfStore.getState().clearHistory() }}><Trash2 size={13} className="mr-1 inline-block" />清空记录</button></div></div>}</>}
        {diagnosticsSection === 'agent' && <>{!agentEnabled ? <DisabledState icon={<Bot size={24} />} title="Agent 检测未开启" description="在“设置”中开启 Agent 检测后，这里才会记录每次模型和工具流程。" onEnable={() => useAgentDiagnosticsStore.getState().setEnabled(true)} /> : <AgentDiagnosticsView runs={runs} />}</>}
      </div>
    </div>
  )
}
