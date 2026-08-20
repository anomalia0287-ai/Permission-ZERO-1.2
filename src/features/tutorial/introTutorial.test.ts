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
  it('teaches the actual round start, direct movement, damage, reward, and hacking loop', () => {
    expect(INTRO_TUTORIAL_STEPS.map(({ id, copy }) => [id, copy])).toEqual([
      ['base', 'PLAY를 누르면 버튼이 줄어들며 흰색 헤드가 출격한다.'],
      ['movement', 'WASD 또는 방향키로 직접 움직인다. 자동 전진은 없다.'],
      ['resource', '매 라운드 빨강·파랑·노랑 중 하나 이상의 적 뱀이 플레이어를 압박한다.'],
      ['salvage', '헤드끼리 부딪히면 둘 다, 오래 남은 잔상에 닿으면 닿은 뱀이 피해를 받고 색이 옅어진다.'],
      ['deposit', '적을 쓰러뜨리면 강하게 폭발하고 그 색 리소스가 확보된다. 다음 PLAY로 새 라운드를 연다.'],
      ['hacking', '확보한 리소스로 해킹 네트워크에서 탈출 경로를 연다.'],
    ])
  })

  it('resolves PLAY, whole-field combat, and split hacking targets from live elements', () => {
    const root = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.dataset.tutorialTarget = 'resource-field'
    canvas.dataset.tutorialResourceId = 'reasoning-00'
    canvas.dataset.tutorialResourceX = '10'
    canvas.dataset.tutorialResourceY = '5'
    canvas.getBoundingClientRect = () => CANVAS_RECT
    root.append(canvas)

    const play = document.createElement('button')
    play.dataset.tutorialTarget = 'snake-play'
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
    expect(resolveIntroTutorialTarget('deposit', root).focusRect).toEqual({
      left: 100,
      top: 50,
      width: 1000,
      height: 480,
    })
    expect(resolveIntroTutorialTarget('hacking', root)).toMatchObject({
      focusRect: { left: 1160, top: 80, width: 120, height: 408 },
      holes: [{ top: 80 }, { top: 420 }],
    })
  })
})
