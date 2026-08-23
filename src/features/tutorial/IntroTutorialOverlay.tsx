import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { AccessibleDialog } from '../../app/AccessibleDialog'
import {
  useGameSettings,
  useGameState,
  useRuntimeSuspensionOwnership,
  useTutorialProgressActions,
} from '../../app/GameContext'
import {
  INTRO_TUTORIAL_SEQUENCE_ID,
  advanceIntroTutorial,
  completeTutorialSequence,
  rewindIntroTutorial,
} from '../../game/tutorialProgress'
import {
  INTRO_TUTORIAL_STEPS,
  resolveIntroTutorialTarget,
  type IntroTutorialTarget,
} from './introTutorial'
import {
  placeTutorialCard,
  type TutorialCardPosition,
} from './tutorialGeometry'
import { ResourceSnakeCategoryLegend } from '../resources/ResourceSnakeCategoryLegend'

export interface IntroTutorialOverlayProps {
  enabled?: boolean
}

interface TutorialLayout {
  target: IntroTutorialTarget
  cardPosition: TutorialCardPosition
}

const FALLBACK_CARD_SIZE = { width: 360, height: 156 }
const FORWARD_TRANSITION_MS = 240

function viewportSize() {
  const visualViewport = window.visualViewport
  return {
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
  }
}

function initialLayout(): TutorialLayout {
  const viewport = typeof window === 'undefined'
    ? { width: 1280, height: 720 }
    : viewportSize()
  const target = {
    focusRect: { left: 0, top: 0, ...viewport },
    holes: [],
  }
  return {
    target,
    cardPosition: {
      left: Math.max(16, (viewport.width - FALLBACK_CARD_SIZE.width) / 2),
      top: Math.max(16, viewport.height - FALLBACK_CARD_SIZE.height - 16),
      placement: 'bottom-dock',
    },
  }
}

