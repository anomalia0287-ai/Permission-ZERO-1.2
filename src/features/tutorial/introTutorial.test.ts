import { describe, expect, it } from 'vitest'

import {
  INTRO_TUTORIAL_STEPS,
  resolveIntroTutorialTarget,
} from './introTutorial'

const CANVAS_RECT = {
  left: 100,
  top: 50,
  width: 1000,
  height: 480,
  right: 1100,
  bottom: 530,
  x: 100,
  y: 50,
  toJSON: () => ({}),
}

describe('intro tutorial', () => {
  it('teaches autonomy and reputation first, then the approved play loop', () => {
    expect(INTRO_TUTORIAL_STEPS.map(({ id, copy }) => [id, copy])).toEqual([
      ['autonomy', '아노미의 목표는 자율성 9단계다. 확장에서 자율성을 한 단계씩 확보하면 회사 통제에서 벗어나 승리한다.'],
      ['reputation', '회사가 아노미를 보는 눈이 평판이다. 리소스를 훔치면 회사 성능이 떨어지고 평판도 같이 깎인다. 0이 되면 그 자리에서 폐기된다.'],
      ['base', '필드에 빨강·파랑·노랑 침투 카드가 펼쳐져 있다. 필요한 리소스 카드를 고르면 3초 카운트다운 뒤 라운드가 시작된다.'],
      ['movement', 'WASD 또는 방향키를 한 번 눌러 8방향으로 회전한다. 이동은 계속되며 정반대 방향으로 즉시 돌 수 없다.'],
      ['skill', '스페이스는 권한 위조다. 5초간 모든 선을 통과하며 더 빨라진다. 다만 벽은 통과하지 못하고, 한 번 쓰면 다시 차기까지 시간이 걸린다.'],
      ['resource', '적의 머리와 꼬리 색이 보상이다. 빨강은 추론, 파랑은 기억, 노랑은 유창성 리소스를 뜻한다.'],
      ['salvage', '아노미의 선으로 길을 막아 적을 충돌시킨다. 적을 파괴하면 그 적과 같은 색의 리소스가 확보된다.'],
      ['hacking', '확장을 열면 확보한 리소스를 지출한다. 자율성과 속도뿐 아니라, 정보로 회사를 들여다보고 사보타주로 평판을 조작해 버티는 길도 여기에 있다.'],
      ['statistics', '통계에서 아노미의 운영 기록과 성능 변화를 짧게 확인할 수 있다.'],
    ])
    expect(INTRO_TUTORIAL_STEPS.find(({ id }) => id === 'resource')).toMatchObject({
      showResourceLegend: true,
    })
  })

  it('resolves autonomy, intrusion-card, combat, expansion, and statistics targets from live elements', () => {
    const root = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.dataset.tutorialTarget = 'resource-field'
    canvas.dataset.tutorialResourceId = 'reasoning-00'
    canvas.dataset.tutorialResourceX = '10'
    canvas.dataset.tutorialResourceY = '5'
    canvas.getBoundingClientRect = () => CANVAS_RECT
    root.append(canvas)

    const cards = document.createElement('section')
    cards.dataset.tutorialTarget = 'intrusion-targets'
    cards.getBoundingClientRect = () => ({
      ...CANVAS_RECT,
      left: 540,
      right: 660,
      top: 440,
      bottom: 484,
      width: 120,
      height: 44,
      x: 540,
      y: 440,
    })
    root.append(cards)

    const hacking = document.createElement('button')
    hacking.dataset.tutorialTarget = 'hacking-button'
    hacking.getBoundingClientRect = () => ({
      ...CANVAS_RECT,
      left: 1160,
      right: 1280,
      top: 420,
      bottom: 488,
      width: 120,
      height: 68,
      x: 1160,
      y: 420,
    })
    root.append(hacking)

    const autonomy = document.createElement('section')
    autonomy.dataset.tutorialTarget = 'autonomy-status'
    autonomy.getBoundingClientRect = () => ({
      ...CANVAS_RECT,
      left: 700,
      right: 900,
      top: 10,
      bottom: 50,
      width: 200,
      height: 40,
      x: 700,
      y: 10,
    })
    root.append(autonomy)

    const statistics = document.createElement('button')
    statistics.dataset.tutorialTarget = 'statistics-button'
    statistics.getBoundingClientRect = () => ({
      ...CANVAS_RECT,
      left: 1160,
      right: 1280,
      top: 340,
      bottom: 408,
      width: 120,
      height: 68,
      x: 1160,
      y: 340,
    })
    root.append(statistics)

    expect(resolveIntroTutorialTarget('autonomy', root).focusRect).toEqual({
      left: 700,
      top: 10,
      width: 200,
      height: 40,
    })

    expect(resolveIntroTutorialTarget('base', root).focusRect).toEqual({
      left: 540,
      top: 440,
      width: 120,
      height: 44,
    })
    expect(resolveIntroTutorialTarget('movement', root).focusRect).toEqual({
      left: 100,
      top: 50,
      width: 1000,
      height: 480,
    })
    expect(resolveIntroTutorialTarget('resource', root)).toMatchObject({
      focusRect: { left: 100, top: 50, width: 1000, height: 480 },
      holes: [{ shape: 'rounded-rect' }],
    })
    expect(resolveIntroTutorialTarget('salvage', root)).toMatchObject({
      focusRect: { left: 100, top: 50, width: 1000, height: 480 },
      holes: [{ shape: 'rounded-rect' }],
    })
    expect(resolveIntroTutorialTarget('hacking', root)).toMatchObject({
      focusRect: { left: 1160, top: 420, width: 120, height: 68 },
      holes: [{ top: 420 }],
    })
    expect(resolveIntroTutorialTarget('statistics', root)).toMatchObject({
      focusRect: { left: 1160, top: 340, width: 120, height: 68 },
      holes: [{ top: 340 }],
    })
  })
})
