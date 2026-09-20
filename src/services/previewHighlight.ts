/**
 * 预览统一 DocumentRange 基础设施
 *
 * 设计原则：DOM 只负责显示与获取用户交互位置；搜索高亮、文本选区、
 * 复制与 AI 上下文等全文能力统一基于完整文档模型中的源码 offset Range。
 *
 * 1. DocumentRange 使用原始 Markdown 源码 offset（与块模型、全文搜索、
 *    预览内编辑、scrollToOffset 保持同一坐标系）。
 * 2. DOM ↔ 源码 offset 的映射通过渲染时注入的 `<span data-gm-src-from/to>`
 *    标注实现（数据来自 mdast/HAST 节点的 position），不做文本长度推测。
 * 3. KaTeX / Mermaid / ECharts 等渲染后无法可靠对应字符位置的区域不注入标注；
 *    普通语法高亮代码块依据模型 textSegments 恢复 token 映射，校验失败时降级，
 *    模型层 getTextForSourceRange 仍基于 textSegments 精确提取。
 * 4. 高亮视觉统一走 CSS Highlight API，按 (resource, blockId) 注册与注销，
 *    虚拟块卸载时仅移除对应 DOM Range，文档级状态不丢失。
 */

import { buildSourceTextBoundaries, findBlockIndexByOffset, type MarkdownPreviewModel, type PreviewTextSegment } from '@/services/markdownPreviewModel'

function alignTextOffsetToCodePointStart(text: string, offset: number): number {
  if (
    offset > 0
    && offset < text.length
    && text.charCodeAt(offset) >= 0xdc00
    && text.charCodeAt(offset) <= 0xdfff
    && text.charCodeAt(offset - 1) >= 0xd800
    && text.charCodeAt(offset - 1) <= 0xdbff
  ) return offset - 1
  return offset
}

function alignTextOffsetToCodePointEnd(text: string, offset: number): number {
  if (
    offset > 0
    && offset < text.length
    && text.charCodeAt(offset - 1) >= 0xd800
    && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00
    && text.charCodeAt(offset) <= 0xdfff
  ) return offset + 1
  return offset
}

/** 统一文档 Range：块 ID + 块内局部源码 offset（相对块 startOffset） */
export interface DocumentRange {
  startBlockId: string
  startOffset: number
  endBlockId: string
  endOffset: number
}

export interface DocumentRangeInfo {
  range: DocumentRange
  /** 起点块起始行 */
  startLine: number
  /** 终点块结束行 */
  endLine: number
}

/* ------------------------- 全局 offset ↔ DocumentRange ------------------------- */

/** 全局源码 offset → 块索引；gap（块间空行）归属前一块末尾 */
function findBlockIndexByOffsetClamped(model: MarkdownPreviewModel, offset: number): number {
  const direct = findBlockIndexByOffset(model, offset)
  if (direct >= 0) return direct
  const blocks = model.blocks
  if (blocks.length === 0) return -1
  if (offset < blocks[0].startOffset) return 0
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (offset >= blocks[i].endOffset) return i
  }
  return 0
}

export function buildDocumentRangeInfo(model: MarkdownPreviewModel, from: number, to: number): DocumentRangeInfo | null {
  if (to <= from || model.blocks.length === 0) return null
  const fromIndex = findBlockIndexByOffsetClamped(model, from)
  const toIndex = findBlockIndexByOffsetClamped(model, to)
  if (fromIndex < 0 || toIndex < 0) return null
  const fromBlock = model.blocks[fromIndex]
  const toBlock = model.blocks[toIndex]
  const startLocal = Math.max(0, Math.min(from - fromBlock.startOffset, fromBlock.endOffset - fromBlock.startOffset))
  const endLocal = Math.max(0, Math.min(to - toBlock.startOffset, toBlock.endOffset - toBlock.startOffset))
  return {
    range: {
      startBlockId: fromBlock.blockId,
      startOffset: startLocal,
      endBlockId: toBlock.blockId,
      endOffset: endLocal,
    },
    startLine: fromBlock.startLine,
    endLine: toBlock.endLine,
  }
}

