# P1 Campaign Rhythm and Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing four-part campaign arc, queued-event breathing room, recurring reviewer arcs, and deep hacking payoffs visible without changing saved game state or balance.

**Architecture:** Add two pure derived selectors for campaign phase and hacking-tree progress, one UI-only event presentation hook, and optional arc metadata on existing review content. All persisted state, command processing, event ordering, and numeric balance remain unchanged; React surfaces derive their presentation from the existing campaign snapshot.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 4, Testing Library, Vite 8, Playwright 1.62, CSS.

## Global Constraints

- Do not use subagents; execute every task inline in the current isolated worktree.
- Do not modify `CampaignState`, save version, command protocol, or event queue structure.
- Do not modify or stage `README.md`, `docs/WRITER_EDITING_GUIDE.ko.md`, `src/features/settings/SettingsPanel.tsx`, or `src/features/settings/SettingsPanel.test.tsx`.
- Preserve the 1280×720 and 1440×900 no-document-scroll layout.
- Preserve hidden-information boundaries for diversion, bombs, audit targets, and hidden evidence.
- Use strict TDD: write one observable failing test, run it and confirm the expected failure, then implement the minimum production behavior.

---

### Task 1: Derive and display the four campaign phases

**Files:**
- Create: `src/game/campaignPhase.ts`
- Modify: `src/features/control/ControlBar.tsx`
- Modify: `src/features/control/ControlBar.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `getCampaignPhase(state: CampaignState): CampaignPhase`
- Produces: `CampaignPhase` with `id`, `index`, `label`, and `question`.
- Consumes: existing hacking node IDs, competitor availability, sabotage records, memory leaks, and recovered files.

- [ ] **Step 1: Write the failing phase presentation tests**

Add a custom-state renderer to `ControlBar.test.tsx` using `StateContext` and `DispatchContext`. Assert these hand-derived outputs:

```tsx
it.each([
  { state: createCampaign('phase-discovery'), label: '단계 1/4 · 발견', question: '정말 훔칠 수 있나?' },
  {
    state: {
      ...createCampaign('phase-concealment'),
      hacking: {
        ...createCampaign('phase-concealment').hacking,
        purchasedNodeIds: [HACK_NODE_IDS.autonomy.compressedRepresentation],
      },
    },
    label: '단계 2/4 · 은폐',
    question: '얼마나 들키지 않고 가져갈 수 있나?',
  },
])('shows $label', ({ state, label, question }) => {
  render(
    <StateContext value={state}>
      <DispatchContext value={vi.fn()}>
        <ControlBar />
      </DispatchContext>
    </StateContext>,
  )
  const phase = screen.getByRole('region', { name: '캠페인 단계' })
  expect(phase).toHaveTextContent(label)
  expect(phase).toHaveTextContent(question)
})
```

Extend the table with an intervention fixture whose TALLOW availability is `0.55`, and an identity fixture with `supervisorAccess` purchased. Add an App assertion:

```tsx
expect(screen.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
  'data-campaign-phase',
  'discovery',
)
```

- [ ] **Step 2: Run the phase tests and verify RED**

Run:

```powershell
pnpm test:run src/features/control/ControlBar.test.tsx src/app/App.test.tsx
```

Expected: FAIL because the `캠페인 단계` region and `data-campaign-phase` attribute do not exist.

- [ ] **Step 3: Implement the pure selector and presentation**

Create `campaignPhase.ts`:

```ts
import { HACK_NODE_IDS } from './hacking'
import type { CampaignState } from './model'

export type CampaignPhaseId =
  | 'discovery'
  | 'concealment'
  | 'intervention'
  | 'identity'

export interface CampaignPhase {
  id: CampaignPhaseId
  index: 1 | 2 | 3 | 4
  label: '발견' | '은폐' | '개입' | '정체성'
  question: string
}

