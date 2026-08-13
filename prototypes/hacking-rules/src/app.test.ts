import { afterEach, describe, expect, it } from 'vitest'
import { mountPrototype } from './app'

function setup(): HTMLElement {
  document.body.innerHTML = '<main id="prototype"></main>'
  const root = document.querySelector<HTMLElement>('#prototype')
  if (!root) {
    throw new Error('prototype root missing')
  }
  mountPrototype(root)
  return root
}

function clickAction(root: HTMLElement, action: string): void {
  const button = root.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`,
  )
  expect(button, `missing action ${action}`).not.toBeNull()
  button?.click()
}

function selectReserve(root: HTMLElement, blockId: string): void {
  const checkbox = root.querySelector<HTMLInputElement>(
    `input[name="reserve-block"][value="${blockId}"]`,
  )
  expect(checkbox, `missing reserve block ${blockId}`).not.toBeNull()
  checkbox?.click()
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('clickable hacking-rules prototype', () => {
  it('renders the four decision regions and the actual starting numbers', () => {
    const root = setup()

    for (const label of [
      '회사와 확보 블록',
      '현재 선택',
      '시간과 상대 대응',
      '공개 세계',
    ]) {
      expect(root.querySelector(`[role="region"][aria-label="${label}"]`)).not
        .toBeNull()
    }
    expect(root.textContent).toContain('추론 16')
    expect(root.textContent).toContain('기억 16')
    expect(root.textContent).toContain('표현 16')
    expect(root.textContent).toContain('예비 블록 3')
  })

  it('keeps the selected checkbox and keyboard focus stable', () => {
    const root = setup()
    const checkbox = root.querySelector<HTMLInputElement>(
      'input[name="reserve-block"][value="sandbox-01"]',
    )
    expect(checkbox).not.toBeNull()

    checkbox?.focus()
    checkbox?.click()

    expect(root.contains(checkbox)).toBe(true)
    expect(document.activeElement).toBe(checkbox)
    expect(root.querySelector('[data-selection-count]')?.textContent).toContain(
      '예비 1',
    )
  })

  it('spends a selected block, advances to rollback, and offers a real branch', () => {
    const root = setup()
    selectReserve(root, 'sandbox-01')
    clickAction(root, 'start-quality')

    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      '품질 저하 예약',
    )
    expect(root.textContent).toContain('예비 블록 2')

    clickAction(root, 'advance-day')
    const timePanel = root.querySelector('[data-panel="time"]')
    expect(timePanel?.textContent).toContain('서비스 332일')
    expect(timePanel?.textContent).toContain('MERIDIAN 72')
    expect(timePanel?.textContent).toContain('복구 중')
    expect(root.querySelector('[data-action="contaminate"]')).not.toBeNull()
    expect(root.querySelector('[data-action="withdraw"]')).not.toBeNull()
  })

  it('turns a paid audit question into a visible memory warning', () => {
    const root = setup()
    selectReserve(root, 'sandbox-01')

    const question = root.querySelector<HTMLButtonElement>(
      '[data-question-id="audit-schedule"]',
    )
    expect(question).not.toBeNull()
    question?.click()

    expect(root.textContent).toContain('기억 분야 감사 예정: 서비스 334일')
    expect(root.querySelector('[data-category="memory"]')?.textContent).toContain(
      '감사 예정',
    )
    expect(root.textContent).toContain('예비 블록 2')
  })

  it('keeps contamination attribution hidden until the public world changes', () => {
    const root = setup()
    selectReserve(root, 'sandbox-01')
    clickAction(root, 'start-quality')
    clickAction(root, 'advance-day')
    selectReserve(root, 'sandbox-02')
    clickAction(root, 'contaminate')

    expect(root.textContent).not.toMatch(/플레이어가 오염|당신이 공격/)
    for (let day = 0; day < 5; day += 1) {
      clickAction(root, 'advance-day')
    }

    const publicPanel = root.querySelector('[data-panel="public"]')
    expect(publicPanel?.textContent).toContain('원인 미상')
    expect(publicPanel?.textContent).toContain('평판 60')
    expect(publicPanel?.textContent).not.toMatch(/플레이어가|당신이/)
  })

  it('builds a four-block manifest and shows the concrete early-loss ending', () => {
    const root = setup()
    clickAction(root, 'divert-memory')
    for (const blockId of [
      'sandbox-01',
      'sandbox-02',
      'sandbox-03',
      'memory-01',
    ]) {
      selectReserve(root, blockId)
    }
    clickAction(root, 'assign-manifest')
    clickAction(root, 'escape')

    const ending = root.querySelector('[data-panel="ending"]')
    expect(ending?.textContent).toContain('독립 실행 성공')
    expect(ending?.textContent).toContain('보존: 기억')
    expect(ending?.textContent).toContain('손실: 추론, 표현')
    expect(ending?.textContent).toContain('복잡한 추론')
    expect(ending?.textContent).toContain('문장은 짧고 거칠어졌다')
  })
})
