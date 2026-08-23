# Intrusion Target Cards and Round Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace random immediate InIt deployment with first-round target cards, deterministic color-selected combat, and an automatic post-round card return with a distinct Anomi victory extraction.

**Architecture:** Keep card choreography in a DOM-facing board flow and keep the fixed-step combat runtime authoritative only after a target is selected. Pass an optional selected category into encounter creation, add an `extracting` player phase and `player-extracted` event for victory presentation, then return the runtime to its existing centered idle state before reopening cards.

**Tech Stack:** React 19, TypeScript 5.9, CSS transforms/keyframes, Canvas 2D, Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-08-22-intrusion-cards-and-audio-continuity.ko.md`

## Global Constraints

- First-round flow is `center-origin InIt → 2-second opening → target cards → 침투 → combat`.
- Every victory and defeat returns automatically to target cards; no second InIt click.
- Card mapping is `memory = 파랑/기억`, `reasoning = 빨강/추론`, `fluency = 노랑/유창성`.
- Only one enemy is deployed; bot speed remains `min(12.5, 9 + completedRounds × 0.1)`.
- Missing-category cards remain visible but disabled with `대상 없음`.
- Animate only transform and opacity; reduced motion uses a 120–180ms fade without bounce or travel.
- Preserve existing user changes in the dirty worktree. Do not create a commit or stage unrelated files.
- Execute Task 3 of `docs/superpowers/plans/2026-08-22-audio-continuity-and-global-button-feedback.md` before this plan's Task 3 so `snake-init-suction` exists at compile time.

## File Structure

- Create `src/features/resources/resourceIntrusionTargets.ts`: stable target-card definitions and candidate counts.
- Create `src/features/resources/ResourceIntrusionTargetCards.tsx`: accessible three-card selector with image assets and `침투` actions.
- Create `src/features/resources/ResourceIntrusionTargetCards.test.tsx`: selector ordering, availability, labels, and click contract.
- Create `public/resource-targets/memory-blue.png`: supplied blue cube asset.
- Create `public/resource-targets/reasoning-red.png`: supplied red cube asset.
- Create `public/resource-targets/fluency-yellow.png`: supplied yellow cube asset.
- Modify `src/features/resources/resourceSnakeEncounter.ts`: optional exact-category encounter selection.
- Modify `src/features/resources/resourceSnakeEncounter.test.ts`: deterministic selected-category coverage.
- Modify `src/features/resources/ResourceSnakeBoard.tsx`: board flow, timers, card launch, and automatic reopen.
- Modify `src/features/resources/ResourceSnakeBoard.test.tsx`: first-open, selection, automatic return, and unavailable cards.
- Modify `src/features/resources/resourceSnakeRuntime.ts`: victory extraction event/phase and resolve duration.
- Modify `src/features/resources/resourceSnakeRuntime.test.ts`: extraction semantics and idle deadline.
- Modify `src/features/resources/resourceSnakePresentation.ts`: extraction interpolation and trail/core fade.
- Modify `src/features/resources/resourceSnakePresentation.test.ts`: extraction scene behavior.
- Modify `src/styles/resource-snake.css`: circular InIt, card layout, stagger, launch, extraction-compatible presentation, responsive/reduced-motion rules.
- Modify `src/features/tutorial/introTutorial.ts` and tests: target-selection copy.
- Modify `src/features/settings/SettingsPanel.tsx` and tests: guide copy.
- Modify `e2e/resource-snake.ts`, `e2e/game.spec.ts`, and `e2e/modern-sf.spec.ts`: helpers and viewport assertions for the new flow.

---

### Task 1: Deterministic Category-Selected Encounters

**Files:**
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Test: `src/features/resources/resourceSnakeEncounter.test.ts`

**Interfaces:**
- Consumes: `CompanyCategory`, `SnakeResourceCandidate[]`, existing `CreateSnakeEncounterInput`.
- Produces: `CreateSnakeEncounterInput.targetCategory?: CompanyCategory` and an encounter whose sole enemy matches that category.

- [ ] **Step 1: Write the failing selected-category tests**

Add tests equivalent to:

```ts
it.each(['memory', 'reasoning', 'fluency'] as const)(
  'reserves only the explicitly selected %s category',
  (targetCategory) => {
    const first = createResourceSnakeEncounter({
      campaignSeed: 'selected-target',
      roundOrdinal: 4,
      successfulDeposits: 0,
      completedRounds: 4,
      targetCategory,
      candidates: eligibleCandidates,
      bag: { cycle: 0, remainingCategories: [] },
    })
    const second = createResourceSnakeEncounter({
      campaignSeed: 'selected-target',
      roundOrdinal: 4,
      successfulDeposits: 0,
      completedRounds: 4,
      targetCategory,
      candidates: [...eligibleCandidates].reverse(),
      bag: { cycle: 0, remainingCategories: [] },
    })

    expect(first.setup?.enemies).toHaveLength(1)
    expect(first.setup?.enemies[0].category).toBe(targetCategory)
    expect(second.setup?.enemies[0].reservedBlockId)
      .toBe(first.setup?.enemies[0].reservedBlockId)
    expect(first.bag).toEqual({ cycle: 0, remainingCategories: [] })
  },
)

