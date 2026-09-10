/**
 * 路由规则与 Prompt 版本元数据（PROMPT-01）。
 *
 * 契约：
 * - 只包含常量与纯函数，不读写用户设置、聊天记录、标签页或数据库；
 *   版本号升级本身不改变任何用户数据。
 * - Prompt 指纹用于评测基线追溯：同版本代码必须产生同指纹，
 *   Prompt 文本任何变化都会反映到指纹，评测结果必须连同指纹一起记录。
 * - A/B 指标只在同模型、同配置指纹下可比较；配置不同时禁止归因 Prompt 收益。
 */

import {
  BASE_SYSTEM_PROMPT,
  CONTEXT_SAFETY_PROMPT,
  SELECTION_DIRECT_ANSWER_PROMPT,
  CUSTOM_PROMPT_POLICY,
} from './systemPrompts'
import {
  LOCAL_RESEARCH_ANSWER_PROMPT,
  WEB_COMPARISON_ANSWER_PROMPT,
  FILE_SUMMARY_ANSWER_PROMPT,
  SECTION_READING_ANSWER_PROMPT,
} from '@/services/agent/answerInstructions'

/** 路由规则版本：修改路由判定逻辑（intentDetector/toolSelector/routingService）时递增。 */
export const ROUTING_RULES_VERSION = 'v1'

/** Prompt 版本：修改任何系统 Prompt 或回答指令文本时递增。 */
export const PROMPT_VERSION = 'v2'

/** 无依赖确定性哈希（FNV-1a 32 位，hex 输出），用于内容指纹。 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export interface PromptVersionDescriptor {
  promptVersion: string
  routingRulesVersion: string
  /** 各 Prompt 段的独立指纹，键为段名。 */
  segmentFingerprints: Record<string, string>
  /** 全部 Prompt 段合成指纹。 */
  combinedFingerprint: string
}

/** 评测口径中的模型配置快照；A/B 对比要求两侧指纹一致。 */
export interface EvaluationConfig {
  model: string
  temperature: number
  topP: number
  maxContextLength: number
  streaming: boolean
}

/** 离线确定性评测固定配置：不调用真实模型，仅用于路由/Prompt/解析器的可重复基线。 */
export const OFFLINE_DETERMINISTIC_CONFIG: EvaluationConfig = {
  model: 'offline-deterministic-baseline',
  temperature: 0,
  topP: 1,
  maxContextLength: 0,
  streaming: false,
}

export function getEvaluationConfigFingerprint(config: EvaluationConfig): string {
  return hashText(
    [
      config.model,
      config.temperature,
      config.topP,
      config.maxContextLength,
      config.streaming,
    ].join('|'),
  )
}

/** 收集当前代码中的全部 Prompt 段并生成版本描述符。 */
export function getPromptVersionDescriptor(): PromptVersionDescriptor {
  const segments: Record<string, string> = {
    baseSystemPrompt: BASE_SYSTEM_PROMPT,
    contextSafetyPrompt: CONTEXT_SAFETY_PROMPT,
    selectionDirectAnswerPrompt: SELECTION_DIRECT_ANSWER_PROMPT,
    customPromptPolicy: CUSTOM_PROMPT_POLICY,
    localResearchAnswerPrompt: LOCAL_RESEARCH_ANSWER_PROMPT,
    webComparisonAnswerPrompt: WEB_COMPARISON_ANSWER_PROMPT,
    fileSummaryAnswerPrompt: FILE_SUMMARY_ANSWER_PROMPT,
    sectionReadingAnswerPrompt: SECTION_READING_ANSWER_PROMPT,
  }

  const segmentFingerprints: Record<string, string> = {}
  for (const [name, content] of Object.entries(segments)) {
    segmentFingerprints[name] = hashText(content)
  }

  const combinedFingerprint = hashText(
    Object.entries(segments)
      .map(([name, content]) => `${name}:${hashText(content)}`)
      .join('\n'),
  )

  return {
    promptVersion: PROMPT_VERSION,
    routingRulesVersion: ROUTING_RULES_VERSION,
    segmentFingerprints,
    combinedFingerprint,
  }
}

/** A/B 评测中的一个变体快照：配置 + Prompt 版本描述符。 */
export interface PromptVariantSnapshot {
  label: string
  config: EvaluationConfig
  descriptor: PromptVersionDescriptor
}

export type PromptVariantComparison =
  | {
      comparable: true
      configFingerprintMatch: boolean
      promptChanged: boolean
      changedSegments: string[]
    }
  | {
      comparable: false
      reason: string
      configFingerprintA: string
      configFingerprintB: string
    }

/**
 * 比较两个评测变体。
 *
 * 规则：模型配置指纹不同 → 不可比较（禁止跨配置归因 Prompt 收益）；
 * 配置一致时，报告 Prompt 是否变化以及变化的段名列表。
 */
export function comparePromptVariants(
  a: PromptVariantSnapshot,
  b: PromptVariantSnapshot,
): PromptVariantComparison {
  const fingerprintA = getEvaluationConfigFingerprint(a.config)
  const fingerprintB = getEvaluationConfigFingerprint(b.config)
  if (fingerprintA !== fingerprintB) {
    return {
      comparable: false,
      reason: 'evaluation config fingerprints differ; prompt attribution across configs is forbidden',
      configFingerprintA: fingerprintA,
      configFingerprintB: fingerprintB,
    }
  }

  const changedSegments: string[] = []
  const segmentNames = new Set([
    ...Object.keys(a.descriptor.segmentFingerprints),
    ...Object.keys(b.descriptor.segmentFingerprints),
  ])
  for (const name of segmentNames) {
    if (a.descriptor.segmentFingerprints[name] !== b.descriptor.segmentFingerprints[name]) {
      changedSegments.push(name)
    }
  }

  return {
    comparable: true,
    configFingerprintMatch: true,
    promptChanged: changedSegments.length > 0,
    changedSegments,
  }
}
