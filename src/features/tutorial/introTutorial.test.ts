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
      ['base', '필드 하단의 PLAY를 누르면 흰 머리가 조립되고 라운드가 시작된다.'],
      ['movement', 'WASD 또는 방향키를 누르는 동안만 움직인다. 자동 전진은 없다.'],
      ['resource', '빨강·파랑·노랑 뱀은 각각 추론·기억·유창성 리소스를 지킨다.'],
      ['salvage', '긴 도트 꼬리로 탈출로를 닫아 적 머리를 충돌시킨다. 한 번에 죽지 않고 색이 옅어진다.'],
      ['deposit', '적이 마지막 충돌에서 폭발하면 연결된 리소스가 즉시 확보된다.'],
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
    expect(resolveIntroTutorialTarget('deposit', root)).toMatchObject({
      focusRect: { left: 100, top: 50, width: 1180, height: 480 },
      holes: [{ left: 100 }, { left: 1160 }],
    })
    expect(resolveIntroTutorialTarget('hacking', root)).toMatchObject({
      focusRect: { left: 1160, top: 80, width: 120, height: 408 },
      holes: [{ top: 80 }, { top: 420 }],
    })
  })
})
