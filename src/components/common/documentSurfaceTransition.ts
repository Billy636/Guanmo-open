import { flushSync } from 'react-dom'
import { useSettingsStore } from '@/stores/settingsStore'

interface ViewTransitionLike {
  readonly updateCallbackDone: Promise<unknown>
  readonly finished: Promise<unknown>
  skipTransition: () => void
}

type DocumentWithViewTransition = Omit<Document, 'startViewTransition'> & {
  startViewTransition?: (updateCallback: () => void) => ViewTransitionLike
}

let activeTransition: ViewTransitionLike | null = null
let transitionTail: Promise<void> | null = null
let transitionToken = 0
let cancelPendingRelease: (() => void) | null = null

export function isPointerActivation(event: { detail?: number }) {
  return event.detail !== 0
}

function markTransition(stage: 'request' | 'dom-updated' | 'finished') {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return
  performance.mark(`guanmo:document-transition:${stage}`)
}

function shouldAnimate(animate: boolean) {
  if (!animate || typeof window === 'undefined' || typeof document === 'undefined') return false
  if (document.visibilityState !== 'visible') return false
  if (!useSettingsStore.getState().appearance.documentTransitionEnabled) return false
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function skipActiveTransition() {
  cancelPendingRelease?.()
  cancelPendingRelease = null
  if (activeTransition) {
    try {
      activeTransition.skipTransition()
    } catch {
      activeTransition = null
    }
  }
}

function runImmediate(update: () => void) {
  skipActiveTransition()
  update()
}

function startTransition(update: () => void, kind: 'document' | 'mode'): Promise<void> {
  const viewTransitionDocument = document as DocumentWithViewTransition
  if (!viewTransitionDocument.startViewTransition) {
    update()
    return Promise.resolve()
  }

  skipActiveTransition()
  const root = document.documentElement
  const token = ++transitionToken
  markTransition('request')
  root.classList.add('gm-document-transition-active')
  root.classList.toggle('gm-document-transition-mode', kind === 'mode')
  root.dataset.gmDocumentTransition = String(token)

  let transition: ViewTransitionLike
  let updateCommitted = false
  let pendingAfterUpdate = false
  try {
    transition = viewTransitionDocument.startViewTransition(() => {
      try {
        flushSync(update)
      } catch {
        update()
      }
      updateCommitted = true
      pendingAfterUpdate = document.querySelector('[data-gm-document-surface-masked="true"]') !== null
      markTransition('dom-updated')
    })
  } catch {
    if (root.dataset.gmDocumentTransition === String(token)) {
      delete root.dataset.gmDocumentTransition
      root.classList.remove('gm-document-transition-active')
      root.classList.remove('gm-document-transition-mode')
    }
    if (!updateCommitted) update()
    return Promise.resolve()
  }

  activeTransition = transition
  if (pendingAfterUpdate) {
    const pendingClass = 'gm-document-transition-pending'
    root.classList.add(pendingClass)
    const surface = document.querySelector('[data-gm-document-surface]')
    let timeoutId: number | null = null
    let observer: MutationObserver | null = null
    let released = false
    const release = () => {
      if (released) return
      released = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      observer?.disconnect()
      if (cancelPendingRelease === release) cancelPendingRelease = null
      root.classList.remove(pendingClass)
    }
    cancelPendingRelease = release
    if (surface && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (surface.getAttribute('data-gm-document-surface-masked') !== 'true') release()
      })
      observer.observe(surface, { attributes: true, attributeFilter: ['data-gm-document-surface-masked'] })
      if (surface.getAttribute('data-gm-document-surface-masked') !== 'true') release()
      else timeoutId = window.setTimeout(release, 600)
    } else {
      release()
    }
  }
  let updateDone: Promise<void>
  try {
    updateDone = Promise.resolve(transition.updateCallbackDone).catch(() => undefined).then(() => {
      if (activeTransition === transition) activeTransition = null
    })
  } catch {
    if (activeTransition === transition) activeTransition = null
    updateDone = Promise.resolve()
  }
  void updateDone
  try {
    void Promise.resolve(transition.finished).catch(() => undefined).finally(() => {
      markTransition('finished')
      if (root.dataset.gmDocumentTransition === String(token)) {
        delete root.dataset.gmDocumentTransition
        root.classList.remove('gm-document-transition-active')
        root.classList.remove('gm-document-transition-mode')
      }
    })
  } catch {
    if (root.dataset.gmDocumentTransition === String(token)) {
      delete root.dataset.gmDocumentTransition
      root.classList.remove('gm-document-transition-active')
      root.classList.remove('gm-document-transition-mode')
    }
  }
  return updateDone
}

export function runDocumentSurfaceTransition(
  update: () => void,
  options: { animate: boolean; kind?: 'document' | 'mode' },
) {
  if (!shouldAnimate(options.animate)) {
    skipActiveTransition()
    if (!transitionTail) {
      runImmediate(update)
      return
    }
    const pending = transitionTail
    transitionTail = pending
      .catch(() => undefined)
      .then(() => runImmediate(update))
      .then(() => undefined)
    return
  }

  const previous = transitionTail ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => startTransition(update, options.kind ?? 'document'))
  transitionTail = next
  void next.then(() => {
    if (transitionTail === next) transitionTail = null
  }, () => {
    if (transitionTail === next) transitionTail = null
  })
}
