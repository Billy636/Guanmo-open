import { create } from 'zustand'

export type AgentTraceStatus = 'running' | 'completed' | 'error' | 'cancelled' | 'timeout'
export type AgentTraceSpanStatus = 'running' | 'success' | 'error' | 'cancelled' | 'timeout' | 'skipped'

export interface AgentTraceMetadata {
  [key: string]: string | number | boolean | null | undefined
}

export interface AgentTraceSpan {
  spanId: string
  parentId?: string
  phase: string
  startedAt: number
  durationMs?: number
  status: AgentTraceSpanStatus
  metadata?: AgentTraceMetadata
}

export interface AgentTraceRecord {
  runId: string
  startedAt: number
  durationMs?: number
  status: AgentTraceStatus
  mode: 'direct' | 'agent' | 'unknown'
  metadata: AgentTraceMetadata
  spans: AgentTraceSpan[]
}

interface ActiveTrace {
  record: AgentTraceRecord
  spans: Map<string, AgentTraceSpan>
}

interface AgentDiagnosticsState {
  enabled: boolean
  runs: AgentTraceRecord[]
  setEnabled: (enabled: boolean) => void
  addRun: (record: AgentTraceRecord) => void
  clear: () => void
}

const MAX_RUNS = 24
const MAX_SPANS_PER_RUN = 240
const activeTraces = new Map<string, ActiveTrace>()

export const useAgentDiagnosticsStore = create<AgentDiagnosticsState>((set) => ({
  enabled: false,
  runs: [],
  setEnabled: (enabled) => set({ enabled }),
  addRun: (record) => set((state) => ({ runs: [...state.runs, record].slice(-MAX_RUNS) })),
  clear: () => set({ runs: [] }),
}))

function makeId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${uuid}`
}

function isDevDiagnosticsEnabled(): boolean {
  return import.meta.env.DEV && useAgentDiagnosticsStore.getState().enabled
}

export function startAgentTrace(input: {
  mode?: 'direct' | 'agent'
  metadata?: AgentTraceMetadata
}): string | undefined {
  if (!isDevDiagnosticsEnabled()) return undefined
  const runId = makeId('agent-run')
  activeTraces.set(runId, {
    record: {
      runId,
      startedAt: performance.now(),
      status: 'running',
      mode: input.mode ?? 'unknown',
      metadata: input.metadata ?? {},
      spans: [],
    },
    spans: new Map(),
  })
  return runId
}

export function startAgentTraceSpan(
  runId: string | undefined,
  phase: string,
  metadata?: AgentTraceMetadata,
  parentId?: string,
): string | undefined {
  if (!runId) return undefined
  const trace = activeTraces.get(runId)
  if (!trace || trace.record.spans.length >= MAX_SPANS_PER_RUN) return undefined
  const spanId = makeId('agent-span')
  const span: AgentTraceSpan = {
    spanId,
    ...(parentId ? { parentId } : {}),
    phase,
    startedAt: performance.now(),
    status: 'running',
    ...(metadata ? { metadata } : {}),
  }
  trace.record.spans.push(span)
  trace.spans.set(spanId, span)
  return spanId
}

export function finishAgentTraceSpan(
  runId: string | undefined,
  spanId: string | undefined,
  status: Exclude<AgentTraceSpanStatus, 'running'>,
  metadata?: AgentTraceMetadata,
): void {
  if (!runId || !spanId) return
  const span = activeTraces.get(runId)?.spans.get(spanId)
  if (!span || span.status !== 'running') return
  span.durationMs = Math.max(0, performance.now() - span.startedAt)
  span.status = status
  if (metadata) span.metadata = { ...span.metadata, ...metadata }
}

export function finishAgentTrace(
  runId: string | undefined,
  status: Exclude<AgentTraceStatus, 'running'>,
  metadata?: AgentTraceMetadata,
): void {
  if (!runId) return
  const trace = activeTraces.get(runId)
  if (!trace) return
  for (const span of trace.record.spans) {
    if (span.status === 'running') {
      span.status = status === 'timeout' ? 'timeout' : status === 'cancelled' ? 'cancelled' : 'error'
      span.durationMs = Math.max(0, performance.now() - span.startedAt)
    }
  }
  trace.record.durationMs = Math.max(0, performance.now() - trace.record.startedAt)
  trace.record.status = status
  if (metadata) trace.record.metadata = { ...trace.record.metadata, ...metadata }
  useAgentDiagnosticsStore.getState().addRun(trace.record)
  activeTraces.delete(runId)
}

export function clearAgentDiagnostics(): void {
  activeTraces.clear()
  useAgentDiagnosticsStore.getState().clear()
}

export function exportAgentDiagnostics(): void {
  if (!import.meta.env.DEV) return
  const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), runs: useAgentDiagnosticsStore.getState().runs }, null, 2)
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'guanmo-agent-diagnostics.json'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