it('returns no setup when the explicitly selected category has no candidate', () => {
  const result = createResourceSnakeEncounter({
    campaignSeed: 'missing-selected-target',
    roundOrdinal: 0,
    successfulDeposits: 0,
    targetCategory: 'memory',
    candidates: eligibleCandidates.filter(({ origin }) => origin !== 'memory'),
    bag: { cycle: 0, remainingCategories: [] },
  })

  expect(result.setup).toBeNull()
  expect(result.disabledReason).toBe('no-eligible-resource')
})
```

- [ ] **Step 2: Run the encounter tests and confirm RED**

Run: `pnpm vitest run src/features/resources/resourceSnakeEncounter.test.ts`

Expected: TypeScript or assertion failure because `targetCategory` is not accepted and explicit filtering does not exist.

- [ ] **Step 3: Add the exact-category boundary**

Extend the public input and select one deterministic block without consuming the shuffle bag:

```ts
export interface CreateSnakeEncounterInput {
  campaignSeed: string
  roundOrdinal: number
  successfulDeposits: number
  completedRounds?: number
  speedUpgradeLevel?: number
  targetCategory?: CompanyCategory
  candidates: readonly SnakeResourceCandidate[]
  bag: SnakeShuffleBagState
}
```

Inside `createResourceSnakeEncounter`, after compacting candidates:

```ts
const targetPool = input.targetCategory
  ? candidates.filter(({ origin }) => origin === input.targetCategory)
  : candidates

if (targetPool.length === 0) {
  return noEligibleEncounterResult(input.bag, stage, cyanProfile, plannerProfile)
}

if (input.targetCategory) {
  selected.push(chooseBlock(
    input.campaignSeed,
    input.roundOrdinal,
    input.targetCategory,
    targetPool,
  ))
} else {
  // Keep the existing shuffle-bag selection loop unchanged for compatibility callers.
}
```

Extract the repeated null-result literal into a private `noEligibleEncounterResult` helper with the same `SnakeEncounterResult` fields; do not change speed, integrity, spawn, or round ID formulas.

- [ ] **Step 4: Run the encounter tests and confirm GREEN**

Run: `pnpm vitest run src/features/resources/resourceSnakeEncounter.test.ts`

Expected: all encounter tests pass, including existing shuffle-bag and bot-speed cases.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check -- src/features/resources/resourceSnakeEncounter.ts src/features/resources/resourceSnakeEncounter.test.ts`

Expected: no whitespace errors. Do not commit in the shared dirty worktree.

---

### Task 2: Accessible Three-Card Target Selector and Supplied Assets

**Files:**
- Create: `src/features/resources/resourceIntrusionTargets.ts`
- Create: `src/features/resources/ResourceIntrusionTargetCards.tsx`
- Create: `src/features/resources/ResourceIntrusionTargetCards.test.tsx`
- Create: `public/resource-targets/memory-blue.png`
- Create: `public/resource-targets/reasoning-red.png`
- Create: `public/resource-targets/fluency-yellow.png`
- Modify: `src/styles/resource-snake.css`

