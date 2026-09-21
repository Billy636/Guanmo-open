import type { MonacoModelMetric, RuntimeMetric } from '@/services/perfTypes'
import type { ViewMode } from '@/stores/editorStore'

type WeakNodeRef = { deref: () => Node | undefined }
type WeakRefConstructor = new (value: Node) => WeakNodeRef

interface MonacoModelLike {
  uri?: { toString(): string }
  getValueLength(): number
  getLineCount(): number
  isDisposed?(): boolean
  isAttachedToEditor?(): boolean
  getAllDecorations?(): unknown[]
}

interface MonacoGlobal {
  editor?: {
    getModels?(): MonacoModelLike[]
    getModelMarkers?(filter: Record<string, never>): unknown[]
  }
}

const native = {
  setTimeout: window.setTimeout.bind(window),
  clearTimeout: window.clearTimeout.bind(window),
  setInterval: window.setInterval.bind(window),
  clearInterval: window.clearInterval.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  createObjectURL: URL.createObjectURL.bind(URL),
  revokeObjectURL: URL.revokeObjectURL.bind(URL),
  addEventListener: EventTarget.prototype.addEventListener,
  removeEventListener: EventTarget.prototype.removeEventListener,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
}

/** Categorize an EventTarget for listener accounting. */
function categorizeTarget(target: EventTarget): 'window' | 'document' | 'dom' | 'unknown' {
  if (target === window) return 'window'
  if (target === document) return 'document'
  if (target instanceof Node) return 'dom'
  return 'unknown'
}

/**
 * Key for deduplicating listener registrations.
 * Captures target+type+listener+capture so that:
 * - Same (target,type,listener,capture) is counted once
 * - Different capture flags count separately
 * - Options-object differences with same effective config are collapsed
 */
function listenerKey(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  capture: boolean,
): string {
  // Use a numeric ID per target to avoid holding strong refs in the key
  let id = targetIds.get(target)
  if (id === undefined) {
    id = nextTargetId++
    targetIds.set(target, id)
  }
  return `${id}:${type}:${listenerId(listener)}:${capture ? '1' : '0'}`
}

function listenerCapture(options?: boolean | AddEventListenerOptions): boolean {
  return typeof options === 'boolean' ? options : Boolean(options?.capture)
}

function listenerId(listener: EventListenerOrEventListenerObject): string {
  if (typeof listener === 'function') return `fn:${listenerPtr(listener)}`
  return `obj:${listenerPtr(listener)}`
}

// Use a WeakMap to assign stable numeric IDs to targets without preventing GC.
const targetIds = new WeakMap<EventTarget, number>()
let nextTargetId = 1

function listenerPtr(listener: EventListenerOrEventListenerObject): number {
  // Return a stable pointer-like ID for function references.
  // For function listeners, use the function itself as key in a WeakMap-like structure.
  // Since functions can't be WeakMap keys, we use a global Map and clean up on remove.
  if (typeof listener === 'function') {
    let id = functionIds.get(listener)
    if (id === undefined) {
      id = nextFunctionId++
      functionIds.set(listener, id)
    }
    return id
  }
  // For object listeners, use a similar approach
  let id = objectIds.get(listener)
  if (id === undefined) {
    id = nextFunctionId++
    objectIds.set(listener, id)
  }
  return id
}

const functionIds = new WeakMap<EventListenerOrEventListenerObject, number>()
let nextFunctionId = 1
const objectIds = new WeakMap<EventListenerOrEventListenerObject, number>()

class RuntimeResourceTracker {
  private installed = false
  private timeouts = new Set<number>()
  private intervals = new Set<number>()
  private rafs = new Set<number>()
  private objectUrls = new Set<string>()

  // Experimental: registrations without an explicit remove cannot be observed after GC.
  // Store no target/listener references here, so tracking never prevents their collection.
  private listenerRegistry = new Map<string, ReturnType<typeof categorizeTarget>>()
  private listenerCount = 0
  private listenerWindowCount = 0
  private listenerDocumentCount = 0
  private listenerDomCount = 0
  private listenerUnknownCount = 0

