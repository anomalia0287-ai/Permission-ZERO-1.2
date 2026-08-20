import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceIntrusionControls } from './useResourceIntrusionControls'

interface ControlsHarnessProps {
  running?: boolean
  move?: (dx: number, dy: number) => void
}

function ControlsHarness({
  running = true,
  move = () => undefined,
}: ControlsHarnessProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const controls = useResourceIntrusionControls({
    canvasRef,
    running,
    move,
  })

  return (
    <>
      <canvas ref={canvasRef} role="application" tabIndex={0} />
      <output aria-label="이동 입력 유지">{String(controls.movementHeld)}</output>
      <input aria-label="이름 입력" />
      <div role="tablist" aria-label="상세 탭">
        <button type="button" role="tab">첫 탭</button>
      </div>
    </>
  )
}

describe('useResourceIntrusionControls', () => {
  it('leaves non-movement keys owned by an editable input', () => {
    const move = vi.fn()
    render(<ControlsHarness move={move} />)

    const input = screen.getByRole('textbox', { name: '이름 입력' })
    input.focus()
    fireEvent.keyDown(input, { key: 'e' })
    fireEvent.keyUp(input, { key: 'e' })

    expect(move).not.toHaveBeenCalled()
  })

  it('does not turn Space or E into an attack or collection command', () => {
    const move = vi.fn()
    render(<ControlsHarness move={move} />)

    const canvas = screen.getByRole('application')
    fireEvent.keyDown(canvas, { key: 'e' })
    fireEvent.keyUp(canvas, { key: 'e' })
    fireEvent.keyDown(canvas, { key: ' ' })
    fireEvent.keyUp(canvas, { key: ' ' })

    expect(move).not.toHaveBeenCalled()
  })

  it('leaves arrow keys owned by a focused composite widget', () => {
    const move = vi.fn()
    render(<ControlsHarness move={move} />)

    const tab = screen.getByRole('tab', { name: '첫 탭' })
    tab.focus()
    fireEvent.keyDown(tab, { key: 'ArrowRight' })
    fireEvent.keyUp(tab, { key: 'ArrowRight' })

    expect(move).not.toHaveBeenCalled()
  })

  it('clears a held movement when the runtime pauses before it resumes', () => {
    const move = vi.fn()
    const { rerender } = render(<ControlsHarness move={move} />)

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByLabelText('이동 입력 유지')).toHaveTextContent('true')

    rerender(<ControlsHarness running={false} move={move} />)
    expect(screen.getByLabelText('이동 입력 유지')).toHaveTextContent('false')

    rerender(<ControlsHarness running move={move} />)
    expect(screen.getByLabelText('이동 입력 유지')).toHaveTextContent('false')
  })
})