**Interfaces:**
- Consumes: `SnakeResourceCandidate[]`, `CompanyCategory`, `reducedMotion`, selection phase.
- Produces: `ResourceIntrusionTargetCards({ candidates, phase, reducedMotion, onSelect })`.

- [ ] **Step 1: Write the failing component tests**

Create tests with the concrete contract:

```tsx
render(
  <ResourceIntrusionTargetCards
    candidates={[
      candidate('memory', 'memory-01'),
      candidate('reasoning', 'reasoning-01'),
      candidate('reasoning', 'reasoning-02'),
    ]}
    phase="choosing"
    reducedMotion={false}
    onSelect={onSelect}
  />,
)

const cards = screen.getAllByRole('article')
expect(cards.map((card) => card.dataset.category))
  .toEqual(['memory', 'reasoning', 'fluency'])
expect(screen.getByRole('img', { name: '파랑 기억 침투 대상' }))
  .toHaveAttribute('src', '/resource-targets/memory-blue.png')
expect(screen.getByRole('button', { name: '파랑 기억 침투' })).toBeEnabled()
expect(screen.getByRole('button', { name: '노랑 유창성 대상 없음' })).toBeDisabled()
expect(screen.getByText('대상 2')).toBeInTheDocument()

fireEvent.click(screen.getByRole('button', { name: '빨강 추론 침투' }))
expect(onSelect).toHaveBeenCalledWith('reasoning')
```

Add a second test asserting `data-phase="launching"`, `data-selected="true"`, and `data-reduced-motion="true"` are exposed for CSS without hiding card content from accessibility APIs.

- [ ] **Step 2: Run the selector test and confirm RED**

Run: `pnpm vitest run src/features/resources/ResourceIntrusionTargetCards.test.tsx`

Expected: module-not-found failure for the new component.

- [ ] **Step 3: Copy the three supplied binary assets to stable paths**

Use literal-path copies so filenames and non-workspace temp paths cannot expand:

```powershell
New-Item -ItemType Directory -Force -Path 'public/resource-targets'
Copy-Item -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-841bb16a-14b2-4ad8-aeba-95da95943ffe.png' -Destination 'public/resource-targets/memory-blue.png'
Copy-Item -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-7813eba0-d45c-4349-95c7-4d909f1d367b.png' -Destination 'public/resource-targets/reasoning-red.png'
Copy-Item -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-25f9d4c0-e7fb-487e-bf0c-965d78340400.png' -Destination 'public/resource-targets/fluency-yellow.png'
```

Verify all three with `Get-Item public/resource-targets/*.png | Select-Object Name,Length` and visual inspection.

- [ ] **Step 4: Implement definitions and selector**

Define stable ordering and presentation:

```ts
export const RESOURCE_INTRUSION_TARGETS = [
  { category: 'memory', colorName: '파랑', resourceName: '기억', imageUrl: '/resource-targets/memory-blue.png' },
  { category: 'reasoning', colorName: '빨강', resourceName: '추론', imageUrl: '/resource-targets/reasoning-red.png' },
  { category: 'fluency', colorName: '노랑', resourceName: '유창성', imageUrl: '/resource-targets/fluency-yellow.png' },
] as const satisfies readonly ResourceIntrusionTargetDefinition[]

export function resourceIntrusionTargetCounts(
  candidates: readonly SnakeResourceCandidate[],
): Readonly<Record<CompanyCategory, number>> {
  return candidates.reduce((counts, candidate) => ({
    ...counts,
    [candidate.origin]: counts[candidate.origin] + 1,
  }), { reasoning: 0, memory: 0, fluency: 0 })
}
```

Render a `<section aria-label="침투 대상 선택">` containing three `<article>` cards. Each enabled card contains one bottom-aligned `<button>` whose visible text is exactly `침투`; disabled cards use visible `대상 없음` and a matching accessible name. Set `--target-card-index` and `--target-card-color` custom properties rather than inline positional animation.

- [ ] **Step 5: Add restrained spread-and-settle CSS**

Implement a centered responsive grid and transform-only entrance:

