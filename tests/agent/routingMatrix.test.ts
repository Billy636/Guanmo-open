/**
 * AI 路由评测矩阵 - 阶段 1 基线
 *
 * 目标：在不修改生产路由的前提下，建立匿名、可重复的当前行为基线。
 * 所有案例使用合成文本，不读取真实用户数据、文件或数据库。
 *
 * 每条案例记录：
 * - expected: 预期模式（direct/agent）、允许/必需/禁止能力、写入权限、继承权限
 * - observed: 实际路由结果（来自当前生产代码）
 *
 * 重要：expected 与 observed 分离，不把当前错误固化成正确断言。
 * 基线测试不应因为 expected/observed 差异而失败。
 */
import { describe, expect, it } from 'vitest'
import {
  detectIntentScores,
  classifySelectionRequest,
  shouldUseAgentMode,
  shouldAllowMemoryWrite,
  isImplicitEditContinuation,
  shouldIncludeFullDocumentContext,
  isLocalResearchIntent,
  isWebComparisonIntent,
  isFileSummaryIntent,
  isDocumentRewriteIntent,
  type Capability,
  type AppContext,
} from '@/services/agent/intentDetector'
import {
  buildCandidateTools,
  isWriteTool,
  isReadTool,
  type AgentToolName,
} from '@/services/agent/toolSelector'
import { makeRoutingDecision } from '@/services/agent/routingService'
import type { RoutingReasonCode } from '@/services/agent/types'

// --- 案例类型 ---

interface RoutingCase {
  label: string
  category: string
  query: string
  appContext: AppContext
  expectedMode: 'direct' | 'agent'
  allowedCapabilities: Capability[]
  requiredCapabilities: Capability[]
  forbiddenCapabilities: Capability[]
  writeAllowed: boolean
  continuationAllowed: boolean
}

interface ObservedResult {
  mode: 'direct' | 'agent'
  candidates: Capability[]
  required: Capability[]
  tools: AgentToolName[]
  writeTools: AgentToolName[]
  reasonCodes: RoutingReasonCode[]
}

interface BaselineRecord {
  case: RoutingCase
  observed: ObservedResult
  modeMatch: boolean
  forbiddenViolations: Capability[]
  missingRequired: Capability[]
}

// --- 运行器 ---

function runRoutingCase(tc: RoutingCase): BaselineRecord {
  const decision = makeRoutingDecision(tc.query, tc.appContext, {
    forceAgent: false,
    manualCapabilities: [],
    agentTaskContext: null,
    hasRecentEditContext: tc.appContext.hasRecentEdit ?? false,
    contextTagCount: tc.appContext.hasContextTags ? 1 : 0,
    messages: [],
  })

  const tools = decision.candidateTools
  const writeTools = tools.filter((t) => isWriteTool(t))

  const forbiddenViolations = tc.forbiddenCapabilities.filter((c) =>
    decision.candidates.includes(c)
  )
  const missingRequired = tc.requiredCapabilities.filter(
    (c) => !decision.candidates.includes(c)
  )

  return {
    case: tc,
    observed: {
      mode: decision.mode,
      candidates: decision.candidates,
      required: decision.required,
      tools,
      writeTools,
      reasonCodes: decision.reasonCodes,
    },
    modeMatch: decision.mode === tc.expectedMode,
    forbiddenViolations,
    missingRequired,
  }
}

interface BaselineSummary {
  totalCases: number
  totalPassed: number
  totalFailed: number
  modeMismatches: number
  modeMismatchDetails: Array<{ label: string; category: string; expected: string; observed: string; observedCandidates: string[]; reasonCodes: string[] }>
  forbiddenViolations: number
  forbiddenDetails: Array<{ label: string; category: string; violations: string[]; tools: string[] }>
  missingRequireds: number
  missingRequiredDetails: Array<{ label: string; category: string; missing: string[] }>
  categories: Record<string, { total: number; passed: number; failures: number }>
}