/* ------------------------------ 渲染文本提取 ------------------------------ */

/**
 * 基于文档模型的 textSegments 提取 Range 内的渲染可见文本（块间以空行分隔）。
 * 与 DOM 是否挂载无关，虚拟化下可提取任意超长选区或全文。
 */
export function getTextForSourceRange(model: MarkdownPreviewModel, from: number, to: number): string {
  if (to <= from) return ''
  const parts: string[] = []
  for (const block of model.blocks) {
    if (block.endOffset <= from) continue
    if (block.startOffset >= to) break
    const blockParts: string[] = []
    for (const segment of block.textSegments) {
      if (segment.to <= from || segment.from >= to) continue
      let localStart = Math.max(0, from - segment.from)
      let localEnd = Math.min(segment.text.length, to - segment.from)
      if (segment.sourceBoundaries) {
        localStart = 0
        while (localStart < segment.text.length && segment.sourceBoundaries[localStart + 1] <= from) localStart += 1
        localEnd = localStart
        while (localEnd < segment.text.length && segment.sourceBoundaries[localEnd] < to) localEnd += 1
      }
      localStart = alignTextOffsetToCodePointStart(segment.text, localStart)
      localEnd = alignTextOffsetToCodePointEnd(segment.text, localEnd)
      if (localEnd > localStart) blockParts.push(segment.text.slice(localStart, localEnd))
    }
    parts.push(blockParts.join(''))
  }
  return parts.join('\n\n')
}

/** 双击选词：在 offset 所在 text segment 内按 Unicode 词边界扩展 */
export function findWordRangeAt(model: MarkdownPreviewModel, offset: number): { from: number; to: number } | null {
  for (const block of model.blocks) {
    if (offset < block.startOffset || offset > block.endOffset) continue
    for (const segment of block.textSegments) {
      if (offset < segment.from || offset > segment.to) continue
      let local = Math.max(0, Math.min(offset - segment.from, segment.text.length))
      if (segment.sourceBoundaries) {
        local = 0
        while (local < segment.text.length && segment.sourceBoundaries[local + 1] <= offset) local += 1
      }
      const before = /[\p{L}\p{N}_]*$/u.exec(segment.text.slice(0, local))?.[0].length ?? 0
      const after = /^[\p{L}\p{N}_]*/u.exec(segment.text.slice(local))?.[0].length ?? 0
      if (segment.sourceBoundaries) {
        return {
          from: segment.sourceBoundaries[local - before],
          to: segment.sourceBoundaries[local + after],
        }
      }
      return { from: segment.from + local - before, to: segment.from + local + after }
    }
    return null
  }
  return null
}

/* --------------------------- HAST 源码标注插件 --------------------------- */

interface AnnotatableHastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: AnnotatableHastNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

interface CodeTextLeaf {
  node: AnnotatableHastNode
  parent: AnnotatableHastNode
  index: number
}

interface CodeDisplaySegment {
  segment: PreviewTextSegment
  displayFrom: number
  displayTo: number
}

function normalizeCodeDisplaySegment(segment: PreviewTextSegment): PreviewTextSegment {
  if (!segment.text.includes('\r')) return segment
  const boundaries = [segment.from]
  let sourceOffset = 0
  let textOffset = 0
  while (sourceOffset < segment.text.length) {
    if (segment.text.startsWith('\r\n', sourceOffset)) {
      boundaries.push(segment.from + sourceOffset + 2)
      sourceOffset += 2
      textOffset += 1
      continue
    }
    if (segment.text[sourceOffset] === '\r') {
      boundaries.push(segment.from + sourceOffset + 1)
      sourceOffset += 1
      textOffset += 1
      continue
    }
    const codePoint = segment.text.codePointAt(sourceOffset)
    if (codePoint === undefined) break
    const length = String.fromCodePoint(codePoint).length
    for (let unit = 1; unit <= length; unit += 1) {
      boundaries.push(segment.from + sourceOffset + unit)
    }
    sourceOffset += length
    textOffset += length
  }
  const text = segment.text.replace(/\r\n?/g, '\n')
  if (boundaries.length !== textOffset + 1 || textOffset !== text.length) return segment
  return { ...segment, text, to: boundaries[boundaries.length - 1], sourceBoundaries: boundaries }
}

