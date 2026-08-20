import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useRuntimeSuspended,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { IntroTutorialOverlay } from './IntroTutorialOverlay'

let canvasLeft = 100
let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()
const resizeObservers: ResizeObserverMock[] = []

class ResizeObserverMock {
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }
}

function elementRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function flushAnimationFrames(): void {
  const pending = [...animationFrames.entries()]
  animationFrames = new Map()
  act(() => {
    pending.forEach(([, callback]) => callback(0))
  })
}

function RuntimeProbe() {
  const suspended = useRuntimeSuspended()
  return (
    <output aria-label="런타임 상태">{suspended ? '정지' : '실행'}</output>
  )
}

function TutorialHarness({ enabled = true }: { enabled?: boolean }) {
  return (
    <GameProvider storage={null} initialSeed="intro-overlay">
      <div data-app-background data-testid="tutorial-background">
        <canvas
          data-tutorial-target="resource-field"
          data-tutorial-resource-id="reasoning-00"
          data-tutorial-resource-x="10"
          data-tutorial-resource-y="5"
        />
        <button type="button" data-tutorial-target="snake-play">PLAY</button>
        <section data-tutorial-target="secured-resources">확보 자원</section>
        <button type="button" data-tutorial-target="hacking-button">
          해킹
        </button>
        <RuntimeProbe />
      </div>
      <IntroTutorialOverlay enabled={enabled} />
    </GameProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  canvasLeft = 100
  nextAnimationFrameId = 1
  animationFrames = new Map()
  resizeObservers.length = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function mockTutorialRect(this: HTMLElement) {
      if (this.classList.contains('intro-tutorial__card')) {
        return elementRect(0, 0, 360, 156)
      }
      if (this.dataset.tutorialTarget === 'resource-field') {
        return elementRect(canvasLeft, 50, 1000, 480)
      }
      if (this.dataset.tutorialTarget === 'snake-play') {
        return elementRect(canvasLeft + 440, 440, 120, 44)
      }
      if (this.dataset.tutorialTarget === 'secured-resources') {
        return elementRect(1140, 80, 120, 170)
      }
      if (this.dataset.tutorialTarget === 'hacking-button') {
        return elementRect(1140, 420, 120, 68)
      }
      return elementRect(0, 0, 0, 0)
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IntroTutorialOverlay', () => {
  it('traps focus, freezes runtime, survives Escape, and completes all six unnumbered steps', () => {
    render(<TutorialHarness />)
    flushAnimationFrames()

    const dialog = screen.getByRole('dialog', { name: '게임 시작 안내' })
    expect(dialog).toHaveAttribute('data-tutorial-step', 'base')
    expect(dialog).toHaveAttribute('data-target-hole-count', '1')
    expect(dialog.querySelector('.intro-tutorial__card')).toHaveTextContent(
      'PLAY를 누르면 버튼이 줄어들며 흰색 헤드가 출격한다.',
    )
    expect(dialog).not.toHaveTextContent(/\b[1-6]\s*\/\s*6\b/)
    expect(screen.getByLabelText('런타임 상태')).toHaveTextContent('정지')
    expect(screen.queryByRole('button', { name: '이전' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음' })).toHaveFocus()
    expect(screen.getByTestId('tutorial-background')).toHaveAttribute('inert')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '게임 시작 안내' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '다음' })).toHaveFocus()

    for (const expectedStep of [
      'movement',
      'resource',
      'salvage',
      'deposit',
      'hacking',
    ]) {
      const next = screen.getByRole('button', { name: '다음' })
      fireEvent.click(next)
      expect(next).toBeDisabled()
      act(() => vi.advanceTimersByTime(240))
      flushAnimationFrames()
      expect(screen.getByRole('dialog', { name: '게임 시작 안내' })).toHaveAttribute(
        'data-tutorial-step',
        expectedStep,
      )
    }

    expect(screen.getByRole('dialog', { name: '게임 시작 안내' })).toHaveAttribute(
      'data-target-hole-count',
      '2',
    )
    expect(screen.getByRole('button', { name: '이전' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '시작' }))

    expect(screen.queryByRole('dialog', { name: '게임 시작 안내' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('런타임 상태')).toHaveTextContent('실행')
    expect(screen.getByTestId('tutorial-background')).not.toHaveAttribute('inert')
  })

  it('recomputes spotlight bounds through ResizeObserver and cleans it up', () => {
    const view = render(<TutorialHarness />)
    flushAnimationFrames()
    const dialog = screen.getByRole('dialog', { name: '게임 시작 안내' })
    const initialBounds = dialog.getAttribute('data-target-bounds')
    expect(resizeObservers.length).toBeGreaterThan(0)

    canvasLeft = 200
    act(() => {
      resizeObservers.forEach((observer) => {
        observer.callback([], observer as unknown as ResizeObserver)
      })
    })
    flushAnimationFrames()

    expect(dialog.getAttribute('data-target-bounds')).not.toBe(initialBounds)
    expect(JSON.parse(dialog.getAttribute('data-target-bounds') ?? '{}')).toMatchObject({
      left: 640,
    })
    view.unmount()
    expect(resizeObservers.every(({ disconnect }) =>
      disconnect.mock.calls.length === 1,
    )).toBe(true)
  })

  it('does not suspend or render while another panel disables it', () => {
    render(<TutorialHarness enabled={false} />)

    expect(screen.queryByRole('dialog', { name: '게임 시작 안내' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('런타임 상태')).toHaveTextContent('실행')
  })
})