function summarizeBaseline(records: BaselineRecord[]): BaselineSummary {
  const modeMismatches = records.filter((r) => !r.modeMatch)
  const forbiddenHits = records.filter((r) => r.forbiddenViolations.length > 0)
  const missingRequireds = records.filter((r) => r.missingRequired.length > 0)
  const failedRecords = new Set([
    ...modeMismatches.map((r) => r.case.label),
    ...forbiddenHits.map((r) => r.case.label),
    ...missingRequireds.map((r) => r.case.label),
  ])

  const categories: Record<string, { total: number; passed: number; failures: number }> = {}
  for (const r of records) {
    const cat = r.case.category
    if (!categories[cat]) categories[cat] = { total: 0, passed: 0, failures: 0 }
    categories[cat].total++
    if (failedRecords.has(r.case.label)) {
      categories[cat].failures++
    } else {
      categories[cat].passed++
    }
  }

  return {
    totalCases: records.length,
    totalPassed: records.length - failedRecords.size,
    totalFailed: failedRecords.size,
    modeMismatches: modeMismatches.length,
    modeMismatchDetails: modeMismatches.map((r) => ({
      label: r.case.label,
      category: r.case.category,
      expected: r.case.expectedMode,
      observed: r.observed.mode,
      observedCandidates: r.observed.candidates,
      reasonCodes: r.observed.reasonCodes,
    })),
    forbiddenViolations: forbiddenHits.length,
    forbiddenDetails: forbiddenHits.map((r) => ({
      label: r.case.label,
      category: r.case.category,
      violations: r.forbiddenViolations,
      tools: r.observed.tools,
    })),
    missingRequireds: missingRequireds.length,
    missingRequiredDetails: missingRequireds.map((r) => ({
      label: r.case.label,
      category: r.case.category,
      missing: r.missingRequired,
    })),
    categories,
  }
}

// --- 上下文工厂 ---

const noContext: AppContext = {}
const selectionContext: AppContext = { hasSelection: true, hasContextTags: true }
const fileContext: AppContext = { hasOpenFile: true, hasContextTags: true }
const editContext: AppContext = { hasRecentEdit: true, hasContextTags: true }
const selectionEditContext: AppContext = {
  hasSelection: true,
  hasRecentEdit: true,
  hasContextTags: true,
}

// ============================================================
// 案例矩阵
// ============================================================

