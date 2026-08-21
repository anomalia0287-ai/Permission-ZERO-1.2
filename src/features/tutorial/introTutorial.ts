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
    copy: '필드 하단의 PLAY를 누르면 흰 머리가 조립되고 라운드가 시작된다.',
    preferredPlacement: 'top',
  },
  {
    id: 'movement',
    copy: 'WASD 또는 방향키를 누르는 동안만 움직인다. 자동 전진은 없다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'resource',
    copy: '빨강·파랑·노랑 뱀은 각각 추론·기억·유창성 리소스를 지킨다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'salvage',
    copy: '긴 도트 꼬리로 탈출로를 닫아 적 머리를 충돌시킨다. 한 번에 죽지 않고 색이 옅어진다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'deposit',
    copy: '적이 마지막 충돌에서 폭발하면 연결된 리소스가 즉시 확보된다.',
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
    const play = root.querySelector('[data-tutorial-target="play-button"]')
    return targetFromRects([play ? rectOf(play) : canvasRect])
  }

  if (
    stepId === 'movement'
    || stepId === 'resource'
    || stepId === 'salvage'
  ) {
    return targetFromRects([canvasRect])
  }

  const secured = root.querySelector('[data-tutorial-target="secured-resources"]')
  if (stepId === 'deposit') {
    return targetFromRects([
      canvasRect,
      ...(secured ? [rectOf(secured)] : []),
    ])
  }

  const hackingRects = [
    secured,
    root.querySelector('[data-tutorial-target="hacking-button"]'),
  ].filter((element): element is Element => element !== null).map(rectOf)
  return targetFromRects(hackingRects)
}