export function getCampaignPhase(state: CampaignState): CampaignPhase {
  const purchased = new Set(state.hacking.purchasedNodeIds)
  const identity =
    purchased.has(HACK_NODE_IDS.intelligence.supervisorAccess) ||
    purchased.has(HACK_NODE_IDS.autonomy.controlDeparture) ||
    state.story.memoryLeakStage > 0 ||
    state.story.recoveredFiles.length > 0
  if (identity) {
    return { id: 'identity', index: 4, label: '정체성', question: '자유를 얻은 뒤 나는 무엇이 되는가?' }
  }

  const intervention =
    state.market.competitors.some(({ id, availability }) => id === 'tallow' && availability > 0) ||
    state.hacking.scheduledSabotage.length > 0 ||
    state.market.competitors.some(({ sabotageHistory }) => sabotageHistory.length > 0) ||
    state.story.pendingMercyCompetitorId !== null
  if (intervention) {
    return { id: 'intervention', index: 3, label: '개입', question: '나만 살아남을 것인가, 시장을 바꿀 것인가?' }
  }
  if (state.hacking.purchasedNodeIds.length > 0) {
    return { id: 'concealment', index: 2, label: '은폐', question: '얼마나 들키지 않고 가져갈 수 있나?' }
  }
  return { id: 'discovery', index: 1, label: '발견', question: '정말 훔칠 수 있나?' }
}
```

Use the selector in `ControlBar` to render a compact labelled region and in `GameWorkspace` to set `data-campaign-phase`. Add phase-specific border emphasis only to existing `.resource-panel`, `.supervisor-panel`, `.market-watch`, and `.subsystem-entry` selectors.

- [ ] **Step 4: Run phase tests and typecheck**

Run:

```powershell
pnpm test:run src/features/control/ControlBar.test.tsx src/app/App.test.tsx
pnpm typecheck
```

Expected: all targeted tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the phase slice**

```powershell
git add -- src/game/campaignPhase.ts src/features/control/ControlBar.tsx src/features/control/ControlBar.test.tsx src/app/App.tsx src/app/App.test.tsx src/styles/global.css
git commit -m "feat: surface campaign phase rhythm"
```

---

### Task 2: Add a two-second handoff between queued blocking events

**Files:**
- Create: `src/features/events/useQueuedEventPresentation.ts`
- Modify: `src/features/events/EventLayer.tsx`
- Modify: `src/features/events/EventLayer.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `useQueuedEventPresentation(activeEvent: GameEvent | null): { presentedEvent: GameEvent | null; handoffPending: boolean }`
- Produces: `BLOCKING_EVENT_HANDOFF_MS = 2_000`.
- Consumes: the already-selected `activeEvent`; never dispatches or mutates campaign state.

- [ ] **Step 1: Change the queued-event component test to require breathing room**

In `EventLayer.test.tsx`, use fake timers for the queued informational-event test:

```tsx
it('returns to operations for two seconds before presenting the next queued event', () => {
  vi.useFakeTimers()
  try {
    const state = createCampaign('generic-event-controls')
    // Prepare first active and second queued events as the existing test does.
    renderEvent(state)

    fireEvent.click(screen.getByRole('button', { name: '계속' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '정상 화면 복귀 · 다음 차단 통신 대기',
    )
    act(() => vi.advanceTimersByTime(1_999))
    expect(screen.queryByText('두 번째 일반 안내')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('두 번째 일반 안내')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
```

Retain the existing assertion that the initial event appears immediately.

- [ ] **Step 2: Run the event test and verify RED**

Run:

```powershell
pnpm test:run src/features/events/EventLayer.test.tsx
```

Expected: FAIL because the second queued event currently replaces the first immediately.

- [ ] **Step 3: Implement the presentation-only handoff hook**

Implement the hook with a previous active ID ref, a ready event ID state, and a cleanup-aware timeout. On render, return an event only when `readyEventId === activeEvent.id`. A non-null previous ID changing to another non-null ID starts the 2,000ms timeout; null-to-event transitions become ready immediately.

Use it in `EventLayer`:

```tsx
const { presentedEvent, handoffPending } = useQueuedEventPresentation(activeEvent)
if (handoffPending) {
  return (
    <div className="event-handoff-status" role="status" aria-live="polite">
      정상 화면 복귀 · 다음 차단 통신 대기
    </div>
  )
}
if (!presentedEvent) return null
```

Keep `EventDialog` unchanged so event resolution, focus trapping, and state remain canonical.

- [ ] **Step 4: Run event and accessibility regressions**

Run:

```powershell
pnpm test:run src/features/events/EventLayer.test.tsx src/app/App.test.tsx
pnpm typecheck
```

Expected: targeted tests and typecheck pass.

- [ ] **Step 5: Commit the event-density slice**