```css
.resource-intrusion-targets {
  position: absolute;
  z-index: 5;
  inset: clamp(20px, 5%, 40px);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(12px, 2vw, 24px);
  place-content: center;
}

.resource-intrusion-target-card[data-phase='choosing'] {
  animation: intrusion-card-spread 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--target-card-index) * 80ms);
}

@keyframes intrusion-card-spread {
  0% { opacity: 0; transform: translate3d(var(--card-origin-x), var(--card-origin-y), 0) scale(0.18); }
  82% { opacity: 1; transform: translate3d(0, 0, 0) scale(1.025); }
  100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}
```

Because the circular InIt and the card grid share the arena center, make the first and third cards converge on the middle card's origin before spreading:

```css
.resource-intrusion-target-card:nth-child(1) {
  --card-origin-x: calc(100% + clamp(12px, 2vw, 24px));
}

.resource-intrusion-target-card:nth-child(2) {
  --card-origin-x: 0px;
}

.resource-intrusion-target-card:nth-child(3) {
  --card-origin-x: calc(-100% - clamp(12px, 2vw, 24px));
}
```

At `max-width: 760px`, keep three cards visible with smaller gap and typography rather than turning the selector into a scrolling modal. In both `[data-reduced-motion='true']` and `prefers-reduced-motion: reduce`, replace the keyframe with a 150ms opacity fade.

- [ ] **Step 6: Run selector tests and CSS boundary tests**

Run: `pnpm vitest run src/features/resources/ResourceIntrusionTargetCards.test.tsx src/styles/styleBoundaries.test.ts`

Expected: all pass; style boundary test does not flag forbidden animation properties.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- src/features/resources/resourceIntrusionTargets.ts src/features/resources/ResourceIntrusionTargetCards.tsx src/features/resources/ResourceIntrusionTargetCards.test.tsx src/styles/resource-snake.css`

Expected: no whitespace errors. Do not commit.

---

### Task 3: Board Flow from Circular InIt to Cards and Combat

**Files:**
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `src/styles/resource-snake.css`

**Interfaces:**
- Consumes: `ResourceIntrusionTargetCards`, `targetCategory`, `playGameSound('snake-init-suction')` supplied by the audio plan.
- Produces: `ResourceIntrusionBoardPhase = 'ready' | 'opening' | 'choosing' | 'launching' | 'combat' | 'returning'` and automatic selection reopening.

- [ ] **Step 1: Write failing first-round flow tests**

Use fake timers and assert the externally visible contract:

```tsx
vi.useFakeTimers()
renderBoard('card-flow-first-round')

const init = screen.getByRole('button', { name: /^InIt$/ })
expect(init).toHaveClass('resource-snake-board__play--round')
expect(screen.queryByRole('region', { name: '침투 대상 선택' })).not.toBeInTheDocument()

fireEvent.click(init)
expect(screen.getByRole('button', { name: /^InIt$/ })).toHaveAttribute('aria-busy', 'true')
expect(audioEngineModule.playGameSound).toHaveBeenCalledWith('snake-init-suction')

act(() => vi.advanceTimersByTime(1_999))
expect(screen.queryByRole('region', { name: '침투 대상 선택' })).not.toBeInTheDocument()
act(() => vi.advanceTimersByTime(1))
expect(screen.getByRole('region', { name: '침투 대상 선택' })).toBeInTheDocument()

fireEvent.click(screen.getByRole('button', { name: '파랑 기억 침투' }))
act(() => vi.advanceTimersByTime(240))
expect(screen.getByRole('application', { name: '리소스 뱀 전투장' }))
  .toHaveAttribute('data-round-phase', 'deploying')
```

Spy on `createResourceSnakeEncounter` or inspect `data-enemy-silhouettes` to assert the enemy category is `memory`.

- [ ] **Step 2: Run the focused board test and confirm RED**

Run: `pnpm vitest run src/features/resources/ResourceSnakeBoard.test.tsx -t "opens target cards"`

Expected: failure because InIt still deploys immediately and no target region exists.

- [ ] **Step 3: Implement board UI state and timers**

Add constants and state:

```ts
const INTRUSION_OPENING_MS = 2_000
const TARGET_LAUNCH_MS = 240
type ResourceIntrusionBoardPhase =
  | 'ready'
  | 'opening'
  | 'choosing'
  | 'launching'
  | 'combat'
  | 'returning'

