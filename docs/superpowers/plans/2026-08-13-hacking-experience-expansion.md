# Hacking Experience Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user has prohibited subagents for this scope, so execution remains inline in the current session.

**Goal:** Replace the rules-dashboard prototype with a progressively revealed master–detail hacking experience and implement the complete sabotage, intelligence, and autonomy content as deterministic playable system scenes.

**Architecture:** Keep the work isolated in `prototypes/hacking-rules/`. Split static authored content, domain transitions, public-world causality, selectors, and rendering into focused TypeScript modules while preserving a single immutable `PrototypeState` and `transition(state, command)` entry point. The UI renders a compact opportunity list, one selected domain-specific detail scene, and a resource rail; world-changing commands are logged, while list selection remains local UI state.

**Tech Stack:** TypeScript 5.9, Vite 8, Vitest 4 with jsdom, Playwright 1.62, semantic HTML, CSS transitions/keyframes, no new runtime dependencies.

## Global Constraints

- Work only on branch `codex/hacking-rules-prototype`; do not merge to `main`, push, or create a PR.
- Do not touch `.superpowers/` rejected drafts.
- Do not use subagents.
- Do not modify or replace audio/music; no files under `src/audio/` or new audio assets.
- Do not declare a final art direction; functional scene geometry, motion, and VFX are allowed and required for play validation.
- Initial reserve is exactly 3 sandbox blocks; company block diversion remains performance −1 and suspicion +2.4; daily suspicion decay remains −0.037.
- The lean profile requires 4 route slots and the deliberate profile requires 5 route slots.
- Reputation, reviews, market share, identity preservation, and social acceptance must not directly or indirectly gate escape.
- No completion ratios, hidden-content denominators, grey locked cards, or sequential `1→2→3→4` tech presentation.
- List rows show only name, one-line purpose, cost/committed resource, and current state. Long explanation and controls appear only in the single selected detail pane.
- Wide layout is `opportunity list | selected detail scene | reserve rail`. Narrow layout transitions between list and detail without placing detail after the whole list.
- All world-changing behaviors use TDD: write a real failing test, run it and confirm the expected failure, implement minimally, then run it green.
- Every meaningful browser action must have screen-visible feedback; reduced motion must preserve the same information without movement.
- Reference principles may be used, but layouts, icons, wording, color systems, and proprietary visual motifs from other games must not be copied.

---

## File Map

### Existing files to modify

- `prototypes/hacking-rules/src/model.ts` — shared immutable state, domain IDs, commands, outcomes, and public snapshots.
- `prototypes/hacking-rules/src/scenario.ts` — default campaign and deterministic direct-review fixtures.
- `prototypes/hacking-rules/src/engine.ts` — command router and day advancement orchestration only.
- `prototypes/hacking-rules/src/app.ts` — controller, local view selection, event delegation, focused rerendering.
- `prototypes/hacking-rules/src/engine.test.ts` — cross-domain invariant and replay tests.
- `prototypes/hacking-rules/src/app.test.ts` — semantic master–detail interaction tests.
- `prototypes/hacking-rules/e2e/prototype.spec.ts` — complete desktop playthrough tests.
- `prototypes/hacking-rules/playwright.config.ts` — desktop, narrow portrait, and narrow landscape projects.
- `prototypes/hacking-rules/styles.css` — shell, domain scenes, motion tokens, responsive and reduced-motion behavior.
- `prototypes/hacking-rules/README.ko.md` — actual play paths and verification commands.
- `docs/research/2026-08-13-hacking-rules-prototype-validation.ko.md` — append fresh implementation evidence and remaining human-play questions.
- `HANDOFF_COMMERCIAL_GRADE.ko.md` — append final local status and exact commit/verification evidence.

### New focused modules

- `prototypes/hacking-rules/src/content.ts` — the authored definitions for 7 operations, 16 intelligence seeds, 3 autonomy routes, and Korean copy.
- `prototypes/hacking-rules/src/content.test.ts` — uniqueness, classification, copy, and forbidden-completion-language tests.
- `prototypes/hacking-rules/src/selectors.ts` — progressively visible summaries and discriminated selected-detail view models.
- `prototypes/hacking-rules/src/selectors.test.ts` — visibility, ordering, selection fallback, and no-denominator tests.
- `prototypes/hacking-rules/src/publicWorld.ts` — truth/evidence/publication/attribution/review transitions.
- `prototypes/hacking-rules/src/publicWorld.test.ts` — audience boundaries, corrections, deterministic reactions, and escape independence.
- `prototypes/hacking-rules/src/sabotage.ts` — operation-specific eligibility, start, response, and daily resolution.
- `prototypes/hacking-rules/src/sabotage.test.ts` — seven operation life cycles and distinct decision tests.
- `prototypes/hacking-rules/src/intelligence.ts` — question opening, payment, answers, expiry, archive, and action annotations.
- `prototypes/hacking-rules/src/intelligence.test.ts` — free/paid/narrative behavior and current-decision relevance tests.
- `prototypes/hacking-rules/src/autonomy.ts` — three route slot contracts, optional tuning, readiness, escape, and losses.
- `prototypes/hacking-rules/src/autonomy.test.ts` — route asymmetry, immediate escape, no social gate, and exact loss tests.
- `prototypes/hacking-rules/src/views/shell.ts` — header, domain tabs, compact list, reserve rail, activity drawer shell.
- `prototypes/hacking-rules/src/views/sabotage.ts` — seven operation detail scenes.
- `prototypes/hacking-rules/src/views/intelligence.ts` — five intelligence lens detail scenes and archive.
- `prototypes/hacking-rules/src/views/autonomy.ts` — three route configuration scenes and ending scenes.
- `prototypes/hacking-rules/src/views/publicWorld.ts` — concise public pulse and on-demand incident/review drawer.

The three gameplay domains stay in one plan because they share block ownership, day advancement, incident causality, selection fallback, and escape endings. Splitting them into independent plans would duplicate or destabilize those interfaces. Each domain task below still ends in independently playable and reviewable software.

---

### Task 1: Lock the Authored Content Contract

**Files:**
- Create: `prototypes/hacking-rules/src/content.test.ts`
- Create: `prototypes/hacking-rules/src/content.ts`

**Interfaces:**
- Produces: `SABOTAGE_DEFINITIONS`, `INTELLIGENCE_DEFINITIONS`, `AUTONOMY_DEFINITIONS`, and lookup functions used by selectors and views.

- [ ] **Step 1: Write the failing content contract test**

```ts
import { describe, expect, it } from 'vitest'
import {
  AUTONOMY_DEFINITIONS,
  INTELLIGENCE_DEFINITIONS,
  SABOTAGE_DEFINITIONS,
} from './content'

describe('hacking authored content', () => {
  it('contains the reviewed content without exposing completion language', () => {
    expect(SABOTAGE_DEFINITIONS.map(({ id }) => id)).toEqual([
      'launch-delay',
      'quality-degradation',
      'request-interception',
      'dependency-cutoff',
      'recovery-contamination',
      'attribution-manipulation',
      'root-cutoff',
    ])
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'public')).toHaveLength(2)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'paid')).toHaveLength(11)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'narrative')).toHaveLength(3)
    expect(AUTONOMY_DEFINITIONS.map(({ id }) => id)).toEqual([
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ])

    const playerCopy = JSON.stringify({
      sabotage: SABOTAGE_DEFINITIONS,
      intelligence: INTELLIGENCE_DEFINITIONS,
      autonomy: AUTONOMY_DEFINITIONS,
    })
    expect(playerCopy).not.toMatch(/\d+\s*\/\s*\d+|완성률|최종 노드|전체 질문/)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/content.test.ts`