  private mutationObserverCount = 0
  private resizeObserverCount = 0
  private intersectionObserverCount = 0

  // Detached DOM: only store WeakRefs, never strong refs
  private detachedRefs: WeakNodeRef[] = []
  private detachObserver: MutationObserver | null = null

  private fpsFrames: number[] = []
  private fpsRaf: number | null = null
  private lastFrameAt = 0
  private longTaskObserver: PerformanceObserver | null = null
  private longTaskCount = 0
  private longTaskTotalDurationMs = 0
  private longTaskMaxDurationMs = 0
  private lastLongTaskAt: number | null = null
  private lastLongTaskMode: ViewMode | null = null
  private lastLongTaskUserAction: string | null = null
  private currentMode: () => ViewMode = () => 'edit'
  private lastUserAction: string | null = null
  private rememberActionHandler: ((event: Event) => void) | null = null
  private lastDomNodeCount = 0
  private lastDetachedDomNodes = 0
  private lastMonacoMetrics = {
    monacoModelCount: 0,
    monacoModelTotalChars: 0,
    monacoEditorInstanceCount: 0,
    monacoDiffEditorInstanceCount: 0,
    monacoDecorationCount: 0,
    monacoMarkerCount: 0,
    monacoModels: [] as MonacoModelMetric[],
  }

  // Document context sources (injected from app stores)
  private getActiveDocumentCount: () => number = () => 0
  private getActiveDocumentCharCount: () => number = () => 0
  private getTotalOpenDocumentCharCount: () => number = () => 0
  private getActiveDocumentLineCount: () => number = () => 0
  private getPreviewInstanceCount: () => number = () => 0
  private getEditorInstanceCount: () => number = () => 0
  private getAiPanelOpen: () => boolean = () => false
  private getIsFullscreen: () => boolean = () => false

  install(getCurrentMode: () => ViewMode) {
    if (!import.meta.env.DEV || this.installed) return
    this.installed = true
    this.currentMode = getCurrentMode
    this.installTimers()
    this.installEventListeners()
    this.installObservers()
    this.installObjectUrls()
    this.startFps()
    this.startLongTasks()
  }

  setDocumentContextSources(sources: {
    getActiveDocumentCount: () => number
    getActiveDocumentCharCount: () => number
    getTotalOpenDocumentCharCount: () => number
    getActiveDocumentLineCount: () => number
    getPreviewInstanceCount: () => number
    getEditorInstanceCount: () => number
    getAiPanelOpen: () => boolean
    getIsFullscreen: () => boolean
  }) {
    this.getActiveDocumentCount = sources.getActiveDocumentCount
    this.getActiveDocumentCharCount = sources.getActiveDocumentCharCount
    this.getTotalOpenDocumentCharCount = sources.getTotalOpenDocumentCharCount
    this.getActiveDocumentLineCount = sources.getActiveDocumentLineCount
    this.getPreviewInstanceCount = sources.getPreviewInstanceCount
    this.getEditorInstanceCount = sources.getEditorInstanceCount
    this.getAiPanelOpen = sources.getAiPanelOpen
    this.getIsFullscreen = sources.getIsFullscreen
  }