/**
 * rehype 插件工厂：把 HAST text 节点包裹为带源码 offset 的 span。
 * 普通语法高亮代码块可借助调用方传入的模型 textSegments 恢复 token 映射；
 * KaTeX / Mermaid / ECharts 等无法可靠对应源码的重建子树仍不猜测 offset，降级处理。
 * baseOffset 为该块渲染切片在全文中的起始 offset（整篇渲染传 0）。
 */
function resolveInlineCodeValueRange(
  source: string,
  from: number,
  to: number,
  value: string,
): { from: number; to: number } | null {
  const raw = source.slice(from, to)
  const fence = /^`+/.exec(raw)?.[0]
  if (!fence || !raw.endsWith(fence)) return null
  const contentStart = fence.length
  const contentEnd = raw.length - fence.length
  const content = raw.slice(contentStart, contentEnd)
  const valueStart = content.indexOf(value)
  if (valueStart >= 0) {
    const start = from + contentStart + valueStart
    return { from: start, to: start + value.length }
  }
  const boundaries = buildSourceTextBoundaries(source, from + contentStart, from + contentEnd, value)
  if (!boundaries) return null
  return { from: boundaries[0], to: boundaries[boundaries.length - 1] }
}

function collectCodeTextLeaves(node: AnnotatableHastNode, out: CodeTextLeaf[]): void {
  for (let index = 0; index < (node.children?.length ?? 0); index += 1) {
    const child = node.children![index]
    if (child.type === 'text' && typeof child.value === 'string' && child.value) {
      out.push({ node: child, parent: node, index })
      continue
    }
    if (child.type === 'element') collectCodeTextLeaves(child, out)
  }
}

function hasUnpositionedCodeText(node: AnnotatableHastNode): boolean {
  if (node.type === 'text') return typeof node.value === 'string' && node.value.length > 0 && !node.position
  return (node.children ?? []).some((child) => hasUnpositionedCodeText(child))
}

function createCodeTextMapping(
  node: AnnotatableHastNode,
  baseOffset: number,
  sourceSegments: PreviewTextSegment[],
): boolean {
  const positionFrom = node.position?.start?.offset
  const positionTo = node.position?.end?.offset
  if (typeof positionFrom !== 'number' || typeof positionTo !== 'number' || positionTo <= positionFrom) return false

  const globalFrom = baseOffset + positionFrom
  const globalTo = baseOffset + positionTo
  let low = 0
  let high = sourceSegments.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (sourceSegments[middle].to <= globalFrom) low = middle + 1
    else high = middle
  }
  const segments: PreviewTextSegment[] = []
  for (let index = low; index < sourceSegments.length; index += 1) {
    const segment = sourceSegments[index]
    if (segment.from >= globalTo) break
    if (segment.from >= globalFrom && segment.to <= globalTo && segment.to > segment.from && segment.text.length > 0) {
      segments.push(normalizeCodeDisplaySegment(segment))
    }
  }
  if (segments.length === 0) return false

  const displaySegments: CodeDisplaySegment[] = []
  let displayCursor = 0
  for (const segment of segments) {
    const displayFrom = displayCursor
    displayCursor += segment.text.length
    displaySegments.push({ segment, displayFrom, displayTo: displayCursor })
  }

  const leaves: CodeTextLeaf[] = []
  collectCodeTextLeaves(node, leaves)
  if (leaves.length === 0) return false
  const visible = leaves.map(({ node: leaf }) => leaf.value ?? '').join('')
  const expected = displaySegments.map(({ segment }) => segment.text).join('')
  if (visible !== expected && visible !== `${expected}\n`) return false

  const plans: Array<{ parent: AnnotatableHastNode; index: number; replacement: AnnotatableHastNode[] }> = []
  let leafCursor = 0
  let segmentIndex = 0
  for (const leaf of leaves) {
    const value = leaf.node.value ?? ''
    const leafEnd = leafCursor + value.length
    const replacement: AnnotatableHastNode[] = []
    let cursor = leafCursor
    while (cursor < leafEnd) {
      const segment = displaySegments[segmentIndex]
      if (!segment) {
        replacement.push({ type: 'text', value: value.slice(cursor - leafCursor) })
        cursor = leafEnd
        break
      }
      if (cursor >= segment.displayTo) {
        segmentIndex += 1
        continue
      }
      if (cursor < segment.displayFrom) return false
      const fragmentEnd = Math.min(leafEnd, segment.displayTo)
      const localStart = cursor - segment.displayFrom
      const localEnd = fragmentEnd - segment.displayFrom
      const boundaries = segment.segment.sourceBoundaries
        ? segment.segment.sourceBoundaries.slice(localStart, localEnd + 1)
        : undefined
      if (boundaries && boundaries.length !== localEnd - localStart + 1) return false
      const sourceFrom = boundaries?.[0] ?? segment.segment.from + localStart
      const sourceTo = boundaries?.[boundaries.length - 1] ?? segment.segment.from + localEnd
      replacement.push({
        type: 'element',
        tagName: 'span',
        properties: {
          dataGmSrcFrom: sourceFrom,
          dataGmSrcTo: sourceTo,
          ...(boundaries ? { dataGmSrcMap: JSON.stringify(boundaries) } : {}),
        },
        children: [{ type: 'text', value: value.slice(cursor - leafCursor, fragmentEnd - leafCursor) }],
      })
      cursor = fragmentEnd
      if (cursor >= segment.displayTo) segmentIndex += 1
    }
    plans.push({ parent: leaf.parent, index: leaf.index, replacement })
    leafCursor = leafEnd
  }

  for (const plan of plans) {
    plan.parent.children!.splice(plan.index, 1, ...plan.replacement)
    const insertedCount = plan.replacement.length - 1
    if (insertedCount !== 0) {
      for (const later of plans) {
        if (later.parent === plan.parent && later.index > plan.index) later.index += insertedCount
      }
    }
  }
  return true
}

export function createSourceOffsetAnnotator(baseOffset: number, source?: string, sourceSegments?: PreviewTextSegment[]) {
  return function annotator() {
    return function transform(tree: AnnotatableHastNode) {
      const visit = (node: AnnotatableHastNode): void => {
        if (node.tagName === 'code' && sourceSegments && hasUnpositionedCodeText(node)) {
          if (createCodeTextMapping(node, baseOffset, sourceSegments)) return
        }
        if (!node.children || node.children.length === 0) return
        for (let i = 0; i < node.children.length; i += 1) {
          const child = node.children[i]
          if (child.type === 'text' && typeof child.value === 'string' && child.value) {
            const positionFrom = child.position?.start?.offset
            const positionTo = child.position?.end?.offset
            if (typeof positionFrom !== 'number' || typeof positionTo !== 'number') continue
            const valueRange = node.tagName === 'code' && source
              ? resolveInlineCodeValueRange(source, positionFrom, positionTo, child.value)
              : null
            const from = valueRange?.from ?? positionFrom
            const to = valueRange?.to ?? positionTo
            const sourceBoundaries = source
              ? buildSourceTextBoundaries(source, from, to, child.value)
              : null
            if (source && source.slice(from, to) !== child.value && !sourceBoundaries) continue
            node.children[i] = {
              type: 'element',
              tagName: 'span',
              properties: {
                dataGmSrcFrom: baseOffset + from,
                dataGmSrcTo: baseOffset + to,
                ...(sourceBoundaries
                  ? { dataGmSrcMap: JSON.stringify(sourceBoundaries.map((offset) => baseOffset + offset)) }
                  : {}),
              },
              children: [child],
            }
          } else {
            // SVG 的文字必须保持为 SVG 原生文本节点；HTML `<span>` 会被
            // WebView 当作 SVG 子元素，放在 `<text>`/`<tspan>` 中后不再绘制。
            if (child.type === 'element' && child.tagName === 'svg') continue
            visit(child)
          }
        }
      }
      visit(tree)
    }
  }
}

export interface ReadingMarkHitRange {
  id: string
  from: number
  to: number
}

/**
 * 在已有源码 offset span 内拆出 ReadingMark 命中片段。
 * 这只增加交互数据属性，视觉仍由 CSS Highlight Registry 负责。
 */
export function createReadingMarkHitRegionAnnotator(ranges: ReadingMarkHitRange[]) {
  const sorted = ranges
    .filter((range) => range.to > range.from && range.id)
    .slice()
    .sort((left, right) => left.from - right.from || left.to - right.to || left.id.localeCompare(right.id))
  const maxEndPrefix: number[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    maxEndPrefix[index] = Math.max(sorted[index].to, maxEndPrefix[index - 1] ?? Number.NEGATIVE_INFINITY)
  }
  return function annotator() {
    return function transform(tree: AnnotatableHastNode) {
      const visit = (node: AnnotatableHastNode): void => {
        if (!node.children || node.children.length === 0) return
        const nextChildren: AnnotatableHastNode[] = []
        for (const child of node.children) {
          const properties = child.properties
          const childFrom = Number(properties?.dataGmSrcFrom)
          const childTo = Number(properties?.dataGmSrcTo)
          const textChild = child.children?.length === 1 && child.children[0].type === 'text' ? child.children[0] : null
          if (child.type !== 'element' || child.tagName !== 'span' || !properties || !textChild
            || !Number.isFinite(childFrom) || !Number.isFinite(childTo) || childTo <= childFrom
            || sorted.length === 0) {
            visit(child)
            nextChildren.push(child)
            continue
          }
          const text = textChild.value ?? ''
          if (!text) {
            nextChildren.push(child)
            continue
          }
          let low = 0
          let high = sorted.length
          while (low < high) {
            const middle = (low + high) >> 1
            if (maxEndPrefix[middle] <= childFrom) low = middle + 1
            else high = middle
          }
          const first = low
          const relevant: ReadingMarkHitRange[] = []
          for (let index = first; index < sorted.length && sorted[index].from < childTo; index += 1) {
            const range = sorted[index]
            if (range.to > childFrom) relevant.push(range)
          }
          if (relevant.length === 0) {
            nextChildren.push(child)
            continue
          }
          let boundaries: number[] | undefined
          const rawMap = properties.dataGmSrcMap
          if (typeof rawMap === 'string') {
            try {
              const parsed = JSON.parse(rawMap) as unknown
              if (Array.isArray(parsed) && parsed.length === text.length + 1) {
                const values = parsed.map((value) => Number(value))
                if (values.every((value) => Number.isFinite(value))) boundaries = values
              }
            } catch {
              boundaries = undefined
            }
          }
          const sourceAt = (index: number) => boundaries?.[index] ?? childFrom + index
          const cuts = new Set<number>([0, text.length])
          const boundaryIndexes = new Map<number, number>()
          for (let index = 0; index <= text.length; index += 1) boundaryIndexes.set(sourceAt(index), index)
          for (const range of relevant) {
            const start = boundaryIndexes.get(range.from)
            const end = boundaryIndexes.get(range.to)
            if (start !== undefined) cuts.add(start)
            if (end !== undefined) cuts.add(end)
          }
          const orderedCuts = [...cuts].sort((left, right) => left - right)
          const fragments: AnnotatableHastNode[] = []
          for (let index = 0; index < orderedCuts.length - 1; index += 1) {
            const start = orderedCuts[index]
            const end = orderedCuts[index + 1]
            if (end <= start) continue
            const fragmentFrom = sourceAt(start)
            const fragmentTo = sourceAt(end)
            const ids = relevant
              .filter((range) => range.from < fragmentTo && range.to > fragmentFrom)
              .map((range) => range.id)
            const fragmentProperties: Record<string, unknown> = { ...properties }
            fragmentProperties.dataGmSrcFrom = fragmentFrom
            fragmentProperties.dataGmSrcTo = fragmentTo
            if (boundaries) fragmentProperties.dataGmSrcMap = JSON.stringify(boundaries.slice(start, end + 1))
            if (ids.length > 0) fragmentProperties.dataGmReadingMarkId = ids.join(',')
            else delete fragmentProperties.dataGmReadingMarkId
            fragments.push({
              ...child,
              properties: fragmentProperties,
              children: [{ ...textChild, value: text.slice(start, end) }],
            })
          }
          if (fragments.length > 0) nextChildren.push(...fragments)
          else nextChildren.push(child)
        }
        node.children = nextChildren
      }
      visit(tree)
    }
  }
}

/* ---------------------------- DOM ↔ 源码 offset ---------------------------- */

export interface AnnotatedTextNode {
  node: Text
  from: number
  to: number
  sourceBoundaries?: number[]
}

function readSourceBoundaries(span: Element, textLength: number): number[] | undefined {
  const raw = span.getAttribute('data-gm-src-map')
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== textLength + 1) return undefined
    const boundaries = parsed.map((value) => Number(value))
    if (boundaries.some((value) => !Number.isFinite(value))) return undefined
    for (let index = 1; index < boundaries.length; index += 1) {
      if (boundaries[index] < boundaries[index - 1]) return undefined
    }
    return boundaries
  } catch {
    return undefined
  }
}

/** 收集容器内所有带源码标注的 text 节点（文档顺序） */
export function collectAnnotatedTextNodes(root: Element): AnnotatedTextNode[] {
  const out: AnnotatedTextNode[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode()) !== null) {
    const parent = node.parentElement
    if (!parent) continue
    const from = parent.getAttribute('data-gm-src-from')
    if (from === null) continue
    const to = Number(parent.getAttribute('data-gm-src-to'))
    const textLength = node.textContent?.length ?? 0
    out.push({ node: node as Text, from: Number(from), to, sourceBoundaries: readSourceBoundaries(parent, textLength) })
  }
  return out
}

/** DOM 文本位置（caret）→ 全局源码 offset；无标注返回 null */
export function domPointToSourceOffset(node: Node, offset: number): number | null {
  if (node instanceof Text) {
    const span = node.parentElement
    const fromAttr = span?.getAttribute('data-gm-src-from')
    if (!span || fromAttr === null) return null
    const from = Number(fromAttr)
    const to = Number(span.getAttribute('data-gm-src-to'))
    const textLength = node.textContent?.length ?? 0
    const local = Math.max(0, Math.min(offset, textLength))
    const sourceBoundaries = readSourceBoundaries(span, textLength)
    if (sourceBoundaries) return sourceBoundaries[local]
    return Math.max(from, Math.min(from + local, to))
  }
  if (node instanceof Element) {
    // caret 落在元素边界：优先取后一个子节点起点，否则前一个子节点终点
    const next = node.childNodes[offset]
    if (next instanceof Text) {
      const value = domPointToSourceOffset(next, 0)
      if (value !== null) return value
    }
    const prev = offset > 0 ? node.childNodes[offset - 1] : null
    if (prev instanceof Text) {
      const value = domPointToSourceOffset(prev, prev.textContent?.length ?? 0)
      if (value !== null) return value
    }
    if (next instanceof Element) {
      const first = collectAnnotatedTextNodes(next)[0]
      if (first) return first.from
    }
    if (prev instanceof Element) {
      const nodes = collectAnnotatedTextNodes(prev)
      const last = nodes[nodes.length - 1]
      if (last) return last.to
    }
  }
  return null
}

/**
 * 源码区间 → 该容器内的 DOM Range 列表（用于 CSS Highlight）。
 * 只处理与区间相交的标注 text；等长映射并 clamp 到文本长度。
 */
export function buildDomRangesForSourceRange(root: Element, from: number, to: number): globalThis.Range[] {
  if (to <= from) return []
  const ranges: globalThis.Range[] = []
  for (const entry of collectAnnotatedTextNodes(root)) {
    if (entry.to <= from || entry.from >= to) continue
    const textLength = entry.node.textContent?.length ?? 0
    let localStart = Math.max(0, Math.min(from - entry.from, textLength))
    let localEnd = Math.max(localStart, Math.min(to - entry.from, textLength))
    if (entry.sourceBoundaries) {
      localStart = 0
      while (localStart < textLength && entry.sourceBoundaries[localStart + 1] <= from) localStart += 1
      localEnd = localStart
      while (localEnd < textLength && entry.sourceBoundaries[localEnd] < to) localEnd += 1
    }
    localStart = alignTextOffsetToCodePointStart(entry.node.textContent ?? '', localStart)
    localEnd = alignTextOffsetToCodePointEnd(entry.node.textContent ?? '', localEnd)
    if (localEnd <= localStart) continue
    const range = document.createRange()
    range.setStart(entry.node, localStart)
    range.setEnd(entry.node, localEnd)
    ranges.push(range)
  }
  return ranges
}

/* ------------------------------ Highlight Registry ------------------------------ */

export type PreviewHighlightKind = 'search' | 'searchActive' | 'selection' | 'sourceReveal' | 'markYellow' | 'markGreen' | 'markBlue' | 'markPink' | 'markFocus'

const HIGHLIGHT_NAMES: Record<PreviewHighlightKind, string> = {
  search: 'search-highlight',
  searchActive: 'search-highlight-active',
  selection: 'preview-selection',
  sourceReveal: 'source-reveal-highlight',
  markYellow: 'reading-mark-yellow',
  markGreen: 'reading-mark-green',
  markBlue: 'reading-mark-blue',
  markPink: 'reading-mark-pink',
  markFocus: 'reading-mark-focus',
}

const HIGHLIGHT_KINDS: PreviewHighlightKind[] = ['search', 'searchActive', 'selection', 'sourceReveal', 'markYellow', 'markGreen', 'markBlue', 'markPink', 'markFocus']

interface BlockHighlightEntry {
  search: globalThis.Range[]
  searchActive: globalThis.Range[]
  selection: globalThis.Range[]
  sourceReveal: globalThis.Range[]
  markYellow: globalThis.Range[]
  markGreen: globalThis.Range[]
  markBlue: globalThis.Range[]
  markPink: globalThis.Range[]
  markFocus: globalThis.Range[]
}

/**
 * 集中管理预览高亮：按 (resource, blockId) 组织 DOM Range，
 * 对应 CSS Highlight 实例常驻，块级更新时增量增删 Range。
 * 虚拟块卸载 → removeBlock；重新挂载 → syncBlock，高亮自动恢复。
 * 环境不支持 CSS Highlight API（如 JSDOM）时所有操作为 no-op。
 */
class PreviewHighlightRegistry {
  private highlights = new Map<PreviewHighlightKind, Highlight>()
  private blocks = new Map<string, BlockHighlightEntry>()

  private ensureHighlight(kind: PreviewHighlightKind): Highlight | null {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return null
    let highlight = this.highlights.get(kind)
    if (!highlight) {
      highlight = new Highlight()
      CSS.highlights.set(HIGHLIGHT_NAMES[kind], highlight)
      this.highlights.set(kind, highlight)
    }
    return highlight
  }

  syncBlock(resource: string, blockId: string, next: Partial<Record<PreviewHighlightKind, globalThis.Range[]>>): void {
    const key = `${resource}:${blockId}`
    const entry = this.blocks.get(key) ?? { search: [], searchActive: [], selection: [], sourceReveal: [], markYellow: [], markGreen: [], markBlue: [], markPink: [], markFocus: [] }
    let hasContent = false
    for (const kind of HIGHLIGHT_KINDS) {
      const oldRanges = entry[kind]
      const newRanges = next[kind] ?? oldRanges
      if (oldRanges === newRanges) {
        hasContent = hasContent || newRanges.length > 0
        continue
      }
      const highlight = this.ensureHighlight(kind)
      if (highlight) {
        for (const range of oldRanges) highlight.delete(range)
        for (const range of newRanges) highlight.add(range)
      }
      entry[kind] = newRanges
      hasContent = hasContent || newRanges.length > 0
    }
    if (hasContent) this.blocks.set(key, entry)
    else this.blocks.delete(key)
  }

  removeBlock(resource: string, blockId: string): void {
    this.syncBlock(resource, blockId, { search: [], searchActive: [], selection: [], sourceReveal: [], markYellow: [], markGreen: [], markBlue: [], markPink: [], markFocus: [] })
  }

  /** 移除指定 resource 中不在 blockIds 集合内的块高亮（虚拟化卸载清理） */
  removeBlocksNotIn(resource: string, blockIds: Set<string>): void {
    const stale: string[] = []
    for (const key of this.blocks.keys()) {
      const separator = key.indexOf(':')
      if (key.slice(0, separator) !== resource) continue
      if (!blockIds.has(key.slice(separator + 1))) stale.push(key)
    }
    for (const key of stale) {
      const entry = this.blocks.get(key)
      this.blocks.delete(key)
      if (!entry) continue
      for (const kind of HIGHLIGHT_KINDS) {
        const highlight = this.ensureHighlight(kind)
        if (!highlight) continue
        for (const range of entry[kind]) highlight.delete(range)
      }
    }
  }

  /** 清空指定 resource 的全部高亮（文档切换 / 实例卸载） */
  clearResource(resource: string): void {
    const keys: string[] = []
    for (const key of this.blocks.keys()) {
      const separator = key.indexOf(':')
      if (key.slice(0, separator) === resource) keys.push(key)
    }
    for (const key of keys) {
      const entry = this.blocks.get(key)
      this.blocks.delete(key)
      if (!entry) continue
      for (const kind of HIGHLIGHT_KINDS) {
        const highlight = this.ensureHighlight(kind)
        if (!highlight) continue
        for (const range of entry[kind]) highlight.delete(range)
      }
    }
  }

  /** 清空某种高亮（搜索关闭）；不指定 resource 时清空所有实例 */
  clearKind(kind: PreviewHighlightKind, resource?: string): void {
    const keys: string[] = []
    for (const key of this.blocks.keys()) {
      const separator = key.indexOf(':')
      if (resource && key.slice(0, separator) !== resource) continue
      keys.push(key)
    }
    for (const key of keys) {
      const entry = this.blocks.get(key)
      if (!entry) continue
      const ranges = entry[kind]
      if (ranges.length === 0) continue
      const highlight = this.ensureHighlight(kind)
      if (highlight) {
        for (const range of ranges) highlight.delete(range)
      }
      entry[kind] = []
      const hasContent = HIGHLIGHT_KINDS.some((k) => entry[k].length > 0)
      if (!hasContent) this.blocks.delete(key)
    }
  }
}

export const previewHighlightRegistry = new PreviewHighlightRegistry()