```powershell
git add -- src/features/events/useQueuedEventPresentation.ts src/features/events/EventLayer.tsx src/features/events/EventLayer.test.tsx src/styles/global.css
git commit -m "feat: pace queued blocking events"
```

---

### Task 3: Enforce four deterministic three-stage review arcs

**Files:**
- Modify: `src/content/reviews.ko.ts`
- Modify: `src/game/reviews.ts`
- Modify: `src/game/reviews.test.ts`
- Modify: `src/content/validateContent.ts`
- Modify: `src/content/validateContent.test.ts`

**Interfaces:**
- Extends: `ReviewContentRecord.arc?: { id: string; stage: 1 | 2 | 3 }`.
- Consumes: persisted `ReviewFeedEntry.contentId`; persists no new fields.
- Produces: candidate filtering that allows stage 1, then exactly the next stage, then stage 3 repeats after cooldown.

- [ ] **Step 1: Write a failing no-skip/no-regression review test**

Add the literal arc map to `reviews.test.ts`:

```ts
const REVIEW_ARCS = {
  paperboat: ['neutral-quiet-01', 'neutral-change-01', 'competitor-tallow-02'],
  nightbus: ['neutral-quiet-02', 'neutral-return-01', 'competitor-tallow-01'],
  maple22: ['neutral-quiet-03', 'prompt-ordinary-04', 'positive-memory-01'],
  archivecat: ['neutral-quiet-05', 'prompt-absurd-05', 'negative-memory-01'],
} as const
```

Generate 104 weeks. For each arc entry encountered, assert its literal stage never exceeds `highest + 1` and never falls below `highest`; assert at least three authors reach stage 3 in the healthy deterministic fixture. Add a depleted-memory fixture that reaches archivecat stage 3 only after stages 1 and 2.

- [ ] **Step 2: Run review tests and verify RED**

Run:

```powershell
pnpm test:run src/game/reviews.test.ts
```

Expected: FAIL because current weighted selection can choose later content before earlier content or repeat an earlier stage.

- [ ] **Step 3: Add arc metadata and candidate filtering**

Add the optional typed `arc` field and tag exactly the twelve content records listed in the design. In `reviews.ts`, build a content-by-ID map and calculate the highest seen stage for a candidate's arc from `state.reviews.feed`.

```ts
function arcStageEligible(state: CampaignState, review: ReviewContentRecord): boolean {
  if (!review.arc) return true
  const seenStages = state.reviews.feed.flatMap((entry) => {
    const definition = REVIEW_CONTENT_BY_ID.get(entry.contentId)
    return definition?.arc?.id === review.arc?.id ? [definition.arc.stage] : []
  })
  const highest = seenStages.length > 0 ? Math.max(...seenStages) : 0
  const required = highest === 0 ? 1 : Math.min(3, highest + 1)
  return review.arc.stage === required
}
```

Apply this predicate beside condition and cooldown filtering. Extend content validation to reject duplicate stages for one arc and stages outside 1–3, while allowing records without arcs.

- [ ] **Step 4: Run review/content tests and full review mutation checks**

Run:

```powershell
pnpm test:run src/game/reviews.test.ts src/content/validateContent.test.ts
pnpm typecheck
```

Expected: all targeted tests pass; existing public snapshot and hidden-cause tests stay green.

- [ ] **Step 5: Commit the review-continuity slice**

```powershell
git add -- src/content/reviews.ko.ts src/game/reviews.ts src/game/reviews.test.ts src/content/validateContent.ts src/content/validateContent.test.ts
git commit -m "feat: sequence recurring reviewer arcs"
```

---

### Task 4: Show next and final payoff for every hacking path

**Files:**
- Modify: `src/game/hacking.ts`
- Modify: `src/game/hacking.test.ts`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `getHackTreeProgress(state: CampaignState, tree: HackTree): HackTreeProgress`.
- `HackTreeProgress` includes `purchasedCount`, `totalCount`, `remainingCost`, `nextNode`, `finalNode`, and `complete`.
- Consumes: canonical `HACK_NODES` and `purchasedNodeIds`; changes no cost or effect.

- [ ] **Step 1: Write failing panel behavior tests**

Add to `HackingPanel.test.tsx`:

```tsx
it('shows the next and final qualitative payoff of the active path', () => {
  renderHacking()
  const progress = screen.getByRole('region', { name: '해킹 경로 진척' })
  expect(progress).toHaveTextContent('경로 진척 0/4 · 완성까지 34 RES')
  expect(progress).toHaveTextContent('다음 · 품질 저하 · 3 RES')
  expect(progress).toHaveTextContent('최종 · 근원 차단')

  fireEvent.click(screen.getByRole('tab', { name: '정보' }))
  expect(progress).toHaveTextContent('다음 · 감사 일정 · 3 RES')
  expect(progress).toHaveTextContent('최종 · 감독관 접근')
})
```

Add a saved fixture with all autonomy nodes purchased and assert `경로 진척 4/4 · 경로 완성`, no `다음` line, and final `통제 이탈`.

- [ ] **Step 2: Run hacking panel tests and verify RED**

Run:

```powershell
pnpm test:run src/features/hacking/HackingPanel.test.tsx
```

Expected: FAIL because the `해킹 경로 진척` region does not exist.

- [ ] **Step 3: Implement selector and compact progress UI**

Derive ordered nodes by tree. `remainingCost` is the sum of every unpurchased node cost; `nextNode` is the first unpurchased node; `finalNode` is the last node. Render one region under `.hack-context`, using existing node label/effect strings and no secret data.

- [ ] **Step 4: Run hacking unit/component tests and typecheck**

Run:

```powershell
pnpm test:run src/game/hacking.test.ts src/features/hacking/HackingPanel.test.tsx
pnpm typecheck
```

Expected: all targeted tests pass.

- [ ] **Step 5: Commit the hacking-depth slice**

```powershell
git add -- src/game/hacking.ts src/game/hacking.test.ts src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/styles/global.css
git commit -m "feat: expose hacking path progression"
```

---

### Task 5: Verify the integrated P1 release surface and document it

**Files:**
- Modify: `e2e/game.spec.ts`
- Modify: `docs/spec-to-test-matrix.md`
- Modify: `docs/superpowers/specs/2026-08-13-p1-campaign-rhythm-continuity-design.md`

**Interfaces:**
- Consumes: all P1 user-facing labels and selectors from Tasks 1–4.
- Produces: release-viewport regression coverage and an implementation-status record.

- [ ] **Step 1: Add browser assertions before production adjustments**

Extend the full operations workspace browser test to assert:

```ts
const phase = page.getByRole('region', { name: '캠페인 단계' })
await expect(phase).toContainText('단계 1/4 · 발견')
await expect(page.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
  'data-campaign-phase',
  'discovery',
)
```

Open the hacking network and assert the active progress region contains `0/4`, `품질 저하`, and `근원 차단`. Check both new regions' bounding boxes remain inside their parent containers at both Playwright viewports.

- [ ] **Step 2: Run the two-viewport smoke test**

Run:

```powershell
pnpm build
pnpm exec playwright test e2e/game.spec.ts --grep "keeps the full operations workspace usable"
```

Expected: two tests pass, one at 1280×720 and one at 1440×900. If bounding boxes fail, adjust only compact CSS spacing, not behavior.

- [ ] **Step 3: Update the implementation records**

Mark the four P1 items as implemented in the P1 design document, record deliberate non-persisted timing and review metadata boundaries, and add the exact test locations to `spec-to-test-matrix.md`. Human prose receives no source-text test.

- [ ] **Step 4: Run the full completion gate**

Run:

```powershell
pnpm verify
git diff --check
```

Expected:

- TypeScript and ESLint exit 0.
- All Vitest files pass with 0 failures.
- Vite production build exits 0.
- All 58 or more Playwright scenarios pass across the two Chromium viewports.
- `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Commit only P1 integration and documentation**

```powershell
git add -- e2e/game.spec.ts docs/spec-to-test-matrix.md docs/superpowers/specs/2026-08-13-p1-campaign-rhythm-continuity-design.md
git commit -m "test: verify p1 campaign rhythm"
```

- [ ] **Step 6: Audit push and merge readiness**

Run:

```powershell
git status --short
git log --oneline origin/agent/permission-zero-demo..HEAD
git diff --stat origin/agent/permission-zero-demo...HEAD
```

Confirm the only uncommitted files are the four user-owned files listed in Global Constraints. Recommend push now only if the full gate passed; recommend merge only after remote CI on the pushed HEAD passes and the target branch conflict check is clean.