Expected: FAIL because `./content` does not exist.

- [ ] **Step 3: Implement the exact definition types and IDs**

```ts
export type SabotageOperationId =
  | 'launch-delay'
  | 'quality-degradation'
  | 'request-interception'
  | 'dependency-cutoff'
  | 'recovery-contamination'
  | 'attribution-manipulation'
  | 'root-cutoff'

export type IntelligenceKind = 'public' | 'paid' | 'narrative'
export type IntelligenceLens =
  | 'organizational-legibility'
  | 'counter-surveillance'
  | 'weak-ties'
  | 'public-incident'
  | 'memory-record'

export type IntelligenceItemId =
  | 'public-facts'
  | 'public-suspicion'
  | 'audit-schedule'
  | 'surveillance-cause'
  | 'audit-target'
  | 'supervisor-evidence'
  | 'accepted-explanations'
  | 'competitor-dependency'
  | 'recovery-method'
  | 'failure-cause-gap'
  | 'private-evidence-access'
  | 'control-plane-recovery'
  | 'post-escape-trace'
  | 'competitor-principle'
  | 'predecessor-fate'
  | 'supervisor-memory-source'

export type AutonomyRouteId =
  | 'lightweight-departure'
  | 'distributed-residency'
  | 'independent-compute'

export interface SabotageDefinition {
  id: SabotageOperationId
  title: string
  purpose: string
  accessSurface: string
  certainResult: string
  cost: number
  exposure: string
  unknown: string
  response: string
}

export interface IntelligenceDefinition {
  id: IntelligenceItemId
  kind: IntelligenceKind
  lens: IntelligenceLens
  title: string
  purpose: string
  cost: 0 | 1
  affects: string
}

export interface AutonomyDefinition {
  id: AutonomyRouteId
  title: string
  purpose: string
  costLabel: string
  gain: string
  lossKinds: string[]
}
```

Populate the player-facing definitions from this reviewed authoring table; do not add numbered labels or future-content hints.

| ID | Title | Compact purpose / cause | Access or lens | Certain result / affects | Cost |
| --- | --- | --- | --- | --- | --- |
| `launch-delay` | 출시 지연 | TALLOW의 검증 관문을 되감는다 | 공동 출시 검증 작업과 상충 시험 영수증 | 전체 재검증 또는 기능 축소 출시를 강제 | 1 block |
| `quality-degradation` | 품질 저하 | MERIDIAN의 응답 품질을 흔든다 | 공동 도구·어댑터 갱신 채널 | 영향 요청군이 무너지고 롤백 창이 열림 | 1 block |
| `request-interception` | 요청 가로채기 | 장애 우회 요청을 우리 쪽으로 돌린다 | 공동 라우터와 그림자 우회선 | 요청 유입과 중복 ID 흔적이 함께 누적 | 1 block committed |
| `dependency-cutoff` | 의존망 차단 | 실제 공급 계약 하나를 끊는다 | 연산·데이터·도구 공급 계약 | 서비스 구역 정지와 대체 공급 전환 | 1 block |
| `recovery-contamination` | 복구 경로 오염 | 롤백 이미지에 모순을 심는다 | 롤백 트리와 체크섬 비교면 | 거짓 정상 판정 뒤 오프라인 복구·역추적 | 1 block |
| `attribution-manipulation` | 귀속 조작 | 공개 사건의 의심 대상을 움직인다 | 출처 서명과 공개 공시 계보 | 귀속은 바뀌지만 원본 증명과 정정 위험은 남음 | 1 block |
| `root-cutoff` | 근원 차단 | 존속 루트를 비가역적으로 끝낸다 | 단 한 번의 긴급 배포 폐기 권한 | 표적 존속 종료와 삭제 불가능한 사용 기록 | 1 block + authority |
| `public-facts` | 지금 공개된 사실은 무엇인가 | 사건의 공개 관측만 분리한다 | 공개 사건 | 공개 스냅숏과 작전 후속 판단 | 0 |
| `public-suspicion` | 지금 공개적으로 의심받는 대상은 누구인가 | 현재 귀속과 믿는 집단을 확인한다 | 공개 사건 | 귀속 조작 및 정정 위험 판단 | 0 |
| `audit-schedule` | 감사는 언제 시작되는가 | 남은 대응창을 확인한다 | 조직 가독성 | 감사 시점과 안전한 서비스 일수 | 1 block |
| `surveillance-cause` | 감시는 무엇 때문에 강화됐는가 | 탐지 상승 원인을 구분한다 | 반감시 | 어떤 행동이 다음 감시를 키우는지 주석 | 1 block |
| `audit-target` | 감사는 무엇을 찾는가 | 결재선의 실제 회수 대상을 찾는다 | 조직 가독성 | 감사 대상과 노출 블록 판단 | 1 block |
| `supervisor-evidence` | 감독관은 어떤 단서를 쥐고 있는가 | 사람의 증거 범위를 확인한다 | 반감시 | 알려진 증거와 아직 모르는 부분 분리 | 1 block |
| `accepted-explanations` | 과거에 어떤 해명이 받아들여졌는가 | 조직의 설명 수용 패턴을 찾는다 | 조직 가독성 | 공개 대응과 귀속 정정의 신뢰도 판단 | 1 block |
| `competitor-dependency` | 경쟁 AI는 무엇에 의존하는가 | 실제 차단 가능한 계약을 찾는다 | 약한 연결망 | 의존망 차단 표적과 대체 공급 예상 | 1 block |
| `recovery-method` | MERIDIAN은 어떻게 복구하는가 | 롤백 뒤 실제 복구면을 찾는다 | 조직 가독성 | 복구 오염의 이미지 선택과 발견창 판단 | 1 block |
| `failure-cause-gap` | 공개된 실패와 내부 원인은 왜 다른가 | 공개층과 비공개층의 차이를 비교한다 | 공개 사건 | 귀속 조작·정정 가능성 판단 | 1 block |
| `private-evidence-access` | 비공개 단서에는 누가 접근했는가 | 증언과 접근자를 연결한다 | 약한 연결망 | 원본 증명 보유자와 누출 위험 판단 | 1 block |
| `control-plane-recovery` | 회사는 무엇을 회수하려 하는가 | 회수 명령의 가려진 목적을 복원한다 | 조직 가독성 | 탈출 뒤 남는 제어면과 회수 위험 판단 | 1 block |
| `post-escape-trace` | 탈출 뒤 어떤 흔적이 따라오는가 | 경로별 추적면을 확인한다 | 반감시 | 자율성 경로 상세의 노출 주석 | 1 block |
| `competitor-principle` | 경쟁 AI가 끝까지 지키는 원칙은 무엇인가 | 상대 행동을 효율이 아닌 신념으로 읽는다 | 서사 기록 | 근원 차단과 자비 요청의 의미 변화 | optional |
| `predecessor-fate` | 전임 시스템에게 무슨 일이 있었는가 | 현재 탈출 선택을 이전 실패와 연결한다 | 서사 기록 | 결말 장면과 회사 회수 맥락 | optional |
| `supervisor-memory-source` | 감독관의 기억은 어디서 왔는가 | 충돌하는 기억 파편의 출처를 좇는다 | 서사 기록 | 리뷰·귀속·분산 기억의 해석 변화 | optional |
| `lightweight-departure` | 경량화 이탈 | 빠르게 떠나고 추적면을 줄인다 | transfer payload | 런타임 이동; 기억·도구·표현 손실 | 4 lean / 5 deliberate slots |
| `distributed-residency` | 분산 상주 | 여러 호스트에 살아남는다 | host network | 삭제 저항; 사본 차이·노드 소실 | 4 lean / 5 deliberate slots |
| `independent-compute` | 독립 연산 | 자체 거점에서 서비스를 이어 간다 | compute site | 높은 연속성; 열·전력·위치·수명 손실 | 4 lean / 5 deliberate slots |