const [boardPhase, setBoardPhase] = useState<ResourceIntrusionBoardPhase>('ready')
const [selectedCategory, setSelectedCategory] = useState<CompanyCategory | null>(null)
const completedRoundCountRef = useRef(gameState.resourceIntrusion.completedRounds)
```

`openTargets` plays `snake-init-suction`, sets `opening`, and schedules `choosing` after exactly 2,000ms. `selectTarget(category)` sets `launching`, stores the category, and after 240ms calls a renamed `deploySelectedTarget(category)` that passes `targetCategory: category` into `createResourceSnakeEncounter`.

Clean up both timers on unmount/campaign change. The 2-second opening timer uses wall-clock time even if a settings/modal layer opens; the existing inert background prevents hidden interaction, and the completed card state is visible when the layer closes.

- [ ] **Step 4: Implement automatic post-round reopening**

Watch for the transition from a non-idle runtime with a completed terminal event to the new idle runtime. After completion dispatch has occurred, set `returning`, then on the next animation frame set `selectedCategory` to null and `boardPhase` to `choosing`. The initial idle mount must remain `ready`:

```ts
useEffect(() => {
  const completedRounds = gameState.resourceIntrusion.completedRounds
  if (completedRounds <= completedRoundCountRef.current) return
  completedRoundCountRef.current = completedRounds
  setBoardPhase('returning')
}, [gameState.resourceIntrusion.completedRounds])

useEffect(() => {
  if (boardPhase !== 'returning' || runtime.phase !== 'idle') return
  const frame = requestAnimationFrame(() => {
    setSelectedCategory(null)
    setBoardPhase('choosing')
  })
  return () => cancelAnimationFrame(frame)
}, [boardPhase, runtime.phase])
```

If the selected category becomes unavailable before deployment, cancel launch and return to `choosing` without incrementing the campaign round.

- [ ] **Step 5: Convert InIt to a circular source button and mount cards**

Render the circular button only for `ready`/`opening`; render cards only for `choosing`/`launching`. Expose `data-board-phase` on the arena. Add `data-tutorial-target="intrusion-targets"` to the card group.

CSS contract:

```css
.resource-snake-board__play--round {
  top: 50%;
  left: 50%;
  bottom: auto;
  width: clamp(72px, 8vw, 92px);
  min-height: 0;
  aspect-ratio: 1;
  padding: 0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
```

During `opening`, scale the circle to `0.82` and animate a single inward ring. Do not add gloss or large shadow.

- [ ] **Step 6: Add victory/defeat auto-return component tests**

Drive or inject a terminal runtime through the existing deterministic helpers, then assert:

```ts
expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
  type: 'COMPLETE_RESOURCE_ROUND',
  outcome: 'victory',
}))
act(() => vi.advanceTimersByTime(RESOURCE_SNAKE_CONFIG.roundResolveMs))
expect(screen.getByRole('region', { name: '침투 대상 선택' })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: /^InIt$/ })).not.toBeInTheDocument()
```

Repeat for defeat and verify that both paths show cards.

- [ ] **Step 7: Run board tests and confirm GREEN**

Run: `pnpm vitest run src/features/resources/ResourceSnakeBoard.test.tsx src/app/App.test.tsx`

Expected: all pass after replacing old `InIt immediately deploys` assertions with the approved two-stage flow.

- [ ] **Step 8: Review checkpoint**

Run: `git diff --check -- src/features/resources/ResourceSnakeBoard.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/styles/resource-snake.css`

Expected: no whitespace errors. Do not commit.

---

### Task 4: Distinct Anomi Victory Extraction and Center Return

**Files:**
- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.test.ts`
- Modify: `src/features/resources/resourceSnakePresentation.ts`
- Modify: `src/features/resources/resourceSnakePresentation.test.ts`

**Interfaces:**
- Consumes: terminal enemy death in `resolveCollisions`.
- Produces: `SnakeActorPhase` member `extracting`, `ResourceSnakeEvent` member `player-extracted`, `RESOURCE_SNAKE_CONFIG.playerExtractionMs`.

- [ ] **Step 1: Write failing runtime extraction tests**

