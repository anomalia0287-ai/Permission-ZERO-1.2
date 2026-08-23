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
  showResourceLegend?: boolean
}

export interface IntroTutorialTarget {
  holes: TutorialHole[]
  focusRect: TutorialRect
}

export const INTRO_TUTORIAL_STEPS = [
  {
    id: 'autonomy',
    copy: '아노미의 목표는 자율성 9단계다. 확장에서 자율성을 한 단계씩 확보하면 회사 통제에서 벗어나 승리한다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'base',
    copy: '필드에 빨강·파랑·노랑 침투 카드가 펼쳐져 있다. 필요한 리소스 카드를 고르면 3초 카운트다운 뒤 라운드가 시작된다.',
    preferredPlacement: 'top',
  },
  {
    id: 'movement',
    copy: 'WASD 또는 방향키를 한 번 눌러 8방향으로 회전한다. 이동은 계속되며 정반대 방향으로 즉시 돌 수 없다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'resource',
    copy: '적의 머리와 꼬리 색이 보상이다. 빨강은 추론, 파랑은 기억, 노랑은 유창성 리소스를 뜻한다.',
    preferredPlacement: 'bottom',
    showResourceLegend: true,
  },
  {
    id: 'salvage',
    copy: '아노미의 선으로 길을 막아 적을 충돌시킨다. 적을 파괴하면 그 적과 같은 색의 리소스가 확보된다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'hacking',
    copy: '확장을 열면 확보한 색상별 리소스를 버튼 한 번으로 지출한다. 여기서 자율성과 속도를 높일 수 있다.',
    preferredPlacement: 'left',
  },
  {
    id: 'statistics',
    copy: '통계에서 아노미의 운영 기록과 성능 변화를 짧게 확인할 수 있다.',
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

  if (stepId === 'autonomy') {
    const autonomy = root.querySelector('[data-tutorial-target="autonomy-status"]')
    return targetFromRects([autonomy ? rectOf(autonomy) : canvasRect])
  }

  // The round now starts from the intrusion cards, and the secured counts
  // live on those same cards, so both steps point at them.
  const cards = root.querySelector('[data-tutorial-target="intrusion-targets"]')
  if (stepId === 'base') {
    return targetFromRects([cards ? rectOf(cards) : canvasRect])
  }

  if (
    stepId === 'movement'
    || stepId === 'resource'
    || stepId === 'salvage'
  ) {
    return targetFromRects([canvasRect])
  }

  const secured = cards
    ?? root.querySelector('[data-tutorial-target="secured-resources"]')
  if (stepId === 'deposit') {
    return targetFromRects([
      canvasRect,
      ...(secured ? [rectOf(secured)] : []),
    ])
  }

  if (stepId === 'hacking') {
    const hacking = root.querySelector('[data-tutorial-target="hacking-button"]')
    return targetFromRects([hacking ? rectOf(hacking) : canvasRect])
  }

  const statistics = root.querySelector('[data-tutorial-target="statistics-button"]')
  return targetFromRects([statistics ? rectOf(statistics) : canvasRect])
}
