import type { IntroTutorialStepId } from '../../game/tutorialProgress'
import {
  unionTutorialRects,
  type TutorialCardPlacement,
  type TutorialHole,
  type TutorialRect,
} from './tutorialGeometry'

export interface IntroTutorialStep {
  id: IntroTutorialStepId
  copy: string
  preferredPlacement: Exclude<TutorialCardPlacement, 'bottom-dock'>
}

export interface IntroTutorialTarget {
  holes: TutorialHole[]
  focusRect: TutorialRect
}

export const INTRO_TUTORIAL_STEPS = [
  {
    id: 'base',
    copy: 'PLAY를 누르면 버튼이 줄어들며 흰색 헤드가 출격한다.',
    preferredPlacement: 'top',
  },
  {
    id: 'movement',
    copy: 'WASD 또는 방향키로 직접 움직인다. 자동 전진은 없다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'resource',
    copy: '매 라운드 빨강·파랑·노랑 중 하나 이상의 적 뱀이 플레이어를 압박한다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'salvage',
    copy: '헤드끼리 부딪히면 둘 다, 오래 남은 잔상에 닿으면 닿은 뱀이 피해를 받고 색이 옅어진다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'deposit',
    copy: '적을 쓰러뜨리면 강하게 폭발하고 그 색 리소스가 확보된다. 다음 PLAY로 새 라운드를 연다.',
    preferredPlacement: 'top',
  },
  {
    id: 'hacking',
    copy: '확보한 리소스로 해킹 네트워크에서 탈출 경로를 연다.',
    preferredPlacement: 'left',
  },
] as const satisfies readonly IntroTutorialStep[]

function rectOf(element: Element): TutorialRect {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function holeFromRect(
  rect: TutorialRect,
  shape: TutorialHole['shape'] = 'rounded-rect',
): TutorialHole {
  return {
    ...rect,
    shape,
    radius: shape === 'circle'
      ? Math.min(rect.width, rect.height) / 2
      : 18,
  }
}

function viewportFallback(): TutorialRect {
  return {
    left: 0,
    top: 0,
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }
}

function targetFromRects(
  rects: readonly TutorialRect[],
  shape: TutorialHole['shape'] = 'rounded-rect',
): IntroTutorialTarget {
  const focusRect = unionTutorialRects(rects) ?? viewportFallback()
  return {
    focusRect,
    holes: rects.length > 0
      ? rects.map((rect) => holeFromRect(rect, shape))
      : [holeFromRect(focusRect)],
  }
}

export function resolveIntroTutorialTarget(
  stepId: IntroTutorialStepId,
  root: ParentNode = document,
): IntroTutorialTarget {
  const canvas = root.querySelector(
    '[data-tutorial-target="resource-field"]',
  )
  const canvasRect = canvas ? rectOf(canvas) : viewportFallback()

  if (stepId === 'base') {
    const play = root.querySelector('[data-tutorial-target="snake-play"]')
    return targetFromRects([play ? rectOf(play) : canvasRect])
  }

  if (
    stepId === 'movement'
    || stepId === 'resource'
    || stepId === 'salvage'
    || stepId === 'deposit'
  ) {
    return targetFromRects([canvasRect])
  }

  const hackingRects = [
    root.querySelector('[data-tutorial-target="secured-resources"]'),
    root.querySelector('[data-tutorial-target="hacking-button"]'),
  ].filter((element): element is Element => element !== null).map(rectOf)
  return targetFromRects(hackingRects)
}