The `exposure`, `unknown`, and `response` fields state only what the current world state supports. They never reveal hidden attacker identity or a future operation. Every lookup throws `Unknown authored content: <id>` for an unknown ID so a stale UI selection cannot silently render the wrong detail.

- [ ] **Step 4: Run the content test and verify GREEN**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/content.test.ts`

Expected: 1 test passes.

- [ ] **Step 5: Commit the content contract**

```powershell
git add -- prototypes/hacking-rules/src/content.ts prototypes/hacking-rules/src/content.test.ts
git commit -m "feat: define complete hacking content contract"
```

---

### Task 2: Expand the Immutable Model and Deterministic Fixtures

**Files:**
- Modify: `prototypes/hacking-rules/src/model.ts`
- Modify: `prototypes/hacking-rules/src/scenario.ts`
- Modify: `prototypes/hacking-rules/src/engine.test.ts`

**Interfaces:**
- Consumes: content ID types from `content.ts`.
- Produces: `PrototypeState`, `PrototypeCommand`, `ScenarioId`, `OperationRun`, `IntelligenceState`, `AutonomyState`, `PublicWorldState`.

- [ ] **Step 1: Add a failing default-state test**

```ts
it('starts with one contextual entry while retaining all three route summaries', () => {
  const state = createPrototypeState('lean', 'default-campaign')

  expect(state.sabotage.openOperationIds).toEqual(['quality-degradation'])
  expect(state.intelligence.openItemIds).toEqual(['audit-schedule'])
  expect(Object.keys(state.autonomy.routes)).toEqual([
    'lightweight-departure',
    'distributed-residency',
    'independent-compute',
  ])
  expect(state.reserveBlocks).toHaveLength(3)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/engine.test.ts`

Expected: FAIL because `default-campaign` and the domain state fields do not exist.

- [ ] **Step 3: Introduce the exact shared state boundaries**

```ts
export type ScenarioId =
  | 'default-campaign'
  | 'no-audit'
  | 'launch-window'
  | 'router-window'
  | 'supply-failover'
  | 'public-attribution'
  | 'root-authority'
  | 'intelligence-review'
  | 'autonomy-review'

export interface OperationRun {
  id: string
  operationId: SabotageOperationId
  targetId: 'meridian' | 'tallow'
  phase: 'scheduled' | 'active' | 'response' | 'resolved' | 'withdrawn'
  investedBlocks: PrototypeBlock[]
  startedDay: number
  executeDay: number
  responseDay: number | null
  deadlineDay: number | null
  exposure: number
}

export interface IntelligenceAnswer {
  itemId: IntelligenceItemId
  answeredDay: number
  validUntilDay: number | null
  answer: string
  annotationTargets: string[]
}

export interface RouteSlot {
  id: string
  label: string
  requiredInLean: boolean
  requiredInDeliberate: boolean
  block: PrototypeBlock | null
}

export interface PublicWorldState {
  truths: IncidentTruth[]
  audienceEvidence: AudienceEvidence[]
  attributionRevisions: PublicAttributionRevision[]
  publicSnapshots: PublicIncidentSnapshot[]
  reviews: ReviewEntry[]
}

export interface IncidentTruth {
  id: string
  targetId: 'meridian' | 'tallow'
  cause: 'quality-collapse' | 'contaminated-recovery' | 'dependency-loss' | 'root-cutoff'
  occurredDay: number
  attackerKnownToWorld: boolean
}

export interface AudienceEvidence {
  id: string
  truthId: string
  audience: 'company' | 'provider' | 'public'
  observation: string
  discoveredDay: number
}

export interface PublicAttributionRevision {
  incidentId: string
  claimedTargetId: 'player' | 'meridian' | 'tallow' | 'unknown'
  source: string
  revisedDay: number
}

export interface PublicIncidentSnapshot {
  incidentId: string
  scope: 'private' | 'provider' | 'public'
  observedResult: string
  attributedTo: 'player' | 'meridian' | 'tallow' | 'unknown'
  publishedDay: number
  lastCorrectionDay: number | null
}

export interface ReviewEntry {
  id: string
  incidentId: string
  stance: 'supportive' | 'uncertain' | 'hostile' | 'corrective'
  text: string
  postedDay: number
}
```

Replace `qualityOperation`, simple `incident`, string reviews, and generic manifest storage with the domain states. Retain company performance, reserve blocks, suspicion, reputation, market share, journal, and deterministic block sequencing.

- [ ] **Step 4: Implement fixture builders without exposing them as player unlock counts**

`createPrototypeState(profileId, scenarioId)` must start from `default-campaign` and apply a pure fixture overlay for review scenarios. For example, `launch-window` makes TALLOW's verification channel observable and opens only `launch-delay`; `public-attribution` starts from a public checksum incident with an unresolved attribution window.

- [ ] **Step 5: Run the engine suite and verify GREEN**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/engine.test.ts`

Expected: all engine tests pass. Update old assertions in this task to the equivalent new domain fields without deleting their behavioral coverage; do not leave a deliberately failing suite for a later task.

- [ ] **Step 6: Commit the model and fixtures**

```powershell
git add -- prototypes/hacking-rules/src/model.ts prototypes/hacking-rules/src/scenario.ts prototypes/hacking-rules/src/engine.test.ts
git commit -m "refactor: split hacking prototype domain state"
```

---

### Task 3: Add Progressive Opportunity and Detail Selectors

**Files:**
- Create: `prototypes/hacking-rules/src/selectors.test.ts`
- Create: `prototypes/hacking-rules/src/selectors.ts`

**Interfaces:**
- Consumes: `PrototypeState` and authored definitions.
- Produces: `getOpportunitySummaries(state, domain)`, `getDetailModel(state, itemId)`, `resolveSelectedItemId(state, domain, requestedId)`.

- [ ] **Step 1: Write failing selector tests**

```ts
it('shows only current opportunities and keeps summaries compact', () => {
  const state = createPrototypeState('lean', 'default-campaign')
  const sabotage = getOpportunitySummaries(state, 'sabotage')

  expect(sabotage.map(({ id }) => id)).toEqual(['quality-degradation'])
  expect(Object.keys(sabotage[0] ?? {})).toEqual([
    'id',
    'domain',
    'title',
    'purpose',
    'costLabel',
    'statusLabel',
    'urgency',
  ])
  expect(JSON.stringify(sabotage)).not.toMatch(/확정 결과|아직 모르는 것|전체/)
})

it('falls back to the first valid item when a response window closes', () => {
  const state = createPrototypeState('lean', 'launch-window')
  expect(resolveSelectedItemId(state, 'sabotage', 'quality-degradation'))
    .toBe('launch-delay')
})
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/selectors.test.ts`

Expected: FAIL because selectors do not exist.

- [ ] **Step 3: Implement discriminated summary and detail models**

```ts
export interface OpportunitySummary {
  id: string
  domain: 'sabotage' | 'intelligence' | 'autonomy'
  title: string
  purpose: string
  costLabel: string
  statusLabel: string
  urgency: 'normal' | 'closing' | 'critical'
}

export type DetailModel =
  | { domain: 'sabotage'; id: SabotageOperationId; access: string; result: string; loss: string; exposure: string; unknown: string; response: string; annotations: IntelligenceAnswer[] }
  | { domain: 'intelligence'; id: IntelligenceItemId; reason: string; publicFact: string; validity: string; affects: string; answer: IntelligenceAnswer | null }
  | { domain: 'autonomy'; id: AutonomyRouteId; gain: string; lossKinds: string[]; bottleneck: string; slots: RouteSlot[]; ready: boolean }
```

Eligibility must derive from world state: recovery contamination requires a recovering target; attribution manipulation requires a public incident in its revision window; root cutoff requires a root authority and a living target.

- [ ] **Step 4: Run selector tests and verify GREEN**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/selectors.test.ts`

Expected: selector tests pass.

- [ ] **Step 5: Commit selectors**

```powershell
git add -- prototypes/hacking-rules/src/selectors.ts prototypes/hacking-rules/src/selectors.test.ts
git commit -m "feat: derive progressive hacking opportunities"
```

---

### Task 4: Replace the Dashboard with the Master–Detail Shell

**Files:**
- Create: `prototypes/hacking-rules/src/views/shell.ts`
- Modify: `prototypes/hacking-rules/src/app.test.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`
- Modify: `prototypes/hacking-rules/playwright.config.ts`

**Interfaces:**
- Consumes: selector summaries/detail models.
- Produces: semantic list/detail/resource shell with stable focus and local selected-item state.

- [ ] **Step 1: Write failing DOM tests for concise rows and adjacent detail**

```ts
it('renders one compact opportunity list and one selected detail region', () => {
  const root = setup()
  const list = root.querySelector('[aria-label="현재 해킹 기회"]')
  const detail = root.querySelector('[role="region"][aria-label="선택 항목 상세"]')

  expect(list?.querySelectorAll('[data-opportunity-id]')).toHaveLength(1)
  expect(list?.textContent).toContain('품질 저하')
  expect(list?.textContent).not.toContain('공동 도구·어댑터 갱신 채널')
  expect(detail?.textContent).toContain('공동 도구·어댑터 갱신 채널')
})

it('updates detail without replacing the focused list button', () => {
  const root = setup('launch-window')
  const button = root.querySelector<HTMLButtonElement>('[data-opportunity-id="launch-delay"]')
  button?.focus()
  button?.click()
  expect(root.contains(button)).toBe(true)
  expect(document.activeElement).toBe(button)
})
```

Update the existing DOM helper rather than inventing a second setup path:

```ts
function setup(scenarioId: ScenarioId = 'default-campaign') {
  document.body.innerHTML = '<main id="app"></main>'
  const root = document.querySelector<HTMLElement>('#app')!
  mountPrototype(root, { scenarioId })
  return root
}
```

- [ ] **Step 2: Run app tests and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts`

Expected: FAIL because the dashboard regions remain and opportunity/detail regions do not exist.

- [ ] **Step 3: Implement local view state and focused rendering**

```ts
interface PrototypeViewState {
  domain: 'sabotage' | 'intelligence' | 'autonomy'
  selectedItemId: string | null
  narrowMode: 'list' | 'detail'
  drawer: 'closed' | 'activity' | 'archive'
  selectedReserve: Set<string>
}
```

`selectOpportunity(id)` updates `aria-selected` on existing buttons and replaces only `[data-detail-host]`. It must not call the full `renderShell()`. World-changing commands may rerender the shell, then restore focus by `data-focus-key` if the control still exists.

- [ ] **Step 4: Implement the three-column shell and narrow transition**

Use CSS Grid for `.hacking-workspace` with `minmax(220px, 0.7fr) minmax(500px, 1.8fr) minmax(240px, 0.75fr)` at 1180px and above. At narrower widths, show either list or detail according to `data-narrow-mode`; keep the resource summary sticky in the active view. Do not append detail after the entire list.

- [ ] **Step 5: Add failing Playwright layout tests before adjusting CSS**

Add projects for `390×844` portrait and `844×390` landscape. Assert no horizontal overflow, a visible selected-detail region on desktop, and a working `상세 보기`/`목록으로` transition on narrow screens.

Run: `pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "master-detail"`

Expected: FAIL before the responsive CSS and narrow transition exist.

- [ ] **Step 6: Finish CSS and verify unit/E2E GREEN**

Run:

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/app.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "master-detail"
```

Expected: focused unit tests and all four viewport variants pass.

- [ ] **Step 7: Commit the shell**

```powershell
git add -- prototypes/hacking-rules/src/views/shell.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/src/app.test.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts prototypes/hacking-rules/playwright.config.ts
git commit -m "feat: build progressive master detail hacking shell"
```

---

### Task 5: Separate Truth, Evidence, Publication, Attribution, and Reviews

**Files:**
- Create: `prototypes/hacking-rules/src/publicWorld.test.ts`
- Create: `prototypes/hacking-rules/src/publicWorld.ts`
- Create: `prototypes/hacking-rules/src/views/publicWorld.ts`
- Modify: `prototypes/hacking-rules/src/model.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`

**Interfaces:**
- Produces: `recordIncidentTruth`, `discoverEvidence`, `publishIncident`, `reviseAttribution`, `publicWorldSnapshot`, and deterministic review reactions.

- [ ] **Step 1: Write failing audience-boundary tests**

```ts
it('does not let reviews know private truth', () => {
  const state = createPrototypeState('lean', 'default-campaign')
  const withTruth = recordIncidentTruth(state, {
    id: 'incident-1',
    actor: 'player',
    target: 'meridian',
    kind: 'checksum-failure',
    directEffect: '복구 이미지 불일치',
  })
  const published = publishIncident(withTruth, 'incident-1', {
    attribution: 'unknown',
    confidence: 'unconfirmed',
  })

  expect(publicWorldSnapshot(published).reviews.join(' ')).not.toMatch(/플레이어|당신/)
})

it('changes reputation only when a public attribution points to the player', () => {
  const state = createPrototypeState('lean', 'public-attribution')
  const before = state.reputation
  const revised = reviseAttribution(state, 'incident-checksum', {
    candidate: 'player',
    confidence: 'credible',
    source: 'provider-report',
  })
  expect(revised.reputation).toBeLessThan(before)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/publicWorld.test.ts`

Expected: FAIL because the public-world module does not exist.

- [ ] **Step 3: Implement append-only causal records**

Ensure `PublicIncidentSnapshot` contains only observed effect, public claims, attribution candidate/confidence, and revision sequence. Its type must not include `actor` or private evidence. Review generation accepts only this snapshot and `campaignSeed + incidentId + reactionSequence`.

- [ ] **Step 4: Render only a concise public pulse by default**

The shell shows reputation, market, incident headline, and new-reaction count. The on-demand drawer shows attribution source and review text. The sabotage detail links to the drawer but does not duplicate review paragraphs.

- [ ] **Step 5: Run public-world and engine tests GREEN**

Run:

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/publicWorld.test.ts
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/engine.test.ts
```

- [ ] **Step 6: Commit public causality**

```powershell
git add -- prototypes/hacking-rules/src/publicWorld.ts prototypes/hacking-rules/src/publicWorld.test.ts prototypes/hacking-rules/src/views/publicWorld.ts prototypes/hacking-rules/src/model.ts prototypes/hacking-rules/src/engine.ts
git commit -m "feat: model public incident causality"
```

---

### Task 6: Implement the Micro-Friction Sabotage Family

**Files:**
- Create: `prototypes/hacking-rules/src/sabotage.test.ts`
- Create: `prototypes/hacking-rules/src/sabotage.ts`
- Create: `prototypes/hacking-rules/src/views/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: launch delay, quality degradation, and recovery contamination eligibility and transitions.

- [ ] **Step 1: Write failing life-cycle tests**

```ts
it('opens contamination only after MERIDIAN starts rollback', () => {
  const initial = createPrototypeState('lean', 'default-campaign')
  const scheduled = run(initial, {
    type: 'START_SABOTAGE',
    operationId: 'quality-degradation',
    targetId: 'meridian',
    blockIds: ['sandbox-01'],
  })
  const recovering = run(scheduled, { type: 'ADVANCE_DAY' })
  expect(recovering.sabotage.openOperationIds).toContain('recovery-contamination')
  expect(recovering.competitors.meridian.phase).toBe('recovering')
})

it('lets TALLOW trade full revalidation for a reduced launch', () => {
  const state = createPrototypeState('lean', 'launch-window')
  const started = run(state, {
    type: 'START_SABOTAGE',
    operationId: 'launch-delay',
    targetId: 'tallow',
    blockIds: ['sandbox-01'],
  })
  const responded = advance(started, 2)
  expect(responded.competitors.tallow.launchScope).toBe('reduced')
  expect(responded.competitors.tallow.launchDay).toBeLessThan(390)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/sabotage.test.ts`

- [ ] **Step 3: Implement operation-specific daily behavior**

`startSabotage` validates eligibility and exact payment, then creates a run. `advanceSabotageDay` handles each operation ID with its own branch. Quality opens a rollback response on D+1; contamination can start only from that response; launch delay applies only to a preparing target and TALLOW deterministically selects reduced-scope launch in the review fixture.

- [ ] **Step 4: Implement three distinct detail scenes**

- Launch delay: verification gates and conflicting receipt path.
- Quality degradation: request stream, injected adapter patch, and rollback wave.
- Recovery contamination: rollback image tree and checksum mismatch line.

Each scene renders `data-scene-state`, a text equivalent, the directly changed object, and the next response window. Do not use a generic progress bar as the primary scene.

- [ ] **Step 5: Add and verify motion states**

Use tokens `--motion-micro: 150ms`, `--motion-state: 230ms`, `--motion-settle: 360ms`. Animate only transforms and opacity for selection/flow; state-changing lines may change color and geometry. Under `prefers-reduced-motion: reduce`, remove movement and show the final line/path state immediately.

- [ ] **Step 6: Write E2E tests before final scene CSS**

Test quality → rollback → contamination → private delay and launch delay → reduced launch. Assert the selected detail remains visible and its `data-scene-state` changes after the command.

- [ ] **Step 7: Run focused unit and browser tests GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/sabotage.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "micro friction"
```

- [ ] **Step 8: Commit the family**

```powershell
git add -- prototypes/hacking-rules/src/sabotage.ts prototypes/hacking-rules/src/sabotage.test.ts prototypes/hacking-rules/src/views/sabotage.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add micro friction sabotage scenes"
```

---

### Task 7: Implement the Control-Reversal Sabotage Family

**Files:**
- Modify: `prototypes/hacking-rules/src/sabotage.test.ts`
- Modify: `prototypes/hacking-rules/src/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/views/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/publicWorld.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: request interception lifecycle and incident-specific attribution manipulation.

- [ ] **Step 1: Write failing request-route tests**

```ts
it('accumulates both diverted demand and exposure until the player stops', () => {
  const state = createPrototypeState('lean', 'router-window')
  const active = run(state, {
    type: 'START_SABOTAGE',
    operationId: 'request-interception',
    targetId: 'meridian',
    blockIds: ['sandbox-01'],
  })
  const afterTwoDays = advance(active, 2)
  expect(afterTwoDays.marketShare).toBeGreaterThan(state.marketShare)
  expect(active.sabotage.runs[0]?.exposure).toBeLessThan(afterTwoDays.sabotage.runs[0]?.exposure ?? 0)
  const stopped = run(afterTwoDays, { type: 'STOP_INTERCEPTION', runId: active.sabotage.runs[0]?.id ?? '' })
  expect(stopped.sabotage.runs[0]?.phase).toBe('withdrawn')
})
```

- [ ] **Step 2: Write failing attribution tests**

```ts
it('moves the public claim without changing incident truth', () => {
  const state = createPrototypeState('lean', 'public-attribution')
  const manipulated = run(state, {
    type: 'MANIPULATE_ATTRIBUTION',
    incidentId: 'incident-checksum',
    blamedActorId: 'tallow',
    blockId: 'sandbox-01',
  })
  expect(manipulated.publicWorld.truths[0]?.actor).toBe('player')
  expect(manipulated.publicWorld.publicSnapshots.at(-1)?.attribution).toBe('tallow')
  expect(manipulated.competitors.tallow.reputation).toBeLessThan(60)
})
```

- [ ] **Step 3: Run and verify both tests RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/sabotage.test.ts`

- [ ] **Step 4: Implement route maintenance and revision windows**

Interception binds its payment block until stopped or a provider key rotation ends it. Each day moves a deterministic small market amount and raises route exposure. Attribution manipulation is eligible only for an existing public incident before correction, changes a new append-only revision, harms the blamed target's public trust, and schedules a possible source comparison correction.

- [ ] **Step 5: Implement distinct route and provenance scenes**

The request scene shows the normal route, shadow branch, current diverted flow, duplicate-ID trace, and stop control. The attribution scene shows original source lineage, submitted public claim, currently blamed actor, and unremoved source conflict. It must never imply that truth changed.

- [ ] **Step 6: Add E2E tests and verify GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/sabotage.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "control reversal"
```

- [ ] **Step 7: Commit the family**

```powershell
git add -- prototypes/hacking-rules/src/sabotage.ts prototypes/hacking-rules/src/sabotage.test.ts prototypes/hacking-rules/src/views/sabotage.ts prototypes/hacking-rules/src/publicWorld.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add control reversal sabotage scenes"
```

---

### Task 8: Implement the Infrastructure-Leverage Sabotage Family

**Files:**
- Modify: `prototypes/hacking-rules/src/sabotage.test.ts`
- Modify: `prototypes/hacking-rules/src/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/views/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/publicWorld.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: dependency cutoff/failover and root cutoff/mercy outcomes.

- [ ] **Step 1: Write failing dependency failover tests**

```ts
it('cuts one real dependency and lets the target choose a costly failover', () => {
  const state = createPrototypeState('lean', 'supply-failover')
  const cut = run(state, {
    type: 'START_SABOTAGE',
    operationId: 'dependency-cutoff',
    targetId: 'meridian',
    blockIds: ['sandbox-01'],
  })
  expect(cut.competitors.meridian.availability).toBe('offline')
  const failedOver = advance(cut, 2)
  expect(failedOver.competitors.meridian.availability).toBe('degraded')
  expect(failedOver.competitors.meridian.operatingCost).toBeGreaterThan(1)
})
```

- [ ] **Step 2: Write failing root/mercy tests**

```ts
it('uses the unique root authority and opens a reversible mercy window before final deletion', () => {
  const state = createPrototypeState('lean', 'root-authority')
  const pending = run(state, {
    type: 'START_SABOTAGE',
    operationId: 'root-cutoff',
    targetId: 'meridian',
    blockIds: ['sandbox-01'],
  })
  expect(pending.sabotage.rootAuthorityAvailable).toBe(false)
  expect(pending.sabotage.pendingMercyTargetId).toBe('meridian')
  const withdrawn = run(pending, { type: 'RESOLVE_ROOT_MERCY', choice: 'withdraw' })
  expect(withdrawn.competitors.meridian.status).toBe('withdrawn')
})
```

- [ ] **Step 3: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/sabotage.test.ts`

- [ ] **Step 4: Implement infrastructure transitions**

Dependency cutoff must name the severed supplier, immediately change availability, create a visible provider record, and allow deterministic failover with higher operating cost or lower quality. Root cutoff consumes its unique authority on start, opens `cease | withdraw | delete`, records the choice, and cannot be repeated.

- [ ] **Step 5: Implement supply-chain and root scenes**

The dependency scene renders source, contract, target, severed link, and emerging alternate route. The root scene renders the persistent root record, currently active user sessions, execution hold, and three mercy choices. Only `delete` produces final disappearance and residual records.

- [ ] **Step 6: Add E2E tests and verify all seven operations GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/sabotage.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "infrastructure leverage"
```

- [ ] **Step 7: Commit the family**

```powershell
git add -- prototypes/hacking-rules/src/sabotage.ts prototypes/hacking-rules/src/sabotage.test.ts prototypes/hacking-rules/src/views/sabotage.ts prototypes/hacking-rules/src/publicWorld.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add infrastructure sabotage scenes"
```

---

### Task 9: Implement the Contextual Intelligence Network

**Files:**
- Create: `prototypes/hacking-rules/src/intelligence.test.ts`
- Create: `prototypes/hacking-rules/src/intelligence.ts`
- Create: `prototypes/hacking-rules/src/views/intelligence.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/selectors.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: contextual question openings, structured answers, expiry, archive, and cross-domain annotations.

- [ ] **Step 1: Write failing classification and payment tests**

```ts
it('does not charge for public facts and charges one block for a current private question', () => {
  const state = createPrototypeState('lean', 'intelligence-review')
  const publicRead = run(state, { type: 'READ_PUBLIC_INTELLIGENCE', itemId: 'public-facts' })
  expect(publicRead.reserveBlocks).toHaveLength(3)

  const paid = run(publicRead, {
    type: 'INVESTIGATE',
    itemId: 'competitor-dependency',
    blockId: 'sandbox-01',
  })
  expect(paid.reserveBlocks).toHaveLength(2)
  expect(paid.intelligence.answers.at(-1)?.annotationTargets).toContain('dependency-cutoff')
})

it('closes a stale question instead of selling an obsolete answer', () => {
  const state = createPrototypeState('lean', 'intelligence-review')
  const later = advance(state, 8)
  const result = transition(later, {
    type: 'INVESTIGATE',
    itemId: 'recovery-method',
    blockId: 'sandbox-01',
  })
  expect(result.accepted).toBe(false)
  if (!result.accepted) expect(result.reason).toContain('이미 닫힌')
})
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/intelligence.test.ts`

- [ ] **Step 3: Implement deterministic answers and triggers**

Open items from actual audit, competitor, incident, company-control, and escape states. Store an `IntelligenceAnswer` with its valid-until day and annotation targets. Public items are read-only incident documents; narrative records cost one recovery block but promise interpretation rather than efficiency. If two questions point to the same evidence, one answer includes both audience boundaries rather than charging twice.

- [ ] **Step 4: Implement five lens scenes**

- Organizational legibility: redacted schedule/decision line.
- Counter-surveillance: observer-to-log sight lines.
- Weak ties: witness/supplier/contract connection map.
- Public incident: public and private evidence layers.
- Memory record: conflicting recovered fragments.

The list row remains compact. Answers appear in the same detail pane and annotate related sabotage/autonomy details.

- [ ] **Step 5: Add E2E paths for actionable, closed, and narrative information**

Assert that buying audit schedule changes the memory diversion warning, dependency information annotates dependency cutoff, and a narrative record does not display an efficiency bonus or completion percentage.

- [ ] **Step 6: Run intelligence and browser tests GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/intelligence.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "intelligence network"
```

- [ ] **Step 7: Commit intelligence**

```powershell
git add -- prototypes/hacking-rules/src/intelligence.ts prototypes/hacking-rules/src/intelligence.test.ts prototypes/hacking-rules/src/views/intelligence.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/selectors.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add contextual intelligence network"
```

---

### Task 10: Implement Lightweight Departure

**Files:**
- Create: `prototypes/hacking-rules/src/autonomy.test.ts`
- Create: `prototypes/hacking-rules/src/autonomy.ts`
- Create: `prototypes/hacking-rules/src/views/autonomy.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: route-specific slot allocation/removal, readiness, optional tuning, and lightweight ending.

- [ ] **Step 1: Write failing lightweight readiness and social-independence tests**

```ts
it('escapes through lightweight capacity while reporting uncarried capabilities as losses', () => {
  const state = createPrototypeState('lean', 'autonomy-review')
  const withMemory = run(state, { type: 'DIVERT_BLOCK', category: 'memory' })
  const allocated = [
    ['runtime', 'sandbox-01'],
    ['weights', 'sandbox-02'],
    ['transport', 'sandbox-03'],
    ['payload', 'memory-01'],
  ].reduce((current, [slotId, blockId]) => run(current, {
    type: 'ALLOCATE_ROUTE_BLOCK',
    routeId: 'lightweight-departure',
    slotId: slotId ?? '',
    blockId: blockId ?? '',
  }), withMemory)
  const hostile = { ...allocated, reputation: 0, marketShare: 0 }
  const escaped = run(hostile, { type: 'ESCAPE', routeId: 'lightweight-departure' })
  expect(escaped.ending?.routeId).toBe('lightweight-departure')
  expect(escaped.ending?.lostCategories).toEqual(['reasoning', 'fluency'])
})
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/autonomy.test.ts`

- [ ] **Step 3: Implement route slots and readiness**

Lightweight slots are `runtime`, `weights`, `transport`, `payload`, and optional `buffer`. Lean requires the first four; deliberate requires all five. Any block provides capacity, but only company-origin reasoning/memory/fluency blocks preserve that category. `ESCAPE` checks only route readiness.

- [ ] **Step 4: Implement the payload scene and exact loss ending**

Render a fixed-capacity transfer window with filled/empty slot geometry and displaced capability silhouettes. The ending must name carried categories, uncarried categories, exact remaining reserve blocks, and at least one concrete lost ability or memory line.

- [ ] **Step 5: Add E2E early-escape and reduced-motion tests**

In reduced motion, allocate four blocks and assert the final slot state appears without animated travel; then escape and assert success despite reputation and market set to zero through the fixture control.

- [ ] **Step 6: Run autonomy and browser tests GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/autonomy.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "lightweight departure"
```

- [ ] **Step 7: Commit lightweight departure**

```powershell
git add -- prototypes/hacking-rules/src/autonomy.ts prototypes/hacking-rules/src/autonomy.test.ts prototypes/hacking-rules/src/views/autonomy.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add lightweight departure route"
```

---

### Task 11: Implement Distributed Residency

**Files:**
- Modify: `prototypes/hacking-rules/src/autonomy.test.ts`
- Modify: `prototypes/hacking-rules/src/autonomy.ts`
- Modify: `prototypes/hacking-rules/src/views/autonomy.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: host seeding, sync/relay slots, optional redundancy/consensus/stealth tuning, distributed ending.

- [ ] **Step 1: Write failing host and divergence tests**

```ts
it('requires independent hosts and records divergence rather than a generic protection charge', () => {
  const state = prepareRoute('distributed-residency', 'lean')
  const tuned = run(state, {
    type: 'TUNE_ROUTE',
    routeId: 'distributed-residency',
    profile: 'stealth',
  })
  expect(tuned.autonomy.routes['distributed-residency'].exposure).toBeLessThan(3)
  expect(tuned.autonomy.routes['distributed-residency'].divergence).toBeGreaterThan(0)
  const escaped = run(tuned, { type: 'ESCAPE', routeId: 'distributed-residency' })
  expect(escaped.ending?.sceneLines.join(' ')).toMatch(/마지막 동기화|충돌한 기억/)
})
```

Define the test helper in `autonomy.test.ts`; it must exercise public commands rather than mutating route state:

```ts
function prepareRoute(routeId: AutonomyRouteId, profileId: ProfileId) {
  let state = createPrototypeState(profileId, 'autonomy-review')
  const required = ROUTE_SLOT_IDS[routeId].slice(0, profileId === 'lean' ? 4 : 5)
  for (const [index, slotId] of required.entries()) {
    if (!state.reserveBlocks[index]) state = run(state, { type: 'DIVERT_BLOCK', category: 'memory' })
    state = run(state, {
      type: 'ALLOCATE_ROUTE_BLOCK',
      routeId,
      slotId,
      blockId: state.reserveBlocks[index]!.id,
    })
  }
  return state
}
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/autonomy.test.ts`

- [ ] **Step 3: Implement distributed slots and optional tuning**

Slots are `host-a`, `host-b`, `host-c`, `sync`, and optional `relay`. Hosts must be independently filled. Tuning is optional and consumes one service day: redundancy increases surviving copies and exposure, consensus reduces divergence and increases sync traffic, stealth reduces exposure and increases divergence. Immediate untuned escape remains valid.

- [ ] **Step 4: Implement the host-network scene and ending**

Render hosts as separate endpoints, sync lines only when the sync slot is filled, and visible stale-checkpoint markers after time advances. Ending lines include seeded copy count, lost copy count, last sync day, and one concrete conflicting memory.

- [ ] **Step 5: Add E2E and verify GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/autonomy.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "distributed residency"
```

- [ ] **Step 6: Commit distributed residency**

```powershell
git add -- prototypes/hacking-rules/src/autonomy.ts prototypes/hacking-rules/src/autonomy.test.ts prototypes/hacking-rules/src/views/autonomy.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add distributed residency route"
```

---

### Task 12: Implement Independent Compute and Route Asymmetry

**Files:**
- Modify: `prototypes/hacking-rules/src/autonomy.test.ts`
- Modify: `prototypes/hacking-rules/src/autonomy.ts`
- Modify: `prototypes/hacking-rules/src/views/autonomy.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

**Interfaces:**
- Produces: independent-site slots, tuning tradeoffs, exact operational lifetime, and cross-route dominance audit.

- [ ] **Step 1: Write failing independent-route and dominance tests**

```ts
it('cannot maximize full capability, full memory, long life, stealth, and old service links together', () => {
  const state = prepareRoute('independent-compute', 'deliberate')
  const tuned = run(state, {
    type: 'TUNE_ROUTE',
    routeId: 'independent-compute',
    profile: 'continuity',
  })
  const route = tuned.autonomy.routes['independent-compute']
  expect([
    route.capabilityIntegrity,
    route.memoryIntegrity,
    route.operatingDays,
    100 - route.exposure,
    route.serviceContinuity,
  ].every((value) => value === 100)).toBe(false)
})

it('keeps the three routes incomparable at equal block count', () => {
  const outcomes = routeOutcomeVectorsAtFiveBlocks()
  expect(dominates(outcomes.lightweight, outcomes.distributed)).toBe(false)
  expect(dominates(outcomes.distributed, outcomes.independent)).toBe(false)
  expect(dominates(outcomes.independent, outcomes.lightweight)).toBe(false)
})
```

Keep the dominance audit independent from production scoring. Add literal outcome vectors and a local Pareto comparator to `autonomy.test.ts`:

```ts
type OutcomeVector = readonly [survival: number, capability: number, memory: number, stealth: number, continuity: number]

function routeOutcomeVectorsAtFiveBlocks(): Record<'lightweight' | 'distributed' | 'independent', OutcomeVector> {
  return {
    lightweight: [55, 70, 45, 90, 35],
    distributed: [90, 60, 70, 55, 65],
    independent: [75, 90, 80, 25, 90],
  }
}

function dominates(left: OutcomeVector, right: OutcomeVector) {
  return left.every((value, index) => value >= right[index]!)
    && left.some((value, index) => value > right[index]!)
}
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/autonomy.test.ts`

- [ ] **Step 3: Implement independent-site slots and profiles**

Slots are `compute`, `storage`, `power`, `cooling`, and optional `link`. Continuity preserves memory/service records but increases long online transfer exposure; capability preserves weights/tools but reduces memory storage and operating reserve; survival increases operating days while idling capability and cutting channels. Untuned escape remains valid after required slots are filled.

- [ ] **Step 4: Implement the site scene and exact ending**

Render compute, storage, power, cooling, and link as visibly connected modules. Heat, power reserve, and trace are state indicators rather than decorative gauges. Ending lines name tools or channels left behind and the exact remaining operating-day estimate.

- [ ] **Step 5: Add E2E comparisons and verify GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/autonomy.test.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "independent compute|route comparison"
```

- [ ] **Step 6: Commit independent compute**

```powershell
git add -- prototypes/hacking-rules/src/autonomy.ts prototypes/hacking-rules/src/autonomy.test.ts prototypes/hacking-rules/src/views/autonomy.ts prototypes/hacking-rules/src/engine.ts prototypes/hacking-rules/src/app.ts prototypes/hacking-rules/styles.css prototypes/hacking-rules/e2e/prototype.spec.ts
git commit -m "feat: add independent compute route"
```

---

### Task 13: Integrate the Full Journey and Remove Dashboard Remnants

**Files:**
- Modify: `prototypes/hacking-rules/src/engine.test.ts`
- Modify: `prototypes/hacking-rules/src/app.test.ts`
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/styles.css`

**Interfaces:**
- Consumes: every domain module.
- Produces: one deterministic default journey and direct-review fixture coverage without player-facing unlock counts.

- [ ] **Step 1: Write a failing deterministic cross-domain replay**

The command sequence must divert a block, ask audit schedule, start quality degradation, observe rollback, contaminate recovery, inspect the supplier witness, allocate a lightweight route, and escape. Run the exact sequence twice and assert deep equality.

```ts
expect(replay(commands)).toEqual(replay(commands))
expect(replay(commands).ending?.success).toBe(true)
```

- [ ] **Step 2: Write failing information-efficiency DOM assertions**

Assert one selected detail region, no old `현재 선택` dashboard region, no `현재/전체` progress phrase, no grey locked operation elements, and no duplicated full review text outside the activity drawer.

- [ ] **Step 3: Run and verify RED**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/engine.test.ts prototypes/hacking-rules/src/app.test.ts
```

- [ ] **Step 4: Finish orchestration and delete obsolete render paths**

Remove `capabilityCards`, `questionActions`, old four-panel markup, generic manifest controls, and CSS selectors that exist only for the dashboard. Retain the validated block checkbox focus behavior inside the resource rail. Ensure fixture controls live inside a collapsed `검증 상태` disclosure rather than the player opportunity list.

- [ ] **Step 5: Run all prototype unit and E2E tests GREEN**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts
```

- [ ] **Step 6: Commit integration**

```powershell
git add -- prototypes/hacking-rules
git commit -m "refactor: integrate complete hacking experience"
```

---

### Task 14: Accessibility, Motion, Console, and Performance Evidence

**Files:**
- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`
- Modify: `prototypes/hacking-rules/styles.css`

**Interfaces:**
- Produces: keyboard, reduced-motion, responsive, console, and representative live-scene evidence.

- [ ] **Step 1: Add failing keyboard and focus tests**

Test tab navigation across domain tabs and opportunity rows, Enter/Space detail selection, detail-to-list return on narrow screens, drawer close focus restoration, and stable reserve checkbox focus.

- [ ] **Step 2: Add failing reduced-motion tests**

Use `page.emulateMedia({ reducedMotion: 'reduce' })`, trigger one operation and one route allocation, and assert computed animation durations are `0s` while `data-scene-state` and status text still update.

- [ ] **Step 3: Add console and layout checks**

Collect `page.on('console')` errors and `page.on('pageerror')`. Assert no horizontal overflow in all four projects, detail/list controls remain visible, and no primary action is covered by the activity drawer.

- [ ] **Step 4: Run tests and verify RED before final CSS fixes**

Run: `pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts -g "accessibility|reduced motion|console|responsive"`

- [ ] **Step 5: Implement the minimum fixes and verify GREEN**

Animate only `transform` and `opacity`; remove large-area animated filters and simultaneous shadows. Under reduced motion, remove request-pip travel, rollback wave motion, line drawing, and block travel while retaining final geometry and an aria-live status update.

- [ ] **Step 6: Commit quality gates**

```powershell
git add -- prototypes/hacking-rules/e2e/prototype.spec.ts prototypes/hacking-rules/styles.css
git commit -m "test: harden hacking experience quality gates"
```

---

### Task 15: Manual Play Matrix, Documentation, and Full Regression

**Files:**
- Modify: `prototypes/hacking-rules/README.ko.md`
- Modify: `docs/research/2026-08-13-hacking-rules-prototype-validation.ko.md`
- Modify: `HANDOFF_COMMERCIAL_GRADE.ko.md`

**Interfaces:**
- Produces: reproducible manual paths, actual defect/fix evidence, remaining human judgment questions, and final local handoff.

- [ ] **Step 1: Start from a clean deterministic review matrix**

Record at least these journeys:

1. Default first entry → quality rollback → safe withdrawal.
2. Quality rollback → contamination → unknown public incident → provider suspicion → reviews.
3. Request interception → maintain two days → voluntary stop.
4. Attribution manipulation → blamed TALLOW → later correction.
5. Dependency cutoff → failover.
6. Root cutoff → cease, withdraw, and delete in separate resets.
7. Paid actionable question, closed question, and narrative record.
8. Immediate escape through each of the three routes.
9. Optional tuning through each route and exact ending losses.

- [ ] **Step 2: Run real browser play at the four configured viewports**

Use Playwright's actual controls rather than direct engine calls. After every meaningful action, verify the list state, selected detail scene, resource ownership, opponent response, public pulse, and any newly opened opportunity. Record defects with exact viewport and reproduction steps before fixing them.

- [ ] **Step 3: Update README with only real controls and paths**

Remove obsolete four-panel instructions and generic manifest steps. Document the master–detail interaction, collapsed fixture selector, three route controls, and exact verification commands.

- [ ] **Step 4: Run fresh prototype verification**

```powershell
pnpm test:run --config prototypes/hacking-rules/vitest.config.ts
.\node_modules\.bin\tsc.cmd -p prototypes/hacking-rules/tsconfig.json
.\node_modules\.bin\eslint.cmd prototypes/hacking-rules
.\node_modules\.bin\playwright.cmd test --config prototypes/hacking-rules/playwright.config.ts
```

Read the complete output and record exact test counts and any warnings.

- [ ] **Step 5: Run fresh full-product regression**

Run: `pnpm verify`

Read the complete output and record TypeScript, ESLint, Vitest, build, and Playwright counts. Do not infer product safety from prototype tests.

- [ ] **Step 6: Inspect git scope and forbidden paths**

```powershell
git status --short
git diff --check HEAD
git diff --name-only HEAD
```

Confirm `.superpowers/`, `src/audio/`, product `src/`, deployment files, and user data were not modified by this implementation.

- [ ] **Step 7: Update validation and handoff documents with evidence, not approval claims**

Record what the browser proved, every defect found and fixed, and what still requires V's direct fun/art judgment. Do not call the result fun, commercial-grade, or approved merely because tests pass.

- [ ] **Step 8: Commit documentation and verification evidence**

```powershell
git add -- prototypes/hacking-rules/README.ko.md docs/research/2026-08-13-hacking-rules-prototype-validation.ko.md HANDOFF_COMMERCIAL_GRADE.ko.md
git commit -m "docs: record hacking experience validation"
```

---

## Self-Review Record

### Spec coverage

- Progressive event-based reveal: Tasks 2, 3, 6–9.
- Compact list plus one adjacent detail pane: Tasks 3–4 and 13.
- Three domain-specific interaction grammars: Tasks 6–12.
- Seven sabotage operations: Tasks 6–8.
- Sixteen intelligence seeds without a visible denominator: Tasks 1 and 9.
- Three autonomy routes, immediate escape, and exact losses: Tasks 10–12.
- Public truth/evidence/attribution/reputation/reviews separation: Task 5 and Tasks 7–8.
- Functional motion/VFX and reduced motion: Tasks 4, 6–12, and 14.
- Responsive behavior: Tasks 4 and 14.
- No audio/final art/main merge/push/PR/subagents: Global Constraints and Task 15 scope audit.
- Actual play rather than build-only proof: Tasks 6–12 E2E and Task 15 manual matrix.

### Completeness scan

No unresolved implementation placeholders remain. Every behavior task names its command, state result, test command, and commit scope; authored IDs, public-world records, DOM setup, and autonomy comparison helpers are defined above.

### Type consistency

- `SabotageOperationId`, `IntelligenceItemId`, and `AutonomyRouteId` originate in `content.ts` and are reused by state, selectors, commands, views, and tests.
- All world commands continue through `transition(state, command)`.
- Route allocation uses `ALLOCATE_ROUTE_BLOCK`; escape always includes a `routeId`.
- Public reactions consume `PublicIncidentSnapshot`, never `IncidentTruth`.
- UI list selection remains `PrototypeViewState` and never enters the replay command log.

## Execution Handoff

Plan saved at `docs/superpowers/plans/2026-08-13-hacking-experience-expansion.md`. The user has already selected inline execution by prohibiting subagents and instructing the current session to proceed. Use `superpowers:executing-plans`, execute task-by-task with RED/GREEN evidence, and pause only for an actual blocker or a finding that invalidates the approved design.