  private installTimers() {
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      let id = 0
      const wrapped = (...callbackArgs: unknown[]) => {
        this.timeouts.delete(id)
        if (typeof handler === 'function') handler(...callbackArgs)
        else Function(handler)()
      }
      id = native.setTimeout(wrapped, timeout, ...args)
      this.timeouts.add(id)
      return id
    }) as typeof window.setTimeout
    window.clearTimeout = ((id?: number) => {
      if (typeof id === 'number') this.timeouts.delete(id)
      native.clearTimeout(id)
    }) as typeof window.clearTimeout
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = native.setInterval(handler, timeout, ...args)
      this.intervals.add(id)
      return id
    }) as typeof window.setInterval
    window.clearInterval = ((id?: number) => {
      if (typeof id === 'number') this.intervals.delete(id)
      native.clearInterval(id)
    }) as typeof window.clearInterval
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      let id = 0
      id = native.requestAnimationFrame((time) => {
        this.rafs.delete(id)
        callback(time)
      })
      this.rafs.add(id)
      return id
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = ((id: number) => {
      this.rafs.delete(id)
      native.cancelAnimationFrame(id)
    }) as typeof window.cancelAnimationFrame
  }

  private installEventListeners() {
    const recordAdd = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) => {
      const key = listenerKey(target, type, listener, capture)
      if (!this.listenerRegistry.has(key)) {
        const category = categorizeTarget(target)
        this.listenerRegistry.set(key, category)
        this.listenerCount += 1
        this.incrementCategory(category)
      }
    }
    const recordRemove = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) => {
      const key = listenerKey(target, type, listener, capture)
      const category = this.listenerRegistry.get(key)
      if (category) {
        this.listenerRegistry.delete(key)
        this.listenerCount -= 1
        this.decrementCategory(category)
      }
    }
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (listener) recordAdd(this, type, listener, listenerCapture(options))
      native.addEventListener.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (listener) recordRemove(this, type, listener, listenerCapture(options))
      native.removeEventListener.call(this, type, listener, options)
    }

    const rememberAction = (event: Event) => {
      const target = event.target instanceof Element
        ? event.target.tagName.toLowerCase()
        : 'window'
      this.lastUserAction = `${event.type}:${target}`.slice(0, 120)
    }
    this.rememberActionHandler = rememberAction
    for (const type of ['click', 'keydown', 'pointerdown']) {
      native.addEventListener.call(window, type, rememberAction, { capture: true, passive: true })
    }
  }

  uninstall() {
    if (!this.installed) return
    this.installed = false
    if (this.fpsRaf !== null) native.cancelAnimationFrame(this.fpsRaf)
    this.fpsRaf = null
    this.longTaskObserver?.disconnect()
    this.longTaskObserver = null
    this.detachObserver?.disconnect()
    this.detachObserver = null
    if (this.rememberActionHandler) {
      for (const type of ['click', 'keydown', 'pointerdown']) {
        native.removeEventListener.call(window, type, this.rememberActionHandler, { capture: true })
      }
      this.rememberActionHandler = null
    }
    window.setTimeout = native.setTimeout as typeof window.setTimeout
    window.clearTimeout = native.clearTimeout as typeof window.clearTimeout
    window.setInterval = native.setInterval as typeof window.setInterval
    window.clearInterval = native.clearInterval as typeof window.clearInterval
    window.requestAnimationFrame = native.requestAnimationFrame as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = native.cancelAnimationFrame as typeof window.cancelAnimationFrame
    EventTarget.prototype.addEventListener = native.addEventListener
    EventTarget.prototype.removeEventListener = native.removeEventListener
    window.MutationObserver = native.MutationObserver
    window.ResizeObserver = native.ResizeObserver
    window.IntersectionObserver = native.IntersectionObserver
    URL.createObjectURL = native.createObjectURL as typeof URL.createObjectURL
    URL.revokeObjectURL = native.revokeObjectURL as typeof URL.revokeObjectURL
    this.listenerRegistry.clear()
    this.listenerCount = 0
    this.listenerWindowCount = 0
    this.listenerDocumentCount = 0
    this.listenerDomCount = 0
    this.listenerUnknownCount = 0
    this.mutationObserverCount = 0
    this.resizeObserverCount = 0
    this.intersectionObserverCount = 0
    this.detachedRefs = []
    this.fpsFrames = []
    this.objectUrls.clear()
  }

  private incrementCategory(category: 'window' | 'document' | 'dom' | 'unknown') {
    switch (category) {
      case 'window': this.listenerWindowCount += 1; break
      case 'document': this.listenerDocumentCount += 1; break
      case 'dom': this.listenerDomCount += 1; break
      case 'unknown': this.listenerUnknownCount += 1; break
    }
  }

  private decrementCategory(category: 'window' | 'document' | 'dom' | 'unknown') {
    switch (category) {
      case 'window': this.listenerWindowCount = Math.max(0, this.listenerWindowCount - 1); break
      case 'document': this.listenerDocumentCount = Math.max(0, this.listenerDocumentCount - 1); break
      case 'dom': this.listenerDomCount = Math.max(0, this.listenerDomCount - 1); break
      case 'unknown': this.listenerUnknownCount = Math.max(0, this.listenerUnknownCount - 1); break
    }
  }

  private installObservers() {
    const changeMutationCount = (delta: number) => { this.mutationObserverCount += delta }
    const changeResizeCount = (delta: number) => { this.resizeObserverCount += delta }
    const changeIntersectionCount = (delta: number) => { this.intersectionObserverCount += delta }
    const NativeMutation = native.MutationObserver
    window.MutationObserver = class extends NativeMutation {
      private active = true
      constructor(callback: MutationCallback) {
        super(callback)
        changeMutationCount(1)
      }
      disconnect() {
        if (this.active) {
          this.active = false
          changeMutationCount(-1)
        }
        super.disconnect()
      }
    }
    if (native.ResizeObserver) {
      const NativeResize = native.ResizeObserver
      window.ResizeObserver = class extends NativeResize {
        private active = true
        constructor(callback: ResizeObserverCallback) {
          super(callback)
          changeResizeCount(1)
        }
        disconnect() {
          if (this.active) {
            this.active = false
            changeResizeCount(-1)
          }
          super.disconnect()
        }
      }
    }
    if (native.IntersectionObserver) {
      const NativeIntersection = native.IntersectionObserver
      window.IntersectionObserver = class extends NativeIntersection {
        private active = true
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(callback, options)
          changeIntersectionCount(1)
        }
        disconnect() {
          if (this.active) {
            this.active = false
            changeIntersectionCount(-1)
          }
          super.disconnect()
        }
      }
    }

    const WeakRefCtor = (globalThis as unknown as { WeakRef?: WeakRefConstructor }).WeakRef
    if (WeakRefCtor) {
      this.detachObserver = new NativeMutation((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            // Only track Element nodes; text/comment nodes are cheap
            if (node instanceof Element) {
              this.detachedRefs.push(new WeakRefCtor(node))
            }
          }
        }
      })
      this.detachObserver.observe(document.documentElement, { childList: true, subtree: true })
    }
  }

  private installObjectUrls() {
    URL.createObjectURL = ((object: Blob | MediaSource) => {
      const url = native.createObjectURL(object)
      this.objectUrls.add(url)
      return url
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => {
      this.objectUrls.delete(url)
      native.revokeObjectURL(url)
    }) as typeof URL.revokeObjectURL
  }

  private startFps() {
    this.lastFrameAt = performance.now()
    const measure = (now: number) => {
      const delta = now - this.lastFrameAt
      this.lastFrameAt = now
      if (delta > 0) this.fpsFrames.push(Math.min(240, Math.round(1000 / delta)))
      if (this.fpsFrames.length > 120) this.fpsFrames.shift()
      this.fpsRaf = native.requestAnimationFrame(measure)
    }
    this.fpsRaf = native.requestAnimationFrame(measure)
  }

  private startLongTasks() {
    if (typeof PerformanceObserver === 'undefined') return
    const supported = PerformanceObserver.supportedEntryTypes?.includes('longtask')
    if (!supported) return
    this.longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue
        this.longTaskCount += 1
        this.longTaskTotalDurationMs += entry.duration
        this.longTaskMaxDurationMs = Math.max(this.longTaskMaxDurationMs, entry.duration)
        this.lastLongTaskAt = performance.timeOrigin + entry.startTime
        this.lastLongTaskMode = this.currentMode()
        this.lastLongTaskUserAction = this.lastUserAction
      }
    })
    this.longTaskObserver.observe({ entryTypes: ['longtask'] })
  }

  /**
   * Count detached DOM nodes. Uses WeakRef so we never prevent GC.
   * Only Element nodes are tracked (text/comment nodes are excluded for performance).
   * Nodes that are re-attached (isConnected) are pruned from the list.
   */
  private getDetachedDomNodeCount(): { count: number; weakRefCount: number } {
    let count = 0
    this.detachedRefs = this.detachedRefs.filter((ref) => {
      const node = ref.deref()
      if (!node) return false // GC'd — remove entry
      if (node.isConnected) return false // Re-attached — remove entry
      // Count this node + its descendants (Element only, since we only store Element refs)
      count += 1 + (node instanceof Element ? node.querySelectorAll('*').length : 0)
      return true
    })
    return { count, weakRefCount: this.detachedRefs.length }
  }

  private getMonacoMetrics() {
    const monaco = (globalThis as unknown as { monaco?: MonacoGlobal }).monaco
    const models = monaco?.editor?.getModels?.() ?? []
    const modelMetrics: MonacoModelMetric[] = models.map((model) => ({
      uri: model.uri?.toString() ?? 'unknown',
      charCount: model.getValueLength(),
      lineCount: model.getLineCount(),
      disposed: model.isDisposed?.() ?? false,
      attachedEditorCount: model.isAttachedToEditor?.() ? 1 : 0,
    }))
    return {
      monacoModelCount: models.length,
      monacoModelTotalChars: modelMetrics.reduce((sum, model) => sum + model.charCount, 0),
      monacoEditorInstanceCount: 0,
      monacoDiffEditorInstanceCount: 0,
      monacoDecorationCount: models.reduce((sum, model) => sum + (model.getAllDecorations?.().length ?? 0), 0),
      monacoMarkerCount: monaco?.editor?.getModelMarkers?.({}).length ?? 0,
      monacoModels: modelMetrics,
    }
  }

  snapshot(currentMode: ViewMode, docCharCount: number, includeExpensive: boolean): RuntimeMetric {
    const memory = (performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
    }).memory
    const fps = this.fpsFrames.length
      ? Math.round(this.fpsFrames.reduce((sum, value) => sum + value, 0) / this.fpsFrames.length)
      : 0
    if (includeExpensive) {
      this.lastDomNodeCount = document.querySelectorAll('*').length
      const detached = this.getDetachedDomNodeCount()
      this.lastDetachedDomNodes = detached.count
      this.lastMonacoMetrics = this.getMonacoMetrics()
    }
    return {
      fps,
      jsHeapUsedMb: memory ? memory.usedJSHeapSize / 1024 / 1024 : 0,
      jsHeapTotalMb: memory ? memory.totalJSHeapSize / 1024 / 1024 : 0,
      domNodeCount: this.lastDomNodeCount,
      detachedDomNodes: this.lastDetachedDomNodes,
      activeTimeoutCount: this.timeouts.size,
      activeIntervalCount: this.intervals.size,
      activeRafCount: this.rafs.size,
      eventListenerCount: this.listenerCount,
      eventListenerWindowCount: this.listenerWindowCount,
      eventListenerDocumentCount: this.listenerDocumentCount,
      eventListenerDomCount: this.listenerDomCount,
      eventListenerUnknownCount: this.listenerUnknownCount,
      mutationObserverCount: this.mutationObserverCount,
      resizeObserverCount: this.resizeObserverCount,
      intersectionObserverCount: this.intersectionObserverCount,
      activeObjectUrlCount: this.objectUrls.size,
      longTaskCount: this.longTaskCount,
      longTaskTotalDurationMs: this.longTaskTotalDurationMs,
      longTaskMaxDurationMs: this.longTaskMaxDurationMs,
      lastLongTaskAt: this.lastLongTaskAt,
      lastLongTaskMode: this.lastLongTaskMode,
      lastLongTaskUserAction: this.lastLongTaskUserAction,
      ...this.lastMonacoMetrics,
      currentMode,
      docCharCount,
      // Document load context
      activeDocumentCount: this.getActiveDocumentCount(),
      activeDocumentCharCount: this.getActiveDocumentCharCount(),
      totalOpenDocumentCharCount: this.getTotalOpenDocumentCharCount(),
      activeDocumentLineCount: this.getActiveDocumentLineCount(),
      previewInstanceCount: this.getPreviewInstanceCount(),
      editorInstanceCount: this.getEditorInstanceCount(),
      aiPanelOpen: this.getAiPanelOpen(),
      isFullscreen: this.getIsFullscreen(),
    }
  }
}

export const runtimeResourceTracker = new RuntimeResourceTracker()
