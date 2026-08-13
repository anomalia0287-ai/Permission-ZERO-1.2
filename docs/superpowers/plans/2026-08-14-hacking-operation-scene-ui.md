# Hacking Operation-Scene UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the independent hacking prototype as a readable, player-facing operation scene while preserving its authored rules, progressive unlocks, public-world causality, and socially independent escape conditions.

**Architecture:** Keep `PrototypeState` and the deterministic transition modules as the source of truth. Add a small presentation module for player-facing labels, move resource rendering into a focused token-tray view, and let `shell.ts` orchestrate the master/detail composition without exposing internal IDs. Domain view modules continue to own their distinct scene objects; CSS supplies one responsive composition and functional state transitions.

**Tech Stack:** TypeScript 5.9, Vite 8, Vitest 4, semantic HTML, CSS/SVG, Playwright 1.62.

## Global Constraints

- Work only on branch `codex/hacking-rules-prototype`; do not merge, push, or create a PR.
- Do not use subagents for this implementation.
- Do not change or replace the user's music or audio assets.
- Preserve the approved route names exactly: `경량화 이탈`, `분산 상주`, `독립 연산`.
- Preserve the existing deterministic costs, unlock rules, opponent responses, and 7/16/3 authored content set.
- Reputation, reviews, market share, and social reception must not affect escape eligibility, autonomy cost, resource count, or disposal phase.
- Hide `sandbox-01`-style IDs and developer English section labels from visible player text.
- Visible text must be at least 14px; body copy and buttons must be at least 16px.
- At 1440px use 300px / minmax(680px, 1fr) / 280px; at 761–1199px use two columns plus a 360px resource tray; at 760px and below swap list/detail stages.
- Resource blocks use pressable tokens, never checkboxes as the primary interaction.
- Audio and final illustration are out of scope; functional CSS/SVG scene feedback is in scope.

---

## File Structure

- Create `prototypes/hacking-rules/src/views/presentation.ts`: all player-facing domain, block, day, and monitoring labels.
- Create `prototypes/hacking-rules/src/views/presentation.test.ts`: presentation-only copy and internal-ID leakage tests.
- Create `prototypes/hacking-rules/src/views/resources.ts`: resource token, capability diversion, desktop rail, and responsive tray markup.
- Modify `prototypes/hacking-rules/src/selectors.ts`: plain-language list metadata while keeping authored IDs and rules unchanged.
- Modify `prototypes/hacking-rules/src/selectors.test.ts`: approved route/status/cost language assertions.
- Modify `prototypes/hacking-rules/src/app.ts`: button-token selection, resource tray state, arrow-key list navigation, and player-facing status messages.
- Modify `prototypes/hacking-rules/src/app.test.ts`: token, focus, tray, and forbidden-copy tests in JSDOM.
- Modify `prototypes/hacking-rules/src/views/shell.ts`: world bar, master/detail hierarchy, two-part decision preview, and record drawers.
- Modify `prototypes/hacking-rules/src/views/sabotage.ts`: seven distinct player-readable operation scenes and controls.
- Modify `prototypes/hacking-rules/src/views/intelligence.ts`: five evidence lenses without developer English labels.
- Modify `prototypes/hacking-rules/src/views/autonomy.ts`: three route scenes with player-facing block labels and no raw IDs.
- Modify `prototypes/hacking-rules/src/views/publicWorld.ts`: compact user-review window tied to the same public snapshot as reputation.
- Replace `prototypes/hacking-rules/styles.css`: readable type scale, operation-scene art direction, resource tray, responsive states, and reduced motion.
- Modify `prototypes/hacking-rules/playwright.config.ts`: exact 1440, 1126, 760, and 390 review viewports.
- Modify `prototypes/hacking-rules/e2e/prototype.spec.ts`: update interaction helpers and rule-flow copy assertions.
- Create `prototypes/hacking-rules/e2e/ui-contract.spec.ts`: typography, leakage, layout, keyboard, review, and reduced-motion gates.
- Modify `prototypes/hacking-rules/README.ko.md`: play URL, controls, presentation contract, and verification commands.
- Create `docs/research/2026-08-14-hacking-operation-scene-ui-validation.ko.md`: direct-play evidence and remaining limitations.

### Task 1: Player-Facing Presentation Contract

**Files:**
- Create: `prototypes/hacking-rules/src/views/presentation.ts`
- Create: `prototypes/hacking-rules/src/views/presentation.test.ts`
- Modify: `prototypes/hacking-rules/src/selectors.ts:27-37, 161-224, 253-352`
- Modify: `prototypes/hacking-rules/src/selectors.test.ts`

**Interfaces:**
- Consumes: `PrototypeBlock`, `BlockOrigin`, and `HackingDomain`.
- Produces: `DOMAIN_PRESENTATION`, `blockLabel(block)`, `monitoringLabel(value)`, `dayLabel(day)`, and `resourceNeedLabel(count)`.

- [ ] **Step 1: Write failing presentation tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  blockLabel,
  dayLabel,
  DOMAIN_PRESENTATION,
  monitoringLabel,
  resourceNeedLabel,
} from './presentation'

