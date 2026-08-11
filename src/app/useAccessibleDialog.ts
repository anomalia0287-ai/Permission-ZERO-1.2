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
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface AttributeSnapshot {
  element: HTMLElement
  ariaHidden: string | null
  inert: boolean
}

function makeInert(element: HTMLElement): AttributeSnapshot {
  const snapshot = {
    element,
    ariaHidden: element.getAttribute('aria-hidden'),
    inert: element.hasAttribute('inert'),
  }
  element.setAttribute('aria-hidden', 'true')
  element.setAttribute('inert', '')
  return snapshot
}

function restoreInert(snapshot: AttributeSnapshot) {
  if (snapshot.ariaHidden === null) {
    snapshot.element.removeAttribute('aria-hidden')
  } else {
    snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden)
  }
  if (snapshot.inert) snapshot.element.setAttribute('inert', '')
  else snapshot.element.removeAttribute('inert')
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      !element.closest('[inert]') &&
      element.getAttribute('aria-hidden') !== 'true',
  )
}

export function useAccessibleDialog({
  modal,
  dismissible,
  onDismiss,
}: {
  modal: boolean
  dismissible: boolean
  onDismiss?: () => void
}) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const inertSnapshots: AttributeSnapshot[] = []

    if (modal) {
      document
        .querySelectorAll<HTMLElement>('[data-app-background]')
        .forEach((element) => inertSnapshots.push(makeInert(element)))
      document
        .querySelectorAll<HTMLElement>('[data-accessible-modal="true"]')
        .forEach((element) => {
          if (element !== dialog && !element.contains(dialog)) {
            inertSnapshots.push(makeInert(element))
          }
        })
    }

    const initialFocus =
      dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      focusableElements(dialog)[0] ??
      dialog
    initialFocus.focus()

    function onKeyDown(event: KeyboardEvent) {
      const current = dialogRef.current
      if (!current || current.hasAttribute('inert')) return
      const topModal = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-accessible-modal="true"]:not([inert])',
        ),
      ).at(-1)
      if (modal && topModal !== current) return

      if (event.key === 'Escape') {
        if (dismissible && !event.defaultPrevented) {
          event.preventDefault()
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
      if (event.shiftKey && document.activeElement === first) {
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
      inertSnapshots.reverse().forEach(restoreInert)
      if (previousFocus?.isConnected) previousFocus.focus()
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
