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
    id: 'reputation',
    copy: '리소스를 훔치면 성능이 떨어지며, 평판에 영향을 준다. 평판이 0이 되면 회사는 아노미를 폐기한다.',
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
    id: 'skill',
    copy: '스페이스는 권한 위조다. 5초간 모든 선을 통과하며 더 빨라진다. 다만 벽은 통과하지 못하고, 한 번 쓰면 다시 차기까지 시간이 걸린다.',
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
    copy: '확장을 열면 확보한 리소스를 지출한다. 자율성과 속도뿐 아니라, 정보로 회사를 들여다보고 사보타주로 평판을 조작해 버티는 길도 여기에 있다.',
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

  if (stepId === 'reputation') {
    const reputation = root.querySelector('[data-tutorial-target="reputation-status"]')
    return targetFromRects([reputation ? rectOf(reputation) : canvasRect])
  }

  // The round now starts from the intrusion cards, and the secured counts
  // live on those same cards, so both steps point at them.
  const cards = root.querySelector('[data-tutorial-target="intrusion-targets"]')
  if (stepId === 'base') {
    return targetFromRects([cards ? rectOf(cards) : canvasRect])
  }

  if (
    stepId === 'movement'
    || stepId === 'skill'
    || stepId === 'resource'
    || stepId === 'salvage'
  ) {
    return targetFromRects([canvasRect])
  }

  // Legacy saves can still carry the retired 'deposit' step; the secured
  // counts it pointed at now live on the intrusion cards.
  if (stepId === 'deposit') {
    return targetFromRects([
      canvasRect,
      ...(cards ? [rectOf(cards)] : []),
    ])
  }

  if (stepId === 'hacking') {
    const hacking = root.querySelector('[data-tutorial-target="hacking-button"]')
    return targetFromRects([hacking ? rectOf(hacking) : canvasRect])
  }

  const statistics = root.querySelector('[data-tutorial-target="statistics-button"]')
  return targetFromRects([statistics ? rectOf(statistics) : canvasRect])
}
