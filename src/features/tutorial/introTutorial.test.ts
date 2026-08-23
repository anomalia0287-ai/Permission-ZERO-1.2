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
  it('teaches autonomy first, then the approved seven-step play loop', () => {
    expect(INTRO_TUTORIAL_STEPS.map(({ id, copy }) => [id, copy])).toEqual([
      ['autonomy', '아노미의 목표는 자율성 9단계다. 확장에서 자율성을 한 단계씩 확보하면 회사 통제에서 벗어나 승리한다.'],
      ['base', '필드 중앙의 원형 InIt을 누르면 빨강·파랑·노랑 침투 카드가 펼쳐진다. 필요한 리소스 카드를 골라 라운드를 시작한다.'],
      ['movement', 'WASD 또는 방향키를 한 번 눌러 8방향으로 회전한다. 이동은 계속되며 정반대 방향으로 즉시 돌 수 없다.'],
      ['resource', '적의 머리와 꼬리 색이 보상이다. 빨강은 추론, 파랑은 기억, 노랑은 유창성 리소스를 뜻한다.'],
      ['salvage', '아노미의 선으로 길을 막아 적을 충돌시킨다. 적을 파괴하면 그 적과 같은 색의 리소스가 확보된다.'],
      ['hacking', '확장을 열면 확보한 색상별 리소스를 버튼 한 번으로 지출한다. 여기서 자율성과 속도를 높일 수 있다.'],
      ['statistics', '통계에서 아노미의 운영 기록과 성능 변화를 짧게 확인할 수 있다.'],
    ])
    expect(INTRO_TUTORIAL_STEPS.find(({ id }) => id === 'resource')).toMatchObject({
      showResourceLegend: true,
    })
  })

  it('resolves autonomy, InIt, combat, expansion, and statistics targets from live elements', () => {
    const root = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.dataset.tutorialTarget = 'resource-field'
    canvas.dataset.tutorialResourceId = 'reasoning-00'
    canvas.dataset.tutorialResourceX = '10'
    canvas.dataset.tutorialResourceY = '5'
    canvas.getBoundingClientRect = () => CANVAS_RECT
    root.append(canvas)

    const play = document.createElement('button')
    play.dataset.tutorialTarget = 'play-button'
    play.getBoundingClientRect = () => ({
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
    root.append(play)

    const secured = document.createElement('section')
    secured.dataset.tutorialTarget = 'secured-resources'
    secured.getBoundingClientRect = () => ({
      ...CANVAS_RECT,
      left: 1160,
      right: 1280,
      top: 80,
      bottom: 250,
      width: 120,
      height: 170,
      x: 1160,
      y: 80,
    })
    root.append(secured)

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
