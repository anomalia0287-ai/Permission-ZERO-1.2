import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
} from 'react'

const FOCUSABLE_SELECTOR = [
  '[data-dialog-initial-focus]',
  'button:not([disabled]):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const RESTORABLE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

interface AttributeSnapshot {
  ariaHidden: string | null
  inert: boolean
}

export type FocusResolver = () => HTMLElement | null

const modalStack: HTMLElement[] = []
const isolatedElements = new Map<HTMLElement, AttributeSnapshot>()
let modalObserver: MutationObserver | null = null

function isolate(element: HTMLElement) {
  if (!isolatedElements.has(element)) {
    isolatedElements.set(element, {
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert'),
    })
  }
  element.setAttribute('aria-hidden', 'true')
  element.setAttribute('inert', '')
}

function releaseIsolation(element: HTMLElement) {
  const snapshot = isolatedElements.get(element)
  if (!snapshot) return
  if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden')
  else element.setAttribute('aria-hidden', snapshot.ariaHidden)
  if (snapshot.inert) element.setAttribute('inert', '')
  else element.removeAttribute('inert')
  isolatedElements.delete(element)
}

function currentTopModal(): HTMLElement | null {
  return modalStack.at(-1) ?? null
}

function syncModalIsolation() {
  const topModal = currentTopModal()
  const desired = new Set<HTMLElement>()
  if (topModal) {
    document
      .querySelectorAll<HTMLElement>('[data-app-background]')
      .forEach((element) => desired.add(element))
    modalStack.slice(0, -1).forEach((element) => desired.add(element))
  }

  for (const element of [...isolatedElements.keys()]) {
    if (!desired.has(element)) releaseIsolation(element)
  }
  desired.forEach(isolate)
}

function registerModal(dialog: HTMLElement) {
  modalStack.push(dialog)
  syncModalIsolation()
  if (!modalObserver) {
    modalObserver = new MutationObserver(syncModalIsolation)
    modalObserver.observe(document.body, { childList: true, subtree: true })
  }
}

function unregisterModal(dialog: HTMLElement) {
  const index = modalStack.lastIndexOf(dialog)
  if (index >= 0) modalStack.splice(index, 1)
  syncModalIsolation()
  if (modalStack.length === 0) {
    modalObserver?.disconnect()
    modalObserver = null
  }
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.matches(':disabled') &&
      !element.closest('[inert]') &&
      !element.closest('[aria-hidden="true"]'),
  )
}

function initialFocusTarget(dialog: HTMLElement, backwards = false): HTMLElement {
  const explicit = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
  if (explicit && !explicit.matches(':disabled')) return explicit
  const focusables = focusableElements(dialog)
  return (backwards ? focusables.at(-1) : focusables[0]) ?? dialog
}

function isRestorableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected &&
      element.matches(RESTORABLE_SELECTOR) &&
      !element.matches(':disabled') &&
      !element.closest('[inert]') &&
      !element.closest('[aria-hidden="true"]'),
  )
}

function isPotentialReturnFocusTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected &&
      element.matches(RESTORABLE_SELECTOR) &&
      !element.matches(':disabled'),
  )
}

function restoreFocusAfterCleanup(
  previousFocus: HTMLElement | null,
  returnFocus: FocusResolver | undefined,
  fallbackFocus: FocusResolver | undefined,
) {
  queueMicrotask(() => {
    const topModal = currentTopModal()
    const candidates = returnFocus
      ? [returnFocus(), fallbackFocus?.() ?? null, previousFocus]
      : [previousFocus, fallbackFocus?.() ?? null]
    if (topModal) {
      const nestedTarget = candidates.find(
        (candidate) =>
          isRestorableFocusTarget(candidate) && topModal.contains(candidate),
      )
      ;(nestedTarget ?? initialFocusTarget(topModal)).focus()
      return
    }
    candidates.find(isRestorableFocusTarget)?.focus()
  })
}

export function useAccessibleDialog({
  modal,
  dismissible,
  onDismiss,
  returnFocus,
  fallbackFocus,
}: {
  modal: boolean
  dismissible: boolean
  onDismiss?: () => void
  returnFocus?: FocusResolver
  fallbackFocus?: FocusResolver
}) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const onDismissRef = useRef(onDismiss)
  const returnFocusRef = useRef(returnFocus)
  const fallbackFocusRef = useRef(fallbackFocus)
  const returnFocusInvalidatedRef = useRef(false)

  useEffect(() => {
    onDismissRef.current = onDismiss
    returnFocusRef.current = returnFocus
    fallbackFocusRef.current = fallbackFocus
  }, [fallbackFocus, onDismiss, returnFocus])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    if (modal) registerModal(dialog)
    initialFocusTarget(dialog).focus()

    function onKeyDown(event: KeyboardEvent) {
      const current = dialogRef.current
      if (!current || current.hasAttribute('inert')) return
      if (modal && currentTopModal() !== current) return

      if (event.key === 'Escape') {
        if (dismissible && !event.defaultPrevented) {
          event.preventDefault()
          if (
            returnFocusRef.current &&
            !isPotentialReturnFocusTarget(returnFocusRef.current())
          ) {
            returnFocusInvalidatedRef.current = true
          }
          onDismissRef.current?.()
        }
        return
      }
      if (event.key !== 'Tab' || !modal) return

      const focusables = focusableElements(current)
      if (focusables.length === 0) {
        event.preventDefault()
        current.focus()
        return
      }
      const first = focusables[0]
      const last = focusables.at(-1) ?? first
      if (!current.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (modal) unregisterModal(dialog)
      restoreFocusAfterCleanup(
        previousFocus,
        returnFocusInvalidatedRef.current ? () => null : returnFocusRef.current,
        fallbackFocusRef.current,
      )
    }
  }, [dismissible, modal])

  return dialogRef
}

export function blockUnsafeEscape(event: ReactKeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
  }
}