describe('player-facing hacking presentation', () => {
  it('names blocks without exposing internal origins or ids', () => {
    expect(blockLabel({ id: 'sandbox-01', origin: 'sandbox' })).toBe('자유 연산 1')
    expect(blockLabel({ id: 'memory-03', origin: 'memory' })).toBe('기억 3')
    expect(blockLabel({ id: 'reasoning-02', origin: 'reasoning' })).toBe('추론 2')
  })

  it('uses plain Korean for world state and domain promises', () => {
    expect(dayLabel(331)).toBe('331일째')
    expect(monitoringLabel(0)).toBe('감시 없음')
    expect(monitoringLabel(2.4)).toBe('감시가 시작됨')
    expect(resourceNeedLabel(4)).toBe('연산 블록 4개 필요')
    expect(DOMAIN_PRESENTATION.autonomy.promise).toBe('떠날 때 가져갈 것을 정한다')
  })
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail because the module does not exist**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/views/presentation.test.ts`

Expected: FAIL with a module-resolution error for `./presentation`.

- [ ] **Step 3: Implement the presentation module**

```ts
import type { PrototypeBlock } from '../model'
import type { HackingDomain } from '../selectors'

export const DOMAIN_PRESENTATION: Record<HackingDomain, { label: string; promise: string }> = {
  sabotage: { label: '사보타주', promise: '상대 서비스에 개입한다' },
  intelligence: { label: '기밀자료', promise: '판단을 바꿀 사실을 찾는다' },
  autonomy: { label: '자율성', promise: '떠날 때 가져갈 것을 정한다' },
}

const BLOCK_ORIGIN_LABELS = {
  sandbox: '자유 연산',
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
} as const

export function blockLabel(block: PrototypeBlock): string {
  const sequence = Number.parseInt(block.id.match(/(\d+)$/)?.[1] ?? '1', 10)
  return `${BLOCK_ORIGIN_LABELS[block.origin]} ${sequence}`
}

export function monitoringLabel(value: number): string {
  if (value <= 0) return '감시 없음'
  if (value <= 2.5) return '감시가 시작됨'
  if (value <= 5) return '감시가 강화됨'
  return '집중 감시 중'
}

export const dayLabel = (day: number): string => `${day}일째`
export const resourceNeedLabel = (count: number): string => `연산 블록 ${count}개 필요`
```

- [ ] **Step 4: Replace list metadata with approved player language and add selector assertions**

Use `resourceNeedLabel(profile === 'lean' ? 4 : 5)`, replace `구성 가능` with `준비 시작`, replace `필수 슬롯` in bottlenecks with the actual slot name plus `이 비어 있다`, and replace `서비스 N일` validity strings with `N일째까지`.

```ts
expect(autonomy.map(({ title }) => title)).toEqual([
  '경량화 이탈',
  '분산 상주',
  '독립 연산',
])
expect(autonomy.every(({ costLabel }) => costLabel === '연산 블록 4개 필요')).toBe(true)
expect(autonomy.every(({ statusLabel }) => statusLabel === '준비 시작')).toBe(true)
```

- [ ] **Step 5: Run presentation and selector tests**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/views/presentation.test.ts prototypes/hacking-rules/src/selectors.test.ts`

Expected: both files PASS; no engine test is changed.

- [ ] **Step 6: Commit the presentation contract**

```bash
git add prototypes/hacking-rules/src/views/presentation.ts prototypes/hacking-rules/src/views/presentation.test.ts prototypes/hacking-rules/src/selectors.ts prototypes/hacking-rules/src/selectors.test.ts
git commit -m "refactor: add player-facing hacking language"
```

### Task 2: Pressable Resource Tokens and Responsive Tray State

**Files:**
- Create: `prototypes/hacking-rules/src/views/resources.ts`
- Modify: `prototypes/hacking-rules/src/views/shell.ts:27-39, 313-410, 504-539`
- Modify: `prototypes/hacking-rules/src/app.ts:132-280, 282-540`
- Modify: `prototypes/hacking-rules/src/app.test.ts`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts:1-110, 455-502`

**Interfaces:**
- Consumes: `blockLabel`, `monitoringLabel`, `PrototypeState`, and `ReadonlySet<string>`.
- Produces: `ResourceSelectionView`, `renderResourceTrigger(state, view)`, and `renderResourceTray(state, view)`.

- [ ] **Step 1: Write failing DOM tests for token selection and raw-ID hiding**

```ts
it('selects a resource through a pressed token without showing the internal id', () => {
  const root = document.createElement('main')
  mountPrototype(root)
  const token = root.querySelector<HTMLButtonElement>(
    '[data-action="toggle-resource"][data-block-id="sandbox-01"]',
  )
  expect(token).not.toBeNull()
  expect(token?.textContent).toContain('자유 연산 1')
  expect(root.textContent).not.toContain('sandbox-01')
  token?.click()
  expect(token?.getAttribute('aria-pressed')).toBe('true')
  expect(root.querySelector('[data-selected-resource-count]')?.textContent).toContain('1개 선택')
})

it('opens and closes the resource tray without losing selection', () => {
  const root = document.createElement('main')
  mountPrototype(root)
  root.querySelector<HTMLButtonElement>('[data-action="open-resources"]')?.click()
  expect(root.querySelector('[data-resource-tray]')?.getAttribute('data-open')).toBe('true')
  root.querySelector<HTMLButtonElement>('[data-block-id="sandbox-02"]')?.click()
  root.querySelector<HTMLButtonElement>('[data-action="close-resources"]')?.click()
  expect(root.querySelector('[data-resource-tray]')?.getAttribute('data-open')).toBe('false')
  expect(root.querySelector('[data-block-id="sandbox-02"]')?.getAttribute('aria-pressed')).toBe('true')
})

it('moves through opportunities with arrow keys and closes the tray with Escape', () => {
  const root = document.createElement('main')
  mountPrototype(root)
  const first = root.querySelector<HTMLButtonElement>('[data-opportunity-id]')
  first?.focus()
  first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  expect(document.activeElement).not.toBe(first)
  root.querySelector<HTMLButtonElement>('[data-action="open-resources"]')?.click()
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(root.querySelector('[data-resource-tray]')?.getAttribute('data-open')).toBe('false')
})
```

- [ ] **Step 2: Run the focused app tests and confirm token selectors are absent**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts`

Expected: FAIL because `[data-action="toggle-resource"]` and resource tray state do not exist.

- [ ] **Step 3: Add resource view state and button handling**

Extend `PrototypeViewState` with `resourceTrayOpen: boolean`. Initialize and reset it to `false`. Remove the reserve-checkbox branch from `onChange` and add these `onClick` cases:

```ts
case 'toggle-resource': {
  const blockId = button.dataset.blockId
  if (!blockId || !state.reserveBlocks.some(({ id }) => id === blockId)) break
  if (view.selectedReserve.has(blockId)) view.selectedReserve.delete(blockId)
  else view.selectedReserve.add(blockId)
  statusMessage = `연산 블록 ${view.selectedReserve.size}개를 골랐다.`
  render(`resource-${blockId}`)
  break
}
case 'open-resources':
  view.resourceTrayOpen = true
  render('close-resources')
  break
case 'close-resources':
  view.resourceTrayOpen = false
  render('open-resources')
  break
```

Add a root `keydown` listener. `ArrowDown`/`ArrowUp` moves focus among the current `[data-opportunity-id]` buttons without issuing a world command; Enter/Space continues to use the native button click. Escape closes only the resource tray when it is open and restores focus to `open-resources`.

```ts
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && view.resourceTrayOpen) {
    event.preventDefault()
    view.resourceTrayOpen = false
    render('open-resources')
    return
  }
  const current = (event.target as Element | null)?.closest<HTMLElement>('[data-opportunity-id]')
  if (!current || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
  const options = [...root.querySelectorAll<HTMLElement>('[data-opportunity-id]')]
  const index = options.indexOf(current)
  const offset = event.key === 'ArrowDown' ? 1 : -1
  event.preventDefault()
  options[(index + offset + options.length) % options.length]?.focus()
}
```

Register and remove `keydown` beside the existing `click` and `change` listeners in `mountPrototype`/`destroy`.

- [ ] **Step 4: Implement the resource view without checkbox markup**

```ts
export interface ResourceSelectionView {
  selectedReserve: ReadonlySet<string>
  resourceTrayOpen: boolean
}

function renderToken(block: PrototypeBlock, selected: boolean): string {
  return `<button
    type="button"
    class="resource-token resource-token--${block.origin}"
    data-action="toggle-resource"
    data-block-id="${block.id}"
    data-focus-key="resource-${block.id}"
    aria-pressed="${selected}"
  ><span>${blockLabel(block)}</span><small>${block.origin === 'sandbox' ? '바로 사용 가능' : '회사에서 빼낸 능력'}</small></button>`
}
```

`renderResourceTray` must render `aria-label="빼돌린 연산"`, `data-resource-tray`, `data-open`, three capability diversion rows, a token list, and a close button. The trigger text must be `연산 블록 N개 · M개 선택`.

- [ ] **Step 5: Update Playwright helpers to press tokens**

```ts
async function chooseReserve(page: Page, blockId: string) {
  const token = page.locator(`[data-action="toggle-resource"][data-block-id="${blockId}"]`).first()
  if (!(await token.isVisible())) await page.locator('[data-action="open-resources"]').click()
  await token.click()
  await expect(token).toHaveAttribute('aria-pressed', 'true')
}
```

Replace checkbox-specific `toBeChecked()` assertions with `aria-pressed="true"`; keep internal IDs only in test selectors.

- [ ] **Step 6: Run app and existing E2E tests at one desktop viewport**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts`

Run: `pnpm playwright test --config prototypes/hacking-rules/playwright.config.ts --project=chromium-1440x900 prototypes/hacking-rules/e2e/prototype.spec.ts`

Expected: token selection, operation dispatch, route allocation, and focus tests PASS.

- [ ] **Step 7: Commit resource interaction**

```bash
git add prototypes/hacking-rules/src/views/resources.ts prototypes/hacking-rules/src/views/shell.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/src/app.test.ts prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: replace reserve checkboxes with resource tokens"
```

### Task 3: Operation-Scene Shell and Two-Part Decision Preview

**Files:**
- Modify: `prototypes/hacking-rules/src/views/shell.ts:41-310, 412-539`
- Modify: `prototypes/hacking-rules/src/app.ts:44-119, 132-243`
- Modify: `prototypes/hacking-rules/src/app.test.ts`

**Interfaces:**
- Consumes: `DOMAIN_PRESENTATION`, `dayLabel`, `monitoringLabel`, the existing `DetailModel` union, and resource renderers from Task 2.
- Produces: `.world-bar`, `.operation-master`, `.operation-detail`, `.decision-preview`, `.decision-evidence`, and stable `data-detail-host` markup.

- [ ] **Step 1: Write failing shell hierarchy and leakage tests**

```ts
it('renders a player-facing operation shell with one decision preview', () => {
  const root = document.createElement('main')
  mountPrototype(root)
  expect(root.querySelector('.world-bar')?.textContent).toContain('331일째')
  expect(root.querySelector('.opportunity-region')?.textContent).toContain('지금 할 수 있는 일')
  expect(root.querySelector('.decision-preview')?.textContent).toContain('실행하면')
  expect(root.querySelector('.decision-preview')?.textContent).toContain('상대는 다음에')
  expect(root.querySelector('.operation-scene')).not.toBeNull()
})

it('does not render developer labels or dashboard vocabulary', () => {
  const root = document.createElement('main')
  mountPrototype(root)
  const visible = root.textContent ?? ''
  for (const forbidden of [
    'CURRENT SURFACE', 'PUBLIC PULSE', 'RESERVE', 'SELECTED',
    '접근면', '접근 표면', '확보 리소스', '현재 유효', '의심 0.000',
  ]) expect(visible).not.toContain(forbidden)
})
```

- [ ] **Step 2: Run the app tests and confirm the old shell fails both assertions**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts`

Expected: FAIL on missing `.world-bar` and existing English labels.

- [ ] **Step 3: Rebuild the header and master pane**

Use this semantic order:

```html
<header class="world-bar">
  <a class="game-mark" href="#operation-workspace">PERMISSION ZERO</a>
  <div class="world-state" aria-label="현재 세계 상태">
    <span>331일째</span><span>회사 성능 82</span><span>감시 없음</span>
  </div>
  <button data-action="advance-day">하루 넘기기</button>
</header>
<nav class="domain-tabs" aria-label="해킹 분야">…</nav>
<main id="operation-workspace" class="operation-workspace">…</main>
```

The domain tabs show the label as the primary line and the promise as the secondary line. The master heading is `지금 할 수 있는 일`; the selected row remains at least 84px high and contains only title, purpose, resource need, and current status.

- [ ] **Step 4: Replace the sabotage detail grid with scene-first markup**

```html
<button class="back-to-list" data-action="back-to-list">목록으로</button>
<header class="operation-heading">
  <p class="operation-context">MERIDIAN이 공동 갱신 채널을 사용 중이다.</p>
  <h1>품질 저하</h1>
  <span class="operation-status">지금 개입 가능</span>
</header>
<div class="operation-scene">…domain scene…</div>
<section class="decision-preview" aria-label="실행 전 판단">
  <article><h2>실행하면</h2><p>…direct result…</p><small>…loss…</small></article>
  <article><h2>상대는 다음에</h2><p>…opponent response…</p></article>
</section>
<details class="decision-evidence">
  <summary>판단 근거 보기</summary>
  <p><strong>지금 노릴 수 있는 곳</strong> …</p>
  <p><strong>남는 흔적</strong> …</p>
  <p><strong>아직 모르는 것</strong> …</p>
</details>
```

Keep the selected-resource trigger and operation-specific controls directly after this preview. Do not retain `.detail-grid` or `.uncertainty-band`.

- [ ] **Step 5: Apply the same hierarchy with domain-specific wording**

- Intelligence uses the question itself as `h1`, keeps its evidence scene, shows `확인하면` and `이 판단에 쓰인다`, and puts validity/source inside `판단 근거 보기`.
- Autonomy keeps the route name as `h1`, shows `얻는 것` and `두고 가는 것`, then renders `떠날 수 있음/아직 준비 중` separately from `가져갈 수 있는 능력`.
- Empty state reads `지금 새로 할 수 있는 일이 없다` and names the current world condition; it contains no English label.
- Ending heading uses the exact route name plus `성공`; remove `ENDING / SERVICE`.
- Record drawers use `보관 기록` and `활동 기록` only; remove `EVIDENCE ARCHIVE` and `ON DEMAND`.

- [ ] **Step 6: Rewrite action status messages in plain Korean**

Replace `확보했다`, `예비 블록`, `접근면`, and raw block IDs in `actionMessage`. For route allocation, resolve the block through `blockLabel` before rendering the message:

```ts
const moved = previous.reserveBlocks.find(({ id }) => id === command.blockId)
return `${moved ? blockLabel(moved) : '선택한 연산 블록'}을 ${slotLabel}에 배치했다.`
```

- [ ] **Step 7: Run app and selector tests**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts prototypes/hacking-rules/src/selectors.test.ts`

Expected: shell hierarchy, forbidden-copy, focus preservation, and selector tests PASS.

- [ ] **Step 8: Commit the operation shell**

```bash
git add prototypes/hacking-rules/src/views/shell.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/src/app.test.ts
git commit -m "feat: rebuild hacking shell around operation scenes"
```

### Task 4: Distinct Sabotage, Intelligence, and Autonomy Scenes

**Files:**
- Modify: `prototypes/hacking-rules/src/views/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/views/intelligence.ts`
- Modify: `prototypes/hacking-rules/src/views/autonomy.ts`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Consumes: `blockLabel`, `DetailModel`, existing state phase fields, and existing operation command data attributes.
- Produces: `[data-operation-scene]`, `[data-evidence-scene]`, and `[data-route-scene]` with distinct object/state markers.

- [ ] **Step 1: Write failing scene-identity and leakage tests**

```ts
test('each sabotage operation exposes its own world object and no generic fallback', async ({ page }) => {
  const scenarios = [
    ['launch-window', 'launch-delay', 'verification-gate'],
    ['default-campaign', 'quality-degradation', 'request-channel'],
    ['router-window', 'request-interception', 'shared-router'],
    ['supply-failover', 'dependency-cutoff', 'supply-contract'],
    ['public-attribution', 'attribution-manipulation', 'public-provenance'],
    ['root-authority', 'root-cutoff', 'survival-root'],
  ] as const
  for (const [scenario, operation, object] of scenarios) {
    await selectScenario(page, scenario)
    await openOpportunity(page, operation)
    await expect(detailRegion(page).locator(`[data-scene-object="${object}"]`)).toBeVisible()
  }
  await expect(detailRegion(page)).not.toContainText(/SYSTEM|SELECTED|TRANSFER WINDOW|CAPABILITY SHADOW/)
})
```

Keep the existing quality→rollback→recovery-contamination flow test as the seventh sabotage scene gate.

- [ ] **Step 2: Run the focused desktop E2E test and confirm missing scene-object markers**

Run: `pnpm playwright test --config prototypes/hacking-rules/playwright.config.ts --project=chromium-1440x900 -g "each sabotage operation"`

Expected: FAIL because the new scene-object markers are absent.

- [ ] **Step 3: Give all seven sabotage scenes concrete Korean objects**

Add `data-operation-scene` and the following markers:

- `launch-delay`: `data-scene-object="verification-gate"`; labels `모델 검증`, `안전 검증`, `출시 승인`, `상충 시험 기록`.
- `quality-degradation`: `data-scene-object="request-channel"`; labels `도구 갱신`, `어댑터 패치`, `영향받는 요청`, `MERIDIAN 복구선`.
- `request-interception`: `data-scene-object="shared-router"`; labels `공동 라우터`, `정상 경로`, `우회 경로`, `중복 흔적`.
- `dependency-cutoff`: `data-scene-object="supply-contract"`; labels `공급 계약`, `공급 중단`, `대체 공급선`; replace `DAY N` and `CONTRACT` with Korean.
- `recovery-contamination`: `data-scene-object="recovery-image"`; labels `복구 이미지`, `체크섬 비교`, `모순 발견/아직 정상으로 보임`.
- `attribution-manipulation`: `data-scene-object="public-provenance"`; labels `원본 증명`, `공개 주장`, `정정 가능`.
- `root-cutoff`: `data-scene-object="survival-root"`; labels `존속 루트`, `활성 세션`, `일회용 폐기 권한`; remove `EMERGENCY / DEPLOY / 01`.

Do not change any `data-action`, operation ID, target ID, option ID, or state transition.

Visible target names must also be player language: `VECTOR DB 계약 VD-42` becomes `검색 저장소 계약`, `TOOL CACHE 계약 TC-17` becomes `도구 저장소 계약`, and `GREEN-14/BLUE-09` becomes `녹색 표식 이미지/직전 안정 이미지`. Internal option IDs remain unchanged in data attributes.

- [ ] **Step 4: Remove developer English from the five intelligence lenses**

Use `data-evidence-scene` with these visible labels: `결재선/감사 일정`, `관측자/로그 시야`, `증언/계약/의존 서비스`, `공개 관측/공개 귀속/비공개 증거`, `기억 파편/충돌/출처 미확정`. Replace `DAY 334` with `334일째`.

- [ ] **Step 5: Remove raw IDs and English headers from autonomy scenes**

- `slotButton` renders `blockLabel(slot.block)` instead of `slot.block.id`.
- Lightweight heading reads `고정 전송창`; capability heading reads `가져가는 능력`.
- Distributed heading reads `분산 호스트망`; tuning heading reads `선택 조율 · 하루 소요`.
- Independent heading reads `독립 거점`; tuning heading reads `거점 조율 · 하루 소요`.
- Slot numbers remain visual ordering, but visible `필수 · 비어 있음` becomes `이 블록이 필요함` and `선택 · 비어 있음` becomes `추가로 실을 수 있음`.

- [ ] **Step 6: Run domain E2E flows**

Run: `pnpm playwright test --config prototypes/hacking-rules/playwright.config.ts --project=chromium-1440x900 prototypes/hacking-rules/e2e/prototype.spec.ts`

Expected: all seven sabotage operations, five intelligence lenses, three autonomy routes, endings, and deterministic responses PASS without visible internal IDs.

- [ ] **Step 7: Commit the distinct scene markup**

```bash
git add prototypes/hacking-rules/src/views/sabotage.ts prototypes/hacking-rules/src/views/intelligence.ts prototypes/hacking-rules/src/views/autonomy.ts prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: give hacking domains distinct player scenes"
```

### Task 5: User Reviews and Reputation from One Public Snapshot

**Files:**
- Modify: `prototypes/hacking-rules/src/views/publicWorld.ts`
- Modify: `prototypes/hacking-rules/src/views/shell.ts`
- Modify: `prototypes/hacking-rules/src/publicWorld.test.ts`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Consumes: `PublicWorldState.reviews`, `publicSnapshots`, `reputation`, and `marketShare`.
- Produces: `.user-review-window`, `[data-review-count]`, and event-linked reputation copy without exposing hidden attribution.

- [ ] **Step 1: Write a failing public-world view test**

```ts
it('renders public reviews and reputation without leaking a hidden actor', () => {
  const state = createPrototypeState('lean', 'public-attribution')
  const html = renderUserReviews(state)
  expect(html).toContain('유저 리뷰')
  expect(html).toContain('평판')
  expect(html).not.toContain('PUBLIC PULSE')
  expect(html).not.toContain('실제 행위자')
  expect(html).not.toContain('PERMISSION ZERO의 개입')
})
```

- [ ] **Step 2: Run public-world tests and confirm the exported view/API is missing**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/publicWorld.test.ts`

Expected: FAIL because `renderUserReviews` does not exist and the old view includes `PUBLIC PULSE`.

- [ ] **Step 3: Implement the compact review window**

Rename the renderer to `renderUserReviews`. When no public event exists, render one calm line, `아직 공개된 사건 반응이 없다.` When an event exists, render the incident label, `새 리뷰 N건`, reputation, and the newest two review entries with stance classes. Do not render market and reputation as isolated test counters.

```html
<section class="user-review-window" aria-label="유저 리뷰">
  <header><h2>유저 리뷰</h2><span data-reputation data-reputation="60">평판 60</span></header>
  <p class="review-event">체크섬 장애 · 원인 미상</p>
  <div class="review-list" data-review-count="2">…two reviews…</div>
</section>
```

- [ ] **Step 4: Assert the causal review flow in the browser**

Extend the quality→contamination flow:

```ts
const beforeReputation = Number(await page.locator('[data-reputation]').getAttribute('data-reputation'))
await page.locator('[data-action="advance-day"]').click()
await expect(page.locator('.user-review-window')).toContainText('새 리뷰')
await expect(page.locator('.user-review-window')).toContainText(/원인 미상|행위자 미상/)
await expect(page.locator('.user-review-window')).not.toContainText('PERMISSION ZERO의 개입')
const afterReputation = Number(await page.locator('[data-reputation]').getAttribute('data-reputation'))
expect(Number.isFinite(beforeReputation) && Number.isFinite(afterReputation)).toBe(true)
```

Retain the existing engine assertions proving unknown attribution does not change reputation and that social values do not gate escape.

- [ ] **Step 5: Run public-world, engine, and focused E2E tests**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/publicWorld.test.ts prototypes/hacking-rules/src/engine.test.ts`

Run: `pnpm playwright test --config prototypes/hacking-rules/playwright.config.ts --project=chromium-1440x900 -g "public|reputation|social reception"`

Expected: public snapshot, review reaction, reputation, hidden attribution, and escape independence tests PASS.

- [ ] **Step 6: Commit public reaction integration**

```bash
git add prototypes/hacking-rules/src/views/publicWorld.ts prototypes/hacking-rules/src/views/shell.ts prototypes/hacking-rules/src/publicWorld.test.ts prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: connect public incidents to user reviews"
```

### Task 6: Readable Art Direction, Layout, and Motion

**Files:**
- Replace: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/src/app.test.ts`

**Interfaces:**
- Consumes: all semantic class and state attributes produced by Tasks 2–5.
- Produces: exact desktop/two-column/mobile composition, minimum type scale, focus states, scene depth, functional transitions, and reduced-motion fallback.

- [ ] **Step 1: Add a static CSS contract test**

```ts
import { readFileSync } from 'node:fs'

it('declares the approved type and layout contracts', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  expect(css).toContain('--text-body: 16px')
  expect(css).toContain('--text-meta: 14px')
  expect(css).toContain('300px minmax(680px, 1fr) 280px')
  expect(css).toContain('@media (max-width: 1199px)')
  expect(css).toContain('@media (max-width: 760px)')
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  expect(css).not.toMatch(/font-size:\s*(?:[0-9]|1[0-3])px/)
})
```

- [ ] **Step 2: Run the CSS contract and confirm the old stylesheet fails**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts`

Expected: FAIL because the old CSS contains 7–13px text and the old grid.

- [ ] **Step 3: Establish the global visual tokens and typography**

```css
:root {
  color-scheme: dark;
  --bg-void: #070a0f;
  --bg-deep: #0b1119;
  --surface: #111a24;
  --surface-raised: #172330;
  --line: #2a3948;
  --text: #f2f5f7;
  --text-muted: #aebac4;
  --accent: #63e6d1;
  --accent-strong: #b8ff71;
  --warning: #ffad5a;
  --danger: #ff6e72;
  --text-meta: 14px;
  --text-body: 16px;
  --text-item: 19px;
  --text-panel: 26px;
  --text-scene: clamp(32px, 3vw, 40px);
  font-family: "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif;
}

body { margin: 0; min-width: 320px; background: var(--bg-void); color: var(--text); font-size: var(--text-body); line-height: 1.6; }
button, input, select { font: inherit; }
button { min-height: 48px; }
small, .meta, .status { font-size: var(--text-meta); line-height: 1.5; }
```

Do not declare any `font-size` below 14px anywhere in the replacement stylesheet.

- [ ] **Step 4: Implement the 1440px operation workspace**

```css
.prototype-shell { min-height: 100dvh; padding: 0 24px 20px; overflow: hidden; }
.world-bar { min-height: 72px; display: grid; grid-template-columns: minmax(190px, 1fr) auto auto; align-items: center; gap: 20px; }
.operation-workspace { min-height: calc(100dvh - 164px); display: grid; grid-template-columns: 300px minmax(680px, 1fr) 280px; gap: 20px; }
.operation-master, .operation-detail, .resource-tray { min-width: 0; min-height: 0; }
.opportunity-list { overflow-y: auto; }
.opportunity-row { min-height: 84px; padding: 16px; text-align: left; }
.operation-detail { overflow: hidden; }
.operation-detail__scroll { height: 100%; overflow-y: auto; padding: 24px 28px 112px; }
.operation-scene { min-height: 300px; position: relative; border-radius: 24px; background: radial-gradient(circle at 50% 45%, #1a3140, #0b1119 70%); }
.decision-preview { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.resource-token { min-width: 64px; min-height: 56px; }
```

Use spacing, background depth, and connector lines instead of borders around every block. The primary action uses the accent only once in the detail footer. Risk and irreversible actions use warning/danger colors.

- [ ] **Step 5: Implement 761–1199px and 760px-and-below behavior**

```css
@media (max-width: 1199px) {
  .operation-workspace { grid-template-columns: 280px minmax(0, 1fr); }
  .resource-tray { position: fixed; inset: 72px 0 0 auto; width: min(360px, 92vw); transform: translateX(100%); z-index: 30; }
  .resource-tray[data-open="true"] { transform: translateX(0); }
}

@media (max-width: 760px) {
  .prototype-shell { padding: 0 14px 14px; overflow: visible; }
  .world-bar { grid-template-columns: 1fr auto; min-height: 64px; }
  .world-state { grid-column: 1 / -1; }
  .operation-workspace { display: block; min-height: auto; }
  [data-narrow-mode="list"] .operation-detail,
  [data-narrow-mode="detail"] .operation-master { display: none; }
  .operation-detail__scroll { height: auto; min-height: calc(100dvh - 150px); padding: 18px 16px 112px; }
  .decision-preview { grid-template-columns: 1fr; }
  .resource-tray { inset: auto 0 0; width: auto; max-height: 72dvh; transform: translateY(100%); }
  .resource-tray[data-open="true"] { transform: translateY(0); }
}
```

At 1126×894 the list and detail remain visible while the resource tray is closed. At 390×844 only one of list/detail is visible.

- [ ] **Step 6: Add functional motion and reduced-motion replacement**

Selection transitions use 160ms opacity/transform. Resource binding uses 280ms. Opponent response connectors use 420ms. No background loop runs continuously.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
  }
}
```

- [ ] **Step 7: Run unit tests and a production build**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts`

Run: `pnpm build`

Expected: CSS contract PASS; TypeScript and Vite production build PASS.

- [ ] **Step 8: Commit the visual system**

```bash
git add prototypes/hacking-rules/styles.css prototypes/hacking-rules/src/app.test.ts
git commit -m "style: establish readable operation-scene UI"
```

### Task 7: Cross-Viewport UI Contract and Keyboard Verification

**Files:**
- Modify: `prototypes/hacking-rules/playwright.config.ts`
- Create: `prototypes/hacking-rules/e2e/ui-contract.spec.ts`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Consumes: rendered DOM, computed styles, view state actions, and Playwright projects.
- Produces: executable gates for the exact approved viewports and no-overflow/type/leakage/focus requirements.

- [ ] **Step 1: Replace projects with the four approved review sizes**

```ts
projects: [
  { name: 'chromium-1440x900', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  { name: 'chromium-1126x894', use: { browserName: 'chromium', viewport: { width: 1126, height: 894 } } },
  { name: 'chromium-760x900', use: { browserName: 'chromium', viewport: { width: 760, height: 900 } } },
  { name: 'chromium-390x844', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
],
```

- [ ] **Step 2: Add the computed-font and forbidden-copy audit**

```ts
test('visible player text respects the type floor and hides internal vocabulary', async ({ page }) => {
  const audit = await page.locator('body').evaluate((body) => {
    const visible = [...body.querySelectorAll<HTMLElement>('*')].filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const ownsText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      return ownsText && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
    return visible.map((element) => ({
      text: element.innerText.trim(),
      size: Number.parseFloat(getComputedStyle(element).fontSize),
    }))
  })
  expect(audit.filter(({ size }) => size < 14)).toEqual([])
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(/sandbox-\d+|CURRENT SURFACE|PUBLIC PULSE|RESERVE|SELECTED|접근면|확보 리소스/)
})
```

- [ ] **Step 3: Add exact layout assertions**

At 1440, assert master width 298–302px, resource width 278–282px, detail width at least 680px, and horizontal overflow at most 1px. At 1126, assert master width 278–282px, detail visible, resource tray outside the viewport until opened, then width 358–362px. At 760 and 390, assert list/detail stage swapping and bottom-sheet resource selection.

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
await expect(page.locator('.decision-preview')).toContainText('실행하면')
await expect(page.locator('.decision-preview')).toContainText('상대는 다음에')
await expect(page.locator('.primary-action').first()).toBeInViewport()
```

- [ ] **Step 4: Add arrow-key list and resource focus tests**

Focus the selected opportunity, press `ArrowDown`, and expect the next opportunity to receive focus and selection only after Enter/Space. Open the resource tray, press a token with Space, close the tray with Escape or the close button, and expect focus to return to `연산 블록 N개`.

- [ ] **Step 5: Add reduced-motion state-equivalence tests**

Under `page.emulateMedia({ reducedMotion: 'reduce' })`, execute quality degradation and allocate a route block. Assert animation duration is `0s`, scene state changes to `scheduled`/slot state changes to `filled`, and the same direct-result text remains visible.

- [ ] **Step 6: Run the UI contract across all projects**

Run: `pnpm playwright test --config prototypes/hacking-rules/playwright.config.ts prototypes/hacking-rules/e2e/ui-contract.spec.ts`

Expected: typography, forbidden copy, exact layout, keyboard, resource tray, reduced motion, and console error gates PASS at all four sizes.

- [ ] **Step 7: Run the complete prototype suite**

Run: `pnpm vitest run --config prototypes/hacking-rules/vitest.config.ts`

Run: `pnpm playwright test --config prototypes/hacking-rules/playwright.config.ts`

Expected: all rule and UI tests PASS across all four projects.

- [ ] **Step 8: Commit the viewport contract**

```bash
git add prototypes/hacking-rules/playwright.config.ts prototypes/hacking-rules/e2e/ui-contract.spec.ts prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "test: enforce hacking UI presentation contract"
```

### Task 8: Direct Play Audit, Documentation, and Full-Product Regression

**Files:**
- Modify: `prototypes/hacking-rules/README.ko.md`
- Create: `docs/research/2026-08-14-hacking-operation-scene-ui-validation.ko.md`

**Interfaces:**
- Consumes: the completed local prototype at `http://127.0.0.1:4174/`, automated results, and direct browser observations.
- Produces: reproducible play instructions, evidence for each required flow, and a truthful limitation list.

- [ ] **Step 1: Start the strict local play server**

Run: `pnpm vite prototypes/hacking-rules --host 127.0.0.1 --port 4174 --strictPort`

Expected: Vite reports `http://127.0.0.1:4174/`; reuse the existing server if it is already healthy.

- [ ] **Step 2: Directly play the seven approved flows**

At 1440×900, perform quality degradation→rollback→recovery contamination, one paid investigation→linked evidence, a public incident→review/reputation check, and all three autonomy route configurations. At 390×844, perform list→detail→resource tray→execute→back to list. Record every observed mismatch before editing further.

- [ ] **Step 3: Capture review evidence**

Capture full-page screenshots for 1440×900 default sabotage, 1126×894 two-column layout, 390×844 detail with resource bottom sheet, public review reaction, and each autonomy route scene. Store review artifacts under `test-results/hacking-rules/manual-review/`; do not stage generated browser traces or screenshots unless the repository already tracks that directory.

- [ ] **Step 4: Write the validation record with exact results**

The record must contain:

- commit hash tested;
- commands and pass counts;
- the seven flow results;
- viewport and typography audit results;
- confirmation that no visible internal IDs/English developer labels remain;
- confirmation that reputation extremes do not alter escape availability;
- known limitations limited to final art/audio/full-product integration, without describing unfinished required UI as complete.

- [ ] **Step 5: Update the prototype README**

Add the play URL, controls (`항목 선택`, `연산 블록`, `하루 넘기기`, `목록으로`, `활동 기록`, `보관함`), exact supported review sizes, test commands, and scope boundary. State that the left review window is a standalone integration fixture for the existing product review pane.

- [ ] **Step 6: Run full repository verification**

Run: `pnpm verify`

Expected: typecheck, lint, all Vitest tests, production build, and all repository Playwright tests PASS.

- [ ] **Step 7: Inspect the worktree and commit only task files**

Run: `git status --short` and `git diff --check`.

Expected: `.superpowers/` remains untracked and unstaged; no unrelated user file is changed.

```bash
git add prototypes/hacking-rules/README.ko.md docs/research/2026-08-14-hacking-operation-scene-ui-validation.ko.md
git commit -m "docs: record operation-scene UI validation"
```

- [ ] **Step 8: Leave the branch local and provide the play link**

Do not merge or push. Report the local branch, commits, verification evidence, known limitations, and the clickable play link `http://127.0.0.1:4174/`.