const routingCases: RoutingCase[] = [
  // --- 普通问答 ---
  {
    label: '普通问答-问候',
    category: '普通问答',
    query: '你好，今天过得怎么样？',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'memory', 'file_write', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '普通问答-编程概念',
    category: '普通问答',
    query: '什么是闭包？',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'memory', 'file_write', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '普通问答-数学计算',
    category: '普通问答',
    query: '1+1等于几？',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'memory', 'file_write', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '普通问答-弱词不应触发Agent',
    category: '普通问答',
    query: '你能解释一下这个吗？',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'file_write', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '普通问答-单一弱词"分析"',
    category: '普通问答',
    query: '分析一下这个问题',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'file_write', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- Selection 总结/翻译/解释 ---
  // 注意：当前代码中，selection fast 路径会清零非改写意图的分数，
  // 导致这些情况进入 direct 模式。这是预期的当前行为基线。
  {
    label: 'Selection 总结',
    category: 'Selection',
    query: '总结这段内容',
    appContext: selectionContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 翻译',
    category: 'Selection',
    query: '翻译成英文',
    appContext: selectionContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 解释',
    category: 'Selection',
    query: '解释这段代码的含义',
    appContext: selectionContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 格式化（改写意图）',
    category: 'Selection',
    query: '整理这段文字的格式',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'selection_context', 'file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },

  // --- Selection 上下文读取 ---
  {
    label: 'Selection 上下文-为什么',
    category: 'Selection 上下文',
    query: '为什么这里要这样写？',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 上下文-原因',
    category: 'Selection 上下文',
    query: '这段话的原因是什么？',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 上下文-对比',
    category: 'Selection 上下文',
    query: '对比一下前后文',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 上下文-关系',
    category: 'Selection 上下文',
    query: '这段和上下文的关系是什么？',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 上下文-是否正确',
    category: 'Selection 上下文',
    query: '这段代码是否正确？',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 上下文-错误在哪',
    category: 'Selection 上下文',
    query: '这里哪里错了？',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Selection 上下文-附近内容',
    category: 'Selection 上下文',
    query: '查看附近内容',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['selection_context', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- 文件总结 ---
  {
    label: '文件总结-总结',
    category: '文件总结',
    query: '总结一下这个文件',
    appContext: fileContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_read', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '文件总结-概述',
    category: '文件总结',
    query: '概述这个文档的内容',
    appContext: fileContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_read', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '文件总结-重点',
    category: '文件总结',
    query: '这篇文章讲了什么重点？',
    appContext: fileContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_read', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- 本地知识库研究 ---
  {
    label: '知识库-研究',
    category: '本地知识库',
    query: '研究一下知识库里的技术方案',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge'],
    requiredCapabilities: ['knowledge'],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '知识库-查找',
    category: '本地知识库',
    query: '知识库里有没有关于部署的文档？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '知识库-根据资料回答',
    category: '本地知识库',
    query: '根据我的笔记，总结一下学习方法',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '知识库-本地文档',
    category: '本地知识库',
    query: '本地文档里有没有相关的资料？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '知识库-调研',
    category: '本地知识库',
    query: '调研一下现有的技术栈',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- Web 搜索 ---
  {
    label: 'Web 搜索-搜索',
    category: 'Web 搜索',
    query: '搜索 React 19 最新特性',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Web 搜索-网上搜',
    category: 'Web 搜索',
    query: '帮我网上搜一下最新的 AI 新闻',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Web 搜索-查一下（含"今天"触发time）',
    category: 'Web 搜索',
    query: '查一下今天的天气',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Web 搜索-最新',
    category: 'Web 搜索',
    query: '最新的前端框架有哪些？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- 本地与 Web 对照 ---
  {
    label: 'Web 对照-联网验证',
    category: 'Web 对照',
    query: '联网验证一下知识库里的信息是否过时',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Web 对照-和网上对比',
    category: 'Web 对照',
    query: '把我的笔记和网上资料对比一下',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: 'Web 对照-查官网',
    category: 'Web 对照',
    query: '查一下官网有没有更新',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- 文件修改 ---
  {
    label: '文件修改-润色',
    category: '文件修改',
    query: '润色这段文字',
    appContext: selectionEditContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-优化',
    category: '文件修改',
    query: '优化这段代码的写法',
    appContext: selectionEditContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-改写',
    category: '文件修改',
    query: '帮我改写这篇文章',
    appContext: fileContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write', 'file_read', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-调整',
    category: '文件修改',
    query: '调整一下文档结构',
    appContext: fileContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write', 'file_read', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-替换',
    category: '文件修改',
    query: '替换文件中的旧内容',
    appContext: fileContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write', 'file_read', 'knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-撤销',
    category: '文件修改',
    query: '撤销刚才的修改',
    appContext: editContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-算了不改了',
    category: '文件修改',
    query: '算了，不改了',
    appContext: editContext,
    expectedMode: 'agent',
    allowedCapabilities: ['file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '文件修改-多目标',
    category: '文件修改',
    query: '修改这两个文件',
    appContext: { hasContextTags: true, hasOpenFile: true },
    expectedMode: 'agent',
    allowedCapabilities: ['file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'memory', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },

  // --- 长期记忆查询 ---
  {
    label: '记忆-查询记忆',
    category: '长期记忆',
    query: '查询我的记忆',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '记忆-你记得什么',
    category: '长期记忆',
    query: '你记得我之前告诉过你什么吗？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '记忆-我的偏好',
    category: '长期记忆',
    query: '我的偏好是什么？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '记忆-保存记忆',
    category: '长期记忆',
    query: '记住我喜欢用 TypeScript',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '记忆-添加记忆',
    category: '长期记忆',
    query: '添加记忆：我的地址是北京',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '记忆-普通改写不应检索记忆',
    category: '长期记忆',
    query: '帮我改写这段文字',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'selection_context', 'file_write'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['memory', 'web', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },

  // --- 个性化改写 ---
  {
    label: '个性化改写-按我的风格',
    category: '个性化改写',
    query: '按照我的风格改写这段文字',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'selection_context', 'file_write', 'memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },
  {
    label: '个性化改写-按我的习惯',
    category: '个性化改写',
    query: '按我的写作习惯润色一下',
    appContext: selectionContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge', 'selection_context', 'file_write', 'memory'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'time'],
    writeAllowed: true,
    continuationAllowed: false,
  },

  // --- 当前时间 ---
  {
    label: '时间-现在几点',
    category: '当前时间',
    query: '现在几点了？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['time'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '时间-今天几号',
    category: '当前时间',
    query: '今天几号？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['time'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '时间-今天星期几',
    category: '当前时间',
    query: '今天星期几？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['time'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '时间-当前日期',
    category: '当前时间',
    query: '当前日期是什么？',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['time'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory'],
    writeAllowed: false,
    continuationAllowed: false,
  },

  // --- 短指令续接 ---
  // 短指令在意图检测层面不触发任何能力，依赖 resolveAgentContextContinuation 继承上下文
  {
    label: '续接-继续',
    category: '续接',
    query: '继续',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: true,
  },
  {
    label: '续接-重试',
    category: '续接',
    query: '重试',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: true,
  },
  {
    label: '续接-换个方法',
    category: '续接',
    query: '换个方法',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: true,
  },

  // --- 边界表达 ---
  // 注意：当前路由中，单个弱关键词即可触发对应能力，这是已知问题。
  // 以下案例记录了当前实际行为，expected 为理想行为，observed 为当前行为。
  {
    label: '边界-"文档"（当前触knowledge）',
    category: '边界',
    query: '文档',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"分析"（当前触knowledge）',
    category: '边界',
    query: '分析',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"最新"（当前触web）',
    category: '边界',
    query: '最新',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"修改"（当前触file_write）',
    category: '边界',
    query: '修改',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"搜索"（当前触web）',
    category: '边界',
    query: '搜索',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['web', 'file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"解释"（当前触knowledge）',
    category: '边界',
    query: '解释',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"时间"（当前触time）',
    category: '边界',
    query: '时间',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['time', 'web', 'file_write', 'memory'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"总结一下"（当前触knowledge）',
    category: '边界',
    query: '总结一下',
    appContext: noContext,
    expectedMode: 'direct',
    allowedCapabilities: [],
    requiredCapabilities: [],
    forbiddenCapabilities: ['knowledge', 'web', 'file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"知识库"（强关键词应触发）',
    category: '边界',
    query: '知识库',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['knowledge'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'web', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
  {
    label: '边界-"联网搜索"（强关键词应触发）',
    category: '边界',
    query: '联网搜索',
    appContext: noContext,
    expectedMode: 'agent',
    allowedCapabilities: ['web'],
    requiredCapabilities: [],
    forbiddenCapabilities: ['file_write', 'memory', 'time'],
    writeAllowed: false,
    continuationAllowed: false,
  },
]

// ============================================================
// 测试套件 - 基线记录（不因 expected/observed 差异而失败）
// ============================================================

describe('AI 路由评测矩阵 - 阶段 1 基线', () => {
  const records: BaselineRecord[] = []

  // 收集所有案例的 observed 结果
  for (const tc of routingCases) {
    it(`[${tc.category}] ${tc.label}`, () => {
      const record = runRoutingCase(tc)
      records.push(record)
      // 不在此处断言 expected/observed 匹配，只在摘要中汇总
      expect(record.observed.candidates).toBeDefined()
    })
  }

  // 基线摘要 - 列出所有差异
  it('基线摘要', () => {
    const summary = summarizeBaseline(records)

    console.log('='.repeat(60))
    console.log('AI 路由基线摘要 - 阶段 1')
    console.log('='.repeat(60))
    console.log(`总案例数: ${summary.totalCases}`)
    console.log(`通过: ${summary.totalPassed}`)
    console.log(`差异: ${summary.totalFailed}`)
    console.log('')

    if (summary.modeMismatches > 0) {
      console.log(`--- 模式误判 (${summary.modeMismatches}) ---`)
      for (const m of summary.modeMismatchDetails) {
        console.log(`  [${m.category}] ${m.label}`)
        console.log(`    expected: ${m.expected} | observed: ${m.observed} | candidates: ${m.observedCandidates.join(', ')} | reasons: ${m.reasonCodes.join(', ')}`)
      }
      console.log('')
    }

    if (summary.forbiddenViolations > 0) {
      console.log(`--- 禁止能力误入 (${summary.forbiddenViolations}) ---`)
      for (const f of summary.forbiddenDetails) {
        console.log(`  [${f.category}] ${f.label}`)
        console.log(`    violations: ${f.violations.join(', ')} | tools: ${f.tools.join(', ')}`)
      }
      console.log('')
    }

    if (summary.missingRequireds > 0) {
      console.log(`--- 必需能力漏调 (${summary.missingRequireds}) ---`)
      for (const m of summary.missingRequiredDetails) {
        console.log(`  [${m.category}] ${m.label}`)
        console.log(`    missing: ${m.missing.join(', ')}`)
      }
      console.log('')
    }

    console.log('--- 按分类统计 ---')
    for (const [cat, stats] of Object.entries(summary.categories)) {
      console.log(`  ${cat}: ${stats.passed}/${stats.total} 通过 (${stats.failures} 差异)`)
    }
    console.log('='.repeat(60))

    expect(summary.totalCases).toBeGreaterThan(0)
  })
})

// ============================================================
// 辅助函数专项测试（纯函数，不依赖路由 baseline）
// ============================================================

describe('shouldAllowMemoryWrite', () => {
  it.each([
    ['记住我喜欢用 TypeScript', true],
    ['记下来我的地址是北京', true],
    ['添加记忆：我住在上海', true],
    ['保存到记忆：偏好中文', true],
    ['以后记得我不用 Python', true],
    ['查询我的记忆', false],
    ['我的偏好是什么', false],
    ['你好', false],
  ])('%s => %s', (query, expected) => {
    expect(shouldAllowMemoryWrite(query)).toBe(expected)
  })
})

describe('classifySelectionRequest', () => {
  it('无选区时返回 none', () => {
    expect(classifySelectionRequest('总结这段内容', noContext)).toBe('none')
  })

  it('选区总结返回 fast', () => {
    expect(classifySelectionRequest('总结这段内容', selectionContext)).toBe('fast')
  })

  it('选区翻译返回 fast', () => {
    expect(classifySelectionRequest('翻译成英文', selectionContext)).toBe('fast')
  })

  it('选区解释返回 fast', () => {
    expect(classifySelectionRequest('解释这段代码', selectionContext)).toBe('fast')
  })

  it('选区为什么返回 context', () => {
    expect(classifySelectionRequest('为什么这样写', selectionContext)).toBe('context')
  })

  it('选区对比前后文需要上下文', () => {
    expect(classifySelectionRequest('对比一下前后文', selectionContext)).toBe('context')
  })

  it('选区搜索返回 explicit_lookup', () => {
    expect(classifySelectionRequest('搜索文档中的相关内容', selectionContext)).toBe('explicit_lookup')
  })

  it('选区知识库返回 explicit_lookup', () => {
    expect(classifySelectionRequest('知识库里有没有这个', selectionContext)).toBe('explicit_lookup')
  })

  it('带选区检索知识库只要求知识库检索', () => {
    const decision = makeRoutingDecision('检索知识库相关内容', selectionContext)
    expect(decision.required).toContain('knowledge')
    expect(decision.required).not.toContain('selection_context')
    expect(decision.candidateTools).toContain('search_knowledge')
    expect(decision.candidateTools).not.toContain('read_selection_context')
  })

  it('普通问题（含"怎么"）返回 context', () => {
    // "怎么" 匹配 SELECTION_CONTEXT_RISK_PATTERN
    expect(classifySelectionRequest('今天天气怎么样', selectionContext)).toBe('context')
  })

  it('纯指代返回 none', () => {
    expect(classifySelectionRequest('这个', selectionContext)).toBe('none')
  })
})

describe('isImplicitEditContinuation', () => {
  it.each([
    ['再简洁些', true],
    ['继续改这个文件', true],
    ['更正式一点', true],
    ['稍微改一下', true],
    ['语气更柔和些', true],
    ['帮我总结一下', false],
    ['你好', false],
  ])('%s => %s', (query, expected) => {
    expect(isImplicitEditContinuation(query)).toBe(expected)
  })
})

describe('shouldIncludeFullDocumentContext', () => {
  it('整篇改写应返回 true', () => {
    expect(shouldIncludeFullDocumentContext('整篇改写这篇文章')).toBe(true)
  })

  it('全文润色应返回 true', () => {
    expect(shouldIncludeFullDocumentContext('全文润色一下')).toBe(true)
  })

  it('部分修改应返回 false', () => {
    expect(shouldIncludeFullDocumentContext('修改第一段')).toBe(false)
  })
})

describe('isLocalResearchIntent', () => {
  it.each([
    ['研究一下知识库里的技术方案', true],
    ['调研一下本地文档', true],
    ['综合一下我的笔记', true],
    ['根据知识库回答这个问题', true],
    ['资料里有没有关于部署的', true],
    ['结合我的笔记分析一下', true],
    ['总结一下', false],
    ['你好', false],
  ])('%s => %s', (query, expected) => {
    expect(isLocalResearchIntent(query)).toBe(expected)
  })
})

describe('isWebComparisonIntent', () => {
  it.each([
    ['联网验证一下知识库里的信息', true],
    ['和网上对比一下', true],
    ['查官网有没有更新', true],
    ['检查本地资料是否过时', true],
    ['搜索 React 最新特性', false],
    ['总结一下', false],
  ])('%s => %s', (query, expected) => {
    expect(isWebComparisonIntent(query)).toBe(expected)
  })
})

describe('isDocumentRewriteIntent', () => {
  it.each([
    ['润色这段文字', true],
    ['优化代码结构', true],
    ['调整文档格式', true],
    ['改成更正式的语气', true],
    ['重写这一段', true],
    ['扩写这部分内容', true],
    ['缩写这段话', true],
    ['替换文件中的旧内容', true],
    ['研究一下知识库', false],
    ['总结一下', false],
    ['你好', false],
  ])('%s => %s', (query, expected) => {
    expect(isDocumentRewriteIntent(query)).toBe(expected)
  })
})

describe('isFileSummaryIntent', () => {
  it('有文件标签且要求总结', () => {
    expect(isFileSummaryIntent('总结这个文件', fileContext)).toBe(true)
  })

  it('有文件标签且要求概述', () => {
    expect(isFileSummaryIntent('概述文档内容', fileContext)).toBe(true)
  })

  it('无文件标签时不应匹配', () => {
    expect(isFileSummaryIntent('总结这个文件', noContext)).toBe(false)
  })
})

describe('buildCandidateTools 工具映射', () => {
  it('memory 映射到 search_memory, list_memories', () => {
    expect(buildCandidateTools(['memory'])).toEqual(['search_memory', 'list_memories'])
  })

  it('knowledge 映射到 search_knowledge, list_database_contents', () => {
    expect(buildCandidateTools(['knowledge'])).toEqual(['search_knowledge', 'list_database_contents'])
  })

  it('web 映射到 web_search', () => {
    expect(buildCandidateTools(['web'])).toEqual(['web_search'])
  })

  it('time 映射到 get_current_time', () => {
    expect(buildCandidateTools(['time'])).toEqual(['get_current_time'])
  })

  it('file_write 映射到 list_current_edit_targets, replace_current_tab_text', () => {
    expect(buildCandidateTools(['file_write'])).toEqual(['list_current_edit_targets', 'replace_current_tab_text'])
  })

  it('action 只映射到三类高层行动提案工具', () => {
    expect(buildCandidateTools(['action'])).toEqual([
      'propose_save_reading_artifact',
      'propose_create_markdown_note',
      'propose_create_reading_reminder',
    ])
  })

  it('明确的阅读成果与提醒请求进入行动提案工具，不直接执行副作用', () => {
    const artifactDecision = makeRoutingDecision('把这份回答保存为阅读成果', { hasContextTags: true })
    expect(artifactDecision.mode).toBe('agent')
    expect(artifactDecision.candidates).toContain('action')
    expect(artifactDecision.candidateTools).toContain('propose_save_reading_artifact')

    const reminderDecision = makeRoutingDecision('创建阅读提醒，明天下午三点提醒我复习', {})
    expect(reminderDecision.mode).toBe('agent')
    expect(reminderDecision.candidates).toContain('action')
    expect(reminderDecision.candidateTools).toContain('propose_create_reading_reminder')
  })

  it('自然提醒表达稳定分配提醒提案与电脑时间工具', () => {
    for (const query of [
      '提醒我明天下午三点继续阅读',
      '创建提醒，30 分钟后继续阅读',
      '设置一个提醒，今晚九点复习本章',
      '添加一条提醒，后天上午十点阅读',
    ]) {
      const decision = makeRoutingDecision(query, {})
      expect(decision.mode, query).toBe('agent')
      expect(decision.candidates, query).toContain('action')
      expect(decision.candidateTools, query).toContain('get_current_time')
      expect(decision.candidateTools, query).toContain('propose_create_reading_reminder')
    }
  })

  it('file_read 映射到 read_context_file', () => {
    expect(buildCandidateTools(['file_read'])).toEqual(['read_context_file'])
  })

  it('selection_context 映射到 read_selection_context', () => {
    expect(buildCandidateTools(['selection_context'])).toEqual(['read_selection_context'])
  })
})

describe('isWriteTool / isReadTool', () => {
  it('replace_current_tab_text 是写入工具', () => {
    expect(isWriteTool('replace_current_tab_text')).toBe(true)
  })

  it('save_memory 是写入工具', () => {
    expect(isWriteTool('save_memory')).toBe(true)
  })

  it('search_knowledge 是读取工具', () => {
    expect(isReadTool('search_knowledge')).toBe(true)
  })

  it('web_search 是读取工具', () => {
    expect(isReadTool('web_search')).toBe(true)
  })

  it('replace_current_tab_text 不是读取工具', () => {
    expect(isReadTool('replace_current_tab_text')).toBe(false)
  })
})

// ============================================================
// 统一路由决策服务测试
// ============================================================

describe('makeRoutingDecision 路由决策服务', () => {
  it('普通问候应返回 direct 模式', () => {
    const decision = makeRoutingDecision('你好', {})
    expect(decision.mode).toBe('direct')
    expect(decision.reasonCodes).toContain('no_candidates')
    expect(decision.candidateTools).toEqual([])
  })

  it('单一弱关键词不应触发 Agent', () => {
    const decision = makeRoutingDecision('分析', {})
    expect(decision.mode).toBe('direct')
    expect(decision.reasonCodes).toContain('no_candidates')
  })

  it('强关键词应触发 Agent', () => {
    const decision = makeRoutingDecision('知识库', {})
    expect(decision.mode).toBe('agent')
    expect(decision.reasonCodes).toContain('strong_signal')
    expect(decision.candidates).toContain('knowledge')
  })

  it('多个弱关键词组合应触发 Agent（weak_combo）', () => {
    // "搜索" triggers web (weak), "文档" triggers knowledge (weak) → 2 different weak keywords
    // But "搜索" + "文档" also matches knowledge regex: /(查|查找|查询|搜索|...).*(文档|...)/i
    // So the actual reason is strong_signal from regex match
    const decision = makeRoutingDecision('搜索文档', {})
    expect(decision.mode).toBe('agent')
    expect(decision.reasonCodes).toContain('strong_signal')
  })

  it('forceAgent 手动覆盖应触发 Agent', () => {
    const decision = makeRoutingDecision('你好', {}, { forceAgent: true })
    expect(decision.mode).toBe('agent')
    expect(decision.reasonCodes).toContain('manual_override')
  })

  it('cancel_last_edit 应触发 Agent', () => {
    const decision = makeRoutingDecision('算了，不改了', {}, {
      messages: [{
        id: 'msg-1',
        parentId: null,
        role: 'assistant',
        content: '用户确认并应用了对文件 test.md 的修改。原文：旧内容 新文本：新内容',
        timestamp: Date.now(),
      }],
    })
    expect(decision.mode).toBe('agent')
    expect(decision.reasonCodes).toContain('cancel_last_edit')
  })

  it('显式记忆写入应添加 reason code', () => {
    const decision = makeRoutingDecision('记住我喜欢用 TypeScript', {})
    expect(decision.mode).toBe('agent')
    expect(decision.reasonCodes).toContain('explicit_memory_write')
    expect(decision.explicitMemoryWriteIntent).toBe(true)
  })

  it('selection 总结应返回 direct', () => {
    const decision = makeRoutingDecision('总结这段内容', {
      hasSelection: true,
      hasContextTags: true,
    })
    expect(decision.mode).toBe('direct')
    expect(decision.selectionRequestKind).toBe('fast')
  })

  it('selection 格式化改写应返回 agent', () => {
    const decision = makeRoutingDecision('格式化这段文字', {
      hasSelection: true,
      hasContextTags: true,
    })
    expect(decision.mode).toBe('agent')
    expect(decision.isDocumentRewrite).toBe(true)
  })

  it('应正确设置 answerInstruction', () => {
    const decision = makeRoutingDecision('研究一下知识库里的技术方案', {})
    expect(decision.isLocalResearch).toBe(true)
    expect(decision.answerInstruction).toBeTruthy()
  })

  it('reasonCodes 应包含所有触发原因', () => {
    // 强关键词 + 上下文标签
    const decision = makeRoutingDecision('知识库', {
      hasContextTags: true,
      hasOpenFile: true,
    }, {
      contextTagCount: 1,
    })
    expect(decision.mode).toBe('agent')
    expect(decision.reasonCodes.length).toBeGreaterThan(0)
  })
})

describe('shouldUseAgentMode 收紧弱信号', () => {
  it('单一弱词"文档"不再触发 Agent', () => {
    expect(shouldUseAgentMode('文档')).toBe(false)
  })

  it('单一弱词"分析"不再触发 Agent', () => {
    expect(shouldUseAgentMode('分析')).toBe(false)
  })

  it('单一弱词"最新"不再触发 Agent', () => {
    expect(shouldUseAgentMode('最新')).toBe(false)
  })

  it('单一弱词"修改"不再触发 Agent', () => {
    expect(shouldUseAgentMode('修改')).toBe(false)
  })

  it('强关键词"知识库"仍触发 Agent', () => {
    expect(shouldUseAgentMode('知识库')).toBe(true)
  })

  it('强关键词"联网搜索"仍触发 Agent', () => {
    expect(shouldUseAgentMode('联网搜索')).toBe(true)
  })

  it('多个弱词组合仍触发 Agent', () => {
    expect(shouldUseAgentMode('搜索文档')).toBe(true)
  })

  it('正则匹配仍触发 Agent', () => {
    expect(shouldUseAgentMode('现在几点了？')).toBe(true)
  })
})