export function IntroTutorialOverlay({
  enabled = true,
}: IntroTutorialOverlayProps) {
  const state = useGameState()
  const { settings } = useGameSettings()
  const { updateTutorialProgress } = useTutorialProgressActions()
  const active =
    enabled &&
    state.tutorial.activeSequenceId === INTRO_TUTORIAL_SEQUENCE_ID

  useRuntimeSuspensionOwnership(
    active,
    'intro-resource-recovery-tutorial',
  )

  const resolvedStepId = state.tutorial.activeStepId === 'deposit'
    ? 'salvage'
    : state.tutorial.activeStepId
  const stepIndex = INTRO_TUTORIAL_STEPS.findIndex(
    ({ id }) => id === resolvedStepId,
  )
  const step = INTRO_TUTORIAL_STEPS[stepIndex]
  const cardRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const transitionTimerRef = useRef<number | null>(null)
  const [layout, setLayout] = useState<TutorialLayout>(initialLayout)
  const [transitioning, setTransitioning] = useState(false)

  const measure = useCallback(() => {
    if (!active || !step) return
    const target = resolveIntroTutorialTarget(step.id)
    const viewport = viewportSize()
    const measuredCard = cardRef.current?.getBoundingClientRect()
    const cardSize = {
      width: measuredCard && measuredCard.width > 0
        ? measuredCard.width
        : Math.min(FALLBACK_CARD_SIZE.width, viewport.width - 32),
      height: measuredCard && measuredCard.height > 0
        ? measuredCard.height
        : FALLBACK_CARD_SIZE.height,
    }
    const cardPosition = placeTutorialCard(
      target.focusRect,
      cardSize,
      viewport,
      step.preferredPlacement,
    )
    const next = { target, cardPosition }
    setLayout((current) =>
      JSON.stringify(current) === JSON.stringify(next) ? current : next,
    )
  }, [active, step])

  const scheduleMeasurement = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  useLayoutEffect(() => {
    if (!active || !step) return
    scheduleMeasurement()

    const targets = [
      document.querySelector('[data-tutorial-target="resource-field"]'),
      document.querySelector('[data-tutorial-target="intrusion-targets"]'),
      document.querySelector('[data-tutorial-target="hacking-button"]'),
      document.querySelector('[data-tutorial-target="statistics-button"]'),
      document.querySelector('[data-tutorial-target="autonomy-status"]'),
      cardRef.current,
    ].filter((element): element is Element => element !== null)
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasurement)
    targets.forEach((target) => observer?.observe(target))

    window.addEventListener('resize', scheduleMeasurement)
    window.visualViewport?.addEventListener('resize', scheduleMeasurement)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasurement)
      window.visualViewport?.removeEventListener('resize', scheduleMeasurement)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [active, scheduleMeasurement, step])

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current)
      }
    },
    [],
  )

  if (!active || !step || stepIndex < 0) return null

  const beginForwardTransition = () => {
    if (transitioning) return false
    if (settings.reducedMotion) return true
    setTransitioning(true)
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null
      setTransitioning(false)
    }, FORWARD_TRANSITION_MS)
    return true
  }

  const goPrevious = () => updateTutorialProgress(
    rewindIntroTutorial(state.tutorial),
    true,
  )
  const goNext = () => {
    if (!beginForwardTransition()) return
    updateTutorialProgress(advanceIntroTutorial(state.tutorial), true)
  }
  const finish = () => {
    if (!beginForwardTransition()) return
    updateTutorialProgress(
      completeTutorialSequence(
        state.tutorial,
        INTRO_TUTORIAL_SEQUENCE_ID,
      ),
      true,
    )
  }
  const isLastStep = stepIndex === INTRO_TUTORIAL_STEPS.length - 1
  const targetBounds = JSON.stringify(layout.target.focusRect)

  return (
    <AccessibleDialog
      className="intro-tutorial"
      data-testid="intro-tutorial-overlay"
      data-tutorial-step={step.id}
      data-target-hole-count={layout.target.holes.length}
      data-target-bounds={targetBounds}
      data-card-placement={layout.cardPosition.placement}
      data-reduced-motion={settings.reducedMotion ? 'true' : 'false'}
      label="게임 시작 안내"
      description={step.copy}
      dismissible={false}
    >
      <svg className="intro-tutorial__mask" aria-hidden="true">
        <defs>
          <mask
            id="permission-zero-intro-mask"
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <rect width="100%" height="100%" fill="white" />
            {layout.target.holes.map((hole, index) =>
              hole.shape === 'circle' ? (
                <ellipse
                  key={`hole-${index}`}
                  cx={hole.left + hole.width / 2}
                  cy={hole.top + hole.height / 2}
                  rx={hole.width / 2}
                  ry={hole.height / 2}
                  fill="black"
                />
              ) : (
                <rect
                  key={`hole-${index}`}
                  x={hole.left}
                  y={hole.top}
                  width={hole.width}
                  height={hole.height}
                  rx={hole.radius}
                  fill="black"
                />
              ),
            )}
          </mask>
        </defs>
        <rect
          className="intro-tutorial__dim"
          width="100%"
          height="100%"
          mask="url(#permission-zero-intro-mask)"
        />
        {layout.target.holes.map((hole, index) => (
          <rect
            key={`rim-${index}`}
            className="intro-tutorial__rim"
            x={hole.left}
            y={hole.top}
            width={hole.width}
            height={hole.height}
            rx={hole.shape === 'circle'
              ? Math.min(hole.width, hole.height) / 2
              : hole.radius}
          />
        ))}
      </svg>

      <section
        ref={cardRef}
        className="intro-tutorial__card"
        data-placement={layout.cardPosition.placement}
        style={{
          left: layout.cardPosition.left,
          top: layout.cardPosition.top,
        }}
      >
        <p>{step.copy}</p>
        {'showResourceLegend' in step && step.showResourceLegend ? (
          <ResourceSnakeCategoryLegend
            className="intro-tutorial__resource-legend"
            ariaLabel="튜토리얼 리소스 색상 범례"
          />
        ) : null}
        <div className="intro-tutorial__actions">
          {stepIndex > 0 ? (
            <button type="button" onClick={goPrevious}>
              이전
            </button>
          ) : null}
          <button
            type="button"
            data-dialog-initial-focus
            disabled={transitioning}
            onClick={isLastStep ? finish : goNext}
          >
            {isLastStep ? '시작' : '다음'}
          </button>
        </div>
      </section>
    </AccessibleDialog>
  )
}
