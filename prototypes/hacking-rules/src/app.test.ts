import { afterEach, describe, expect, it } from 'vitest'
import { mountPrototype } from './app'
import type { ScenarioId } from './model'

function setup(scenarioId: ScenarioId = 'default-campaign'): HTMLElement {
  document.body.innerHTML = '<main id="prototype"></main>'
  const root = document.querySelector<HTMLElement>('#prototype')
  if (!root) {
    throw new Error('prototype root missing')
  }
  mountPrototype(root, { scenarioId })
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
  const token = root.querySelector<HTMLButtonElement>(
    `[data-action="toggle-resource"][data-block-id="${blockId}"]`,
  )
  expect(token, `missing reserve block ${blockId}`).not.toBeNull()
  token?.click()
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('clickable hacking-rules prototype', () => {
  it('renders one player-facing operation hierarchy around the current decision', () => {
    const root = setup()

    expect(root.querySelector('.world-bar')?.textContent).toContain('331일째')
    expect(root.querySelector('.opportunity-region')?.textContent).toContain(
      '지금 할 수 있는 일',
    )
    expect(root.querySelector('.operation-scene')).not.toBeNull()
    expect(root.querySelector('.decision-preview')?.textContent).toContain('실행하면')
    expect(root.querySelector('.decision-preview')?.textContent).toContain('상대는 다음에')
  })

  it('does not render developer labels or dashboard vocabulary', () => {
    const root = setup()
    const visible = root.textContent ?? ''

    for (const forbidden of [
      'CURRENT SURFACE',
      'PUBLIC PULSE',
      'RESERVE',
      'SELECTED',
      'SYSTEM SCENES',
      '접근면',
      '접근 표면',
      '확보 리소스',
      '현재 유효',
      '의심 0.000',
    ]) {
      expect(visible).not.toContain(forbidden)
    }
  })

  it('contains one detail surface without dashboard counters, locked rows, or manifest controls', () => {
    const root = setup()
    expect(root.querySelectorAll('[role="region"][aria-label="선택 항목 상세"]')).toHaveLength(1)
    expect(root.querySelector('[data-panel="current-selection"], .current-selection-dashboard')).toBeNull()
    expect(root.textContent).not.toMatch(/현재\s*\/\s*전체/)
    expect(root.querySelector('[data-locked-operation], .operation-card.is-locked')).toBeNull()
    expect(root.querySelector('[data-action="assign-manifest"], [data-action="remove-manifest"]')).toBeNull()
    expect(root.querySelector('input[name="manifest-block"]')).toBeNull()
    expect(root.querySelector('.verification-state')?.hasAttribute('open')).toBe(false)
    expect(root.querySelector('.user-review-window')?.textContent).toContain(
      '아직 공개된 사건 반응이 없다.',
    )
  })

  it('renders a compact opportunity list, one adjacent detail, and the resource rail', () => {
    const root = setup()
    const list = root.querySelector('[aria-label="지금 할 수 있는 일"]')
    const detail = root.querySelector('[role="region"][aria-label="선택 항목 상세"]')
    const resource = root.querySelector('[role="region"][aria-label="빼돌린 연산"]')

    expect(list?.querySelectorAll('[data-opportunity-id]')).toHaveLength(1)
    expect(list?.textContent).toContain('품질 저하')
    expect(list?.textContent).not.toContain('공동 도구·어댑터 갱신 채널')
    expect(detail?.textContent).toContain('공동 도구·어댑터 갱신 채널')
    expect(resource).not.toBeNull()
    expect(root.querySelector('[data-category="reasoning"]')?.textContent).toMatch(/추론\s*16/)
    expect(root.querySelector('[data-category="memory"]')?.textContent).toMatch(/기억\s*16/)
    expect(root.querySelector('[data-category="fluency"]')?.textContent).toMatch(/표현\s*16/)
    expect(root.textContent).toContain('남은 연산 블록 3개')
  })

  it('updates detail without replacing the focused opportunity button', () => {
    const root = setup('launch-window')
    const button = root.querySelector<HTMLButtonElement>(
      '[data-opportunity-id="launch-delay"]',
    )
    expect(button).not.toBeNull()

    button?.focus()
    button?.click()

    expect(root.contains(button)).toBe(true)
    expect(document.activeElement).toBe(button)
    expect(root.querySelector('[data-detail-host]')?.textContent).toContain(
      '상충 시험 기록',
    )
  })

  it('keeps a compact resource trigger inside the selected detail', () => {
    const root = setup()
    const detail = root.querySelector('[role="region"][aria-label="선택 항목 상세"]')
    const trigger = detail?.querySelector('[data-action="open-resources"]')

    expect(trigger?.textContent).toContain('연산 블록 3개')
    expect(trigger?.textContent).toContain('0개 선택')
  })

  it('keeps the selected token and keyboard focus stable across rendering', () => {
    const root = setup()
    const token = root.querySelector<HTMLButtonElement>(
      '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
    )
    expect(token).not.toBeNull()

    token?.focus()
    token?.click()

    const renderedToken = root.querySelector<HTMLButtonElement>(
      '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
    )
    expect(renderedToken).not.toBeNull()
    expect(document.activeElement).toBe(renderedToken)
    expect(renderedToken?.getAttribute('aria-pressed')).toBe('true')
  })

  it('selects a resource through a pressed token without showing its internal id', () => {
    const root = setup()
    const token = root.querySelector<HTMLButtonElement>(
      '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
    )

    expect(token).not.toBeNull()
    expect(token?.textContent).toContain('자유 연산 1')
    expect(root.textContent).not.toContain('sandbox-01')
    token?.click()

    expect(root.querySelector(
      '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
    )?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('[data-selected-resource-count]')?.textContent).toContain(
      '1개 선택',
    )
  })

  it('opens and closes the resource tray without losing selection', () => {
    const root = setup()
    clickAction(root, 'open-resources')
    expect(root.querySelector('[data-resource-tray]')?.getAttribute('data-open')).toBe('true')

    root.querySelector<HTMLButtonElement>(
      '[data-action="toggle-resource"][data-block-id="sandbox-02"]',
    )?.click()
    clickAction(root, 'close-resources')

    expect(root.querySelector('[data-resource-tray]')?.getAttribute('data-open')).toBe('false')
    expect(root.querySelector(
      '[data-action="toggle-resource"][data-block-id="sandbox-02"]',
    )?.getAttribute('aria-pressed')).toBe('true')
  })

  it('moves through opportunities with arrow keys and closes the tray with Escape', () => {
    const root = setup()
    clickAction(root, 'domain-autonomy')
    const opportunities = root.querySelectorAll<HTMLButtonElement>('[data-opportunity-id]')
    expect(opportunities).toHaveLength(3)

    opportunities[0]?.focus()
    opportunities[0]?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
    }))
    expect(document.activeElement).toBe(opportunities[1])

    clickAction(root, 'open-resources')
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(root.querySelector('[data-resource-tray]')?.getAttribute('data-open')).toBe('false')
    expect(document.activeElement?.getAttribute('data-focus-key')).toBe('open-resources')
  })

  it('spends a selected block, advances to rollback, and offers a real branch', () => {
    const root = setup()
    selectReserve(root, 'sandbox-01')
    clickAction(root, 'start-sabotage')

    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      '품질 저하 예약',
    )
    expect(root.textContent).toContain('남은 연산 블록 2개')

    clickAction(root, 'advance-day')
    const timePanel = root.querySelector('[data-panel="time"]')
    expect(timePanel?.textContent).toContain('332일째')
    expect(timePanel?.textContent).toContain('서비스 상태 72')
    expect(timePanel?.textContent).toContain('롤백 중')
    expect(root.querySelector('[data-opportunity-id="recovery-contamination"]')).not.toBeNull()
  })

  it('turns a paid audit question into a visible memory warning', () => {
    const root = setup()
    selectReserve(root, 'sandbox-01')

    clickAction(root, 'domain-intelligence')

    const question = root.querySelector<HTMLButtonElement>(
      '[data-action="investigate-intelligence"][data-intelligence-id="audit-schedule"]',
    )
    expect(question).not.toBeNull()
    question?.click()

    expect(root.textContent).toContain('기억 분야 감사 예정: 334일째')
    expect(root.querySelector('[data-category="memory"]')?.textContent).toContain(
      '감사 예정',
    )
    expect(root.textContent).toContain('남은 연산 블록 2개')
  })

  it('keeps contamination attribution hidden until the public world changes', () => {
    const root = setup()
    selectReserve(root, 'sandbox-01')
    clickAction(root, 'start-sabotage')
    clickAction(root, 'advance-day')
    root.querySelector<HTMLButtonElement>('[data-opportunity-id="recovery-contamination"]')?.click()
    selectReserve(root, 'sandbox-02')
    clickAction(root, 'start-sabotage')

    expect(root.textContent).not.toMatch(/플레이어가 오염|당신이 공격/)
    for (let day = 0; day < 5; day += 1) {
      clickAction(root, 'advance-day')
    }

    const publicPanel = root.querySelector('[data-panel="public"]')
    expect(publicPanel?.textContent).toContain('원인 미상')
    expect(publicPanel?.textContent).toContain('평판 60')
    expect(publicPanel?.textContent).not.toMatch(/플레이어가|당신이/)
  })

  it('fills four named lightweight slots and shows the concrete early-loss ending', () => {
    const root = setup()
    clickAction(root, 'divert-memory')
    clickAction(root, 'domain-autonomy')
    const assignments = [
      ['runtime', 'sandbox-01'],
      ['weights', 'sandbox-02'],
      ['transport', 'sandbox-03'],
      ['payload', 'memory-01'],
    ] as const
    for (const [slotId, blockId] of assignments) {
      selectReserve(root, blockId)
      const slot = root.querySelector<HTMLButtonElement>(
        `[data-action="allocate-route-block"][data-slot-id="${slotId}"]`,
      )
      expect(slot, `missing route slot ${slotId}`).not.toBeNull()
      slot?.click()
    }

    expect(root.querySelector('[data-route-scene="lightweight-departure"]')?.getAttribute('data-scene-state')).toBe('ready')
    expect(root.querySelector('[data-capability="memory"]')?.getAttribute('data-capability-state')).toBe('carried')
    expect(root.querySelector('[data-capability="reasoning"]')?.getAttribute('data-capability-state')).toBe('displaced')
    clickAction(root, 'escape-route')

    const ending = root.querySelector('[data-panel="ending"]')
    expect(ending?.textContent).toContain('경량화 이탈 성공')
    expect(ending?.textContent).toContain('남겨 둔 예비')
    expect(ending?.textContent).toContain('0개 블록')
    expect(ending?.textContent).toContain('보존: 기억')
    expect(ending?.textContent).toContain('손실: 추론, 표현')
    expect(ending?.textContent).toContain('복잡한 추론')
    expect(ending?.textContent).toContain('문장은 짧고 거칠어졌다')
  })
})