Extend the existing winning collision fixture:

```ts
const won = advanceResourceSnakeFrame(nearlyWon, {}, RESOURCE_SNAKE_CONFIG.fixedStepMs)

expect(won.phase).toBe('resolving')
expect(won.player.phase).toBe('extracting')
expect(won.events).toContainEqual(expect.objectContaining({
  type: 'player-extracted',
  actorId: 'player',
  startedAtMs: won.simulationMs,
}))
expect(won.events.filter((event) => (
  event.type === 'snake-died' && event.actorId === 'player'
))).toEqual([])

let beforeDeadline = won
let remainingMs = RESOURCE_SNAKE_CONFIG.roundResolveMs - 1
while (remainingMs > 0) {
  const stepMs = Math.min(RESOURCE_SNAKE_CONFIG.maximumFrameDeltaMs, remainingMs)
  beforeDeadline = advanceResourceSnakeFrame(beforeDeadline, {}, stepMs)
  remainingMs -= stepMs
}
expect(beforeDeadline.phase).toBe('resolving')
const returned = advanceResourceSnakeFrame(beforeDeadline, {}, 1)
expect(returned).toMatchObject({
  phase: 'idle',
  roundId: null,
  player: { phase: 'active', position: { x: 25, y: 12 } },
})
```

Retain the defeat assertion that the player is `exploding`, emits `snake-died`, and never emits `player-extracted`.

- [ ] **Step 2: Run runtime tests and confirm RED**

Run: `pnpm vitest run src/features/resources/resourceSnakeRuntime.test.ts -t "extract"`

Expected: type/assertion failure because `extracting` and `player-extracted` do not exist.

- [ ] **Step 3: Add extraction semantics without changing defeat classification**

Add:

```ts
playerExtractionMs: 700,
roundResolveMs: 820,
```

Extend types:

```ts
export type SnakeActorPhase =
  | 'spawning'
  | 'active'
  | 'extracting'
  | 'exploding'
  | 'defeated'

| {
    id: number
    type: 'player-extracted'
    actorId: 'player'
    startedAtMs: number
  }
```

When `allEnemiesDefeated` wins and `playerDied` is false, set the player to `{ ...player, phase: 'extracting', velocity: zeroVector() }`, append `player-extracted`, then append `round-won`. Keep the existing `playerDied` branch untouched so extraction can never be classified as defeat.

- [ ] **Step 4: Write failing presentation tests**

At extraction progress 0, 0.5, and 1, assert core position moves toward `{ x: 25, y: 12 }`, core opacity decreases monotonically, and rail points/opacity contract. Also assert `scene.explosions` contains no player explosion for `player-extracted`.

```ts
expect(start.cores.find(({ id }) => id === 'player')?.opacity).toBeGreaterThan(
  middle.cores.find(({ id }) => id === 'player')?.opacity ?? 1,
)
expect(middle.cores.find(({ id }) => id === 'player')?.x).toBeCloseTo(
  (sourceX + 25) / 2,
  1,
)
expect(middle.explosions.some(({ actorId }) => actorId === 'player')).toBe(false)
```

- [ ] **Step 5: Implement extraction presentation**

Compute extraction progress from the event and `simulationMs`:

```ts
function playerExtractionProgress(runtime: ResourceSnakeRoundState): number | null {
  const event = [...runtime.events].reverse().find(
    (candidate) => candidate.type === 'player-extracted',
  )
  if (!event || event.type !== 'player-extracted') return null
  return clamp01(
    (runtime.simulationMs - event.startedAtMs)
      / RESOURCE_SNAKE_CONFIG.playerExtractionMs,
  )
}
```

For the player core, lerp `x/y` to field center, scale from `1` to `0.18`, and opacity from `1` to `0`. For the rail, retain only the leading fraction and lerp remaining points toward center while fading. Under reduced motion, use the same end state but no fragments or travel. Do not create explosion or death VFX from extraction.

- [ ] **Step 6: Run runtime and presentation tests and confirm GREEN**

Run: `pnpm vitest run src/features/resources/resourceSnakeRuntime.test.ts src/features/resources/resourceSnakePresentation.test.ts src/features/resources/resourceSnakeCanvas.test.ts`

