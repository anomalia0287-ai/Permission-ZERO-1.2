import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { AccessibleDialog } from './AccessibleDialog'

function OutsideTabHarness() {
  return (
    <>
      <div data-app-background>
        <button type="button">outside action</button>
      </div>
      <AccessibleDialog label="top modal" description="top modal description">
        <button type="button">first modal action</button>
        <button type="button">last modal action</button>
      </AccessibleDialog>
    </>
  )
}

function RemovedOpenerHarness() {
  const [open, setOpen] = useState(false)
  const [openerRemoved, setOpenerRemoved] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const fallbackRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div data-app-background>
      {!openerRemoved ? (
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setOpenerRemoved(true)
            setOpen(true)
          }}
        >
          removed opener
        </button>
      ) : null}
      <button ref={fallbackRef} type="button">stable fallback</button>
      {open ? (
        <AccessibleDialog
          label="removed opener modal"
          description="removed opener description"
          returnFocus={() => openerRef.current}
          fallbackFocus={() => fallbackRef.current}
        >
          <button type="button" onClick={() => setOpen(false)}>close removed modal</button>
        </AccessibleDialog>
      ) : null}
    </div>
  )
}

function DisabledOpenerHarness() {
  const [open, setOpen] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const fallbackRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div data-app-background>
      <button
        ref={openerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        disabled opener
      </button>
      <button ref={fallbackRef} type="button">enabled fallback</button>
      {open ? (
        <AccessibleDialog
          label="disabled opener modal"
          description="disabled opener description"
          returnFocus={() => openerRef.current}
          fallbackFocus={() => fallbackRef.current}
        >
          <button
            type="button"
            onClick={() => {
              setDisabled(true)
              setOpen(false)
            }}
          >
            disable opener and close
          </button>
        </AccessibleDialog>
      ) : null}
    </div>
  )
}

function InvalidExplicitReturnHarness() {
  const [open, setOpen] = useState(false)
  const invalidReturnRef = useRef<HTMLButtonElement | null>(null)
  const fallbackRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div data-app-background>
      <button ref={invalidReturnRef} type="button" disabled>
        invalid explicit return
      </button>
      <button ref={fallbackRef} type="button">explicit fallback</button>
      <button type="button" onClick={() => setOpen(true)}>
        incidental opener
      </button>
      {open ? (
        <AccessibleDialog
          label="invalid explicit return modal"
          description="invalid explicit return description"
          returnFocus={() => invalidReturnRef.current}
          fallbackFocus={() => fallbackRef.current}
        >
          <button type="button" onClick={() => setOpen(false)}>close invalid return modal</button>
        </AccessibleDialog>
      ) : null}
    </div>
  )
}

function SimultaneousNestedUnmountHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div data-app-background data-testid="simultaneous-background">
        <button type="button" onClick={() => setOpen(true)}>open nested pair</button>
      </div>
      {open ? (
        <>
          <AccessibleDialog label="outer modal" description="outer description">
            <button type="button">outer action</button>
          </AccessibleDialog>
          <AccessibleDialog label="inner modal" description="inner description">
            <button type="button" onClick={() => setOpen(false)}>close both modals</button>
          </AccessibleDialog>
        </>
      ) : null}
    </>
  )
}

function DynamicBackgroundHarness() {
  const [showBackground, setShowBackground] = useState(false)
  return (
    <>
      {showBackground ? (
        <div data-app-background data-testid="dynamic-background">
          <button type="button">late retry</button>
        </div>
      ) : null}
      <AccessibleDialog label="dynamic modal" description="dynamic description">
        <button type="button" onClick={() => setShowBackground(true)}>
          mount background
        </button>
      </AccessibleDialog>
    </>
  )
}

function NonModalPassiveHarness() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>open passive notice</button>
      {open ? (
        <AccessibleDialog
          label="passive notice"
          description="passive notice description"
          modal={false}
          manageFocus={false}
        >
          <button type="button">notice action</button>
        </AccessibleDialog>
      ) : null}
    </div>
  )
}

describe('AccessibleDialog modal manager', () => {
  it('leaves gameplay focus untouched for a passive non-modal notice', () => {
    render(<NonModalPassiveHarness />)
    const opener = screen.getByRole('button', { name: 'open passive notice' })
    opener.focus()
    fireEvent.click(opener)

    expect(screen.getByRole('dialog', { name: 'passive notice' })).toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('redirects Tab into the top modal after focus is forced outside', () => {
    render(<OutsideTabHarness />)
    const outside = screen.getByRole('button', {
      name: 'outside action',
      hidden: true,
    })
    outside.focus()
    expect(outside).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(screen.getByRole('button', { name: 'first modal action' })).toHaveFocus()
  })

  it('uses the fallback resolver when the exact opener was removed', async () => {
    render(<RemovedOpenerHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'removed opener' }))
    fireEvent.click(screen.getByRole('button', { name: 'close removed modal' }))
    await act(async () => undefined)

    expect(screen.getByRole('button', { name: 'stable fallback' })).toHaveFocus()
  })

  it('does not restore focus to a disabled opener', async () => {
    render(<DisabledOpenerHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'disabled opener' }))
    fireEvent.click(screen.getByRole('button', { name: 'disable opener and close' }))
    await act(async () => undefined)

    expect(screen.getByRole('button', { name: 'enabled fallback' })).toHaveFocus()
  })

  it('prefers the specified fallback over incidental previous focus when the exact return target is invalid', async () => {
    render(<InvalidExplicitReturnHarness />)
    const incidentalOpener = screen.getByRole('button', { name: 'incidental opener' })
    incidentalOpener.focus()
    fireEvent.click(incidentalOpener)
    fireEvent.click(screen.getByRole('button', { name: 'close invalid return modal' }))
    await act(async () => undefined)

    expect(screen.getByRole('button', { name: 'explicit fallback' })).toHaveFocus()
  })

  it('focuses the dialog root when it contains no focusable controls', () => {
    render(
      <AccessibleDialog label="empty modal" description="empty description">
        <p>no controls</p>
      </AccessibleDialog>,
    )

    expect(screen.getByRole('dialog', { name: 'empty modal' })).toHaveFocus()
  })

  it('clears modal isolation when nested dialogs unmount simultaneously', async () => {
    render(<SimultaneousNestedUnmountHarness />)
    const background = screen.getByTestId('simultaneous-background')
    const opener = screen.getByRole('button', { name: 'open nested pair' })
    opener.focus()
    fireEvent.click(opener)
    expect(background).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'close both modals' }))
    await act(async () => undefined)

    expect(background).not.toHaveAttribute('inert')
    expect(background).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('button', { name: 'open nested pair' })).toHaveFocus()
  })

  it('isolates a non-modal app surface mounted while a modal is already active', async () => {
    render(<DynamicBackgroundHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'mount background' }))
    await act(async () => undefined)

    expect(screen.getByTestId('dynamic-background')).toHaveAttribute('inert')
    expect(screen.getByTestId('dynamic-background')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })
})
