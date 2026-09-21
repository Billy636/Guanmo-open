import { beforeEach, describe, expect, it } from 'vitest'
import {
  finishAgentTrace,
  finishAgentTraceSpan,
  startAgentTrace,
  startAgentTraceSpan,
  useAgentDiagnosticsStore,
} from '@/services/devAgentDiagnostics'

describe('开发模式 Agent 诊断', () => {
  beforeEach(() => {
    useAgentDiagnosticsStore.setState({ enabled: false, runs: [] })
  })

  it('关闭时不创建 Trace，开启后按请求收集结构化 Span', () => {
    expect(startAgentTrace({ mode: 'agent' })).toBeUndefined()

    useAgentDiagnosticsStore.getState().setEnabled(true)
    const runId = startAgentTrace({ mode: 'agent', metadata: { routeMode: 'agent' } })
    const spanId = startAgentTraceSpan(runId, 'model_request', { streaming: true })
    finishAgentTraceSpan(runId, spanId, 'success')
    finishAgentTrace(runId, 'completed', { reason: 'completed' })

    const [run] = useAgentDiagnosticsStore.getState().runs
    expect(run.status).toBe('completed')
    expect(run.metadata.routeMode).toBe('agent')
    expect(run.spans).toHaveLength(1)
    expect(run.spans[0].phase).toBe('model_request')
    expect(run.spans[0].durationMs).toEqual(expect.any(Number))
  })

  it('结束请求时会收束未完成 Span', () => {
    useAgentDiagnosticsStore.getState().setEnabled(true)
    const runId = startAgentTrace({ mode: 'agent' })
    const spanId = startAgentTraceSpan(runId, 'tool', { tool: 'search_knowledge' })
    finishAgentTrace(runId, 'timeout', { reason: 'deadline' })

    const [run] = useAgentDiagnosticsStore.getState().runs
    expect(run.status).toBe('timeout')
    expect(run.spans[0].spanId).toBe(spanId)
    expect(run.spans[0].status).toBe('timeout')
    expect(run.spans[0].durationMs).toEqual(expect.any(Number))
  })

  it('中途关闭后丢弃进行中的请求，重新开启也不会补记旧请求', () => {
    useAgentDiagnosticsStore.getState().setEnabled(true)
    const oldRunId = startAgentTrace({ mode: 'agent' })
    startAgentTraceSpan(oldRunId, 'model_request')

    useAgentDiagnosticsStore.getState().setEnabled(false)
    useAgentDiagnosticsStore.getState().setEnabled(true)
    finishAgentTrace(oldRunId, 'completed')

    expect(useAgentDiagnosticsStore.getState().runs).toHaveLength(0)
    const newRunId = startAgentTrace({ mode: 'direct' })
    finishAgentTrace(newRunId, 'completed')
    expect(useAgentDiagnosticsStore.getState().runs).toHaveLength(1)
    expect(useAgentDiagnosticsStore.getState().runs[0].mode).toBe('direct')
  })
})