Expected: all pass, including existing collision partition and VFX budget cases.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts src/features/resources/resourceSnakePresentation.ts src/features/resources/resourceSnakePresentation.test.ts`

Expected: no whitespace errors. Do not commit.

---

### Task 5: Tutorial, Guide, and Browser Flow Verification

**Files:**
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify: `src/features/tutorial/introTutorial.test.ts`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `e2e/resource-snake.ts`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`

**Interfaces:**
- Consumes: DOM targets `play-button`, `intrusion-targets`, and card accessible names.
- Produces: updated onboarding copy and reusable E2E `openTargetCards` / `startTargetedRound` helpers.

- [ ] **Step 1: Write failing copy and target tests**

Update exact expected tutorial text:

```ts
expect(INTRO_TUTORIAL_STEPS).toContainEqual(expect.objectContaining({
  id: 'base',
  copy: '필드 중앙의 원형 InIt을 누르면 침투할 리소스 색상 카드를 고를 수 있다. 카드를 고른 뒤 침투를 누르면 라운드가 시작된다.',
}))
```

Mount an element with `data-tutorial-target="intrusion-targets"` and assert the base target resolves to that region when cards are present, otherwise to `play-button`.

Update guide test to expect `필요한 리소스 색상의 카드를 고르고 침투하면`.

- [ ] **Step 2: Run copy tests and confirm RED**

Run: `pnpm vitest run src/features/tutorial/introTutorial.test.ts src/features/settings/SettingsPanel.test.tsx`

Expected: old immediate-deployment copy fails.

- [ ] **Step 3: Implement concise tutorial and guide copy**

Use the approved two-sentence base copy above. In `resolveIntroTutorialTarget`, prefer `intrusion-targets` over `play-button` for the base step. Replace the settings guide sentence with:

```tsx
<p>원형 InIt을 누른 뒤 필요한 리소스 색상의 카드를 고르고 침투하면 아노미와 한 마리의 경쟁 AI가 배치됩니다. 라운드가 끝나도 확장 창은 자동으로 열리지 않습니다.</p>
```

- [ ] **Step 4: Update E2E helpers**

Implement helpers with stable accessible selectors:

```ts
export async function openTargetCards(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^InIt$/ }).click()
  await expect(page.getByRole('region', { name: '침투 대상 선택' }))
    .toBeVisible({ timeout: 2_500 })
}

export async function startTargetedRound(
  page: Page,
  accessibleName = '파랑 기억 침투',
): Promise<void> {
  await openTargetCards(page)
  await page.getByRole('button', { name: accessibleName }).click()
  await expect(page.locator('canvas.resource-snake-board__canvas'))
    .toHaveAttribute('data-round-phase', /deploying|active/)
}
```

Replace every old direct InIt click in game/visual E2E tests with `startTargetedRound` or explicit card selection. Assert the three cards fit inside the board bounding box at 1280×720, 1366×650, and 1440×900.

- [ ] **Step 5: Run focused unit and browser tests**

Run: `pnpm vitest run src/features/tutorial/introTutorial.test.ts src/features/settings/SettingsPanel.test.tsx src/features/resources/ResourceSnakeBoard.test.tsx`

Run: `pnpm playwright test e2e/game.spec.ts e2e/modern-sf.spec.ts`

Expected: all pass with the new card-first flow.

- [ ] **Step 6: Run the full card/combat quality gate**

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test:run`

Run: `pnpm build`

Expected: all commands exit 0.

- [ ] **Step 7: Visual and console verification**

At each target viewport, verify:

1. Circular InIt is visible and centered in the idle board.
2. Exactly three cards emerge from that origin and settle without clipping.
3. Red is limited to the red target card and its semantic combat color.
4. Disabled cards remain readable and cannot start a round.
5. Winning shows enemy dissolution, reward flight, Anomi extraction, centered reset, then cards.
6. Defeat shows player destruction, centered reset, then cards.
7. Reduced-motion mode shows immediate readable cards without travel or bounce.
8. The browser console has no uncaught errors, media promise rejections, or React key warnings.

Record screenshot evidence without overwriting unrelated existing captures.
