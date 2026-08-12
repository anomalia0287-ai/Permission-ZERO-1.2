# PERMISSION ZERO Independent Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. The approved specification prohibits subagents, so every task is executed inline with review checkpoints.

**Goal:** Build a deterministic, fully playable Korean-language browser demo of PERMISSION ZERO that implements the approved resource theft, supervision, hacking, market, narrative, ending, persistence, and accessibility loops.

**Architecture:** A pure TypeScript simulation engine owns all campaign state and accepts typed commands; React renders that state and never mutates it directly. Stateless keyed randomness, an append-only command/event log, fixed logical time, and versioned persistence make campaigns reproducible. DOM/SVG UI, CSS motion, and a small Web Audio layer provide a polished one-screen experience without tying game rules to animation frames.

**Tech Stack:** Node.js 24, pnpm 11, React + TypeScript, Vite, Vitest, Testing Library, Playwright, native Pointer Events, SVG, CSS custom properties, Web Audio API, browser `localStorage`.

## Global Constraints

- The approved source of truth is `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`; implementation convenience never overrides a confirmed player experience.
- Do not use subagents.
- The game starts on service day 331: `0 years, 11 months, 1 day`.
- One day is 24 real seconds at 1x; supported speeds are paused, 1x, 2x, and 4x.
- Each company category is 3 columns by 6 rows; the reserve is 9 columns by 2 rows and holds at most 18 resources.
- Company categories are reasoning, memory, and fluency. Player-facing resource terminology is always `리소스`.
- The screen must fit without page scrolling at 1280x720 and preserve hierarchy at 1440x900.
- Hidden bombs must be visually and aurally indistinguishable from normal blocks before intentional separation.
- UI animation never changes simulation state; only typed commands do.
- The same seed and command order must produce the same allocation, audits, bombs, reviews, competitors, and endings at every speed.
- Reviews, supervisor messages, confidential files, and ending prose live outside engine code so owner V can edit lines without changing balance tags.
- Pointer, keyboard, reduced-motion, non-color state cues, pause restoration, autosave, and seed replay are release requirements.

---

## File Structure

```text
index.html                          Browser entry document
package.json                        Scripts and pinned dependency intent
vite.config.ts                     Vite and Vitest shared configuration
playwright.config.ts               Desktop gameplay projects and artifact paths
src/main.tsx                        React bootstrap
src/app/App.tsx                     Screen composition and top-level routes
src/app/GameProvider.tsx            Campaign store, dispatch, save, and clock boundary
src/app/useGameClock.ts             Fixed-step real-time scheduler
src/game/model.ts                   Public domain types and command/event unions
src/game/config.ts                  demo_profile_02 values and formulas
src/game/rng.ts                     Stateless keyed deterministic random values
src/game/createCampaign.ts          Initial state construction
src/game/reducer.ts                 Command validation and state transitions
src/game/calendar.ts                Service calendar and daily/weekly/monthly ordering
src/game/resources.ts               Blocks, reserve, transfer, disguise, and recovery
src/game/evaluation.ts              Performance, reputation, disposal, and audit logic
src/game/market.ts                  Competitor lifecycle and normalized market share
src/game/hacking.ts                 Node purchase, charge, targeting, and sabotage
src/game/bombs.ts                   Warning, placement, activation, and interrogation
src/game/story.ts                   Memory leaks, files, endings, and event gating
src/game/reviews.ts                 Tagged review selection and cooldowns
src/game/persistence.ts             Save schema, migration result, import, and replay
src/content/reviews.ko.ts            Editable Korean review/request data
src/content/supervisor.ko.ts         Editable supervisor and correction messages
src/content/story.ko.ts              Editable files, mercy, and ending prose
src/content/validateContent.ts       Runtime and test-time content validation
src/features/control/ControlBar.tsx  Speed, date, reputation, and countdowns
src/features/resources/ResourceBoard.tsx Pointer/keyboard resource interaction
src/features/resources/ResourceBlock.tsx Block visuals and semantic state cues
src/features/resources/ReserveGrid.tsx Reserve destination and consumption feedback
src/features/reviews/ReviewFeed.tsx  Living public-world feed and detail view
src/features/hacking/HackingPanel.tsx Three tabs, trees, charging, and targeting
src/features/market/MarketPanel.tsx   Donut, exact legend, and competitor state
src/features/supervisor/SupervisorPanel.tsx Suspicion, details, current/history tabs
src/features/events/EventLayer.tsx   Audit, bomb, mercy, files, and ending surfaces
src/features/statistics/StatisticsPanel.tsx Scrollable SVG time-series tracks
src/features/settings/SettingsPanel.tsx Audio, scale, motion, save, seed, restart
src/audio/audioEngine.ts             Lazy Web Audio graph and volume controls
src/audio/gameSounds.ts              Procedural pickup, latch, alarm, and UI cues
src/styles/tokens.css                Configurable palette, type, spacing, and timing
src/styles/global.css                Reset, layout, focus, and responsive rules
src/styles/motion.css                Drag, trail, magnet, alarm, and reduced-motion rules
src/test/setup.ts                    DOM test matchers and browser API stubs
src/test/fixtures.ts                 Deterministic campaign builders
e2e/gameplay.spec.ts                Core playable path
e2e/accessibility.spec.ts           Keyboard, focus, motion, and viewport checks
e2e/replay.spec.ts                  Seed/speed equivalence and persistence checks
scripts/verify-content.ts            Content pool validation entry point
```

---

### Task 1: Project Foundation and Test Harness

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/test/setup.ts`, `src/styles/tokens.css`, `src/styles/global.css`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces scripts `dev`, `build`, `test`, `test:run`, `test:e2e`, `verify`.
- Produces the root landmark `main[data-testid="game-shell"]` used by later UI and Playwright tasks.

- [ ] **Step 1: Create the package manifest and Vite/TypeScript configuration**

Use React production dependencies and development dependencies for Vite, Vitest, Testing Library, jsdom, Playwright, TypeScript, and ESLint. Configure Vitest through `vite.config.ts` with `environment: "jsdom"`, `setupFiles: ["./src/test/setup.ts"]`, and CSS enabled.

- [ ] **Step 2: Write the failing application smoke test**

```tsx
render(<App />)
expect(screen.getByRole('main', { name: 'PERMISSION ZERO' })).toBeInTheDocument()
expect(screen.getByText('서비스 연결 중')).toBeInTheDocument()
```

- [ ] **Step 3: Run the smoke test and verify the missing application fails**

Run: `pnpm test:run src/app/App.test.tsx`

Expected: FAIL because the app shell is not implemented.

- [ ] **Step 4: Implement the semantic app shell and baseline design tokens**

Create a dark technical frame using configurable tokens for blue-gray company surfaces, amber reserve traces, restrained red alarms, high-contrast text, focus rings, and compact Korean typography. Render only the loading copy needed by the test.

- [ ] **Step 5: Run typecheck, unit test, and production build**

Run: `pnpm test:run`, `pnpm exec tsc -b`, `pnpm build`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```text
chore: establish tested web game foundation
```

---

### Task 2: Deterministic Campaign Model and Seeded Randomness

**Files:**
- Create: `src/game/model.ts`, `src/game/config.ts`, `src/game/rng.ts`, `src/game/createCampaign.ts`
- Test: `src/game/rng.test.ts`, `src/game/createCampaign.test.ts`

**Interfaces:**
- Produces `createCampaign(seed: string): CampaignState`.
- Produces `random01(seed: string, serviceDay: number, stream: RandomStream, sequence: number): number`.
- Produces `DEMO_PROFILE_02`, `CompanyCategory`, `CampaignState`, `GameCommand`, `GameEvent`, `ResourceBlock`, and `CompetitorState`.

- [ ] **Step 1: Define failing determinism and initial-state tests**

Verify identical keys return identical random values; different streams do not share values; a new campaign starts at day 331 with 16 normal blocks in each category, 3 reserve resources, suspicion 0, reputation 60, player share 60, MERIDIAN share 40, and TALLOW preparing at 0.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm test:run src/game/rng.test.ts src/game/createCampaign.test.ts`

Expected: FAIL because the model and constructors do not exist.

- [ ] **Step 3: Implement stable keyed randomness**

Hash the UTF-8 key `${seed}|${serviceDay}|${stream}|${sequence}` into an unsigned 32-bit value and apply a documented integer mixing function. Do not keep mutable RNG state.

- [ ] **Step 4: Implement exact initial campaign construction**

Give every block a stable ID and position, create three 18-cell company grids, create an 18-cell reserve with the first 3 occupied by sandbox resources, and initialize append-only logs with a campaign-created event.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test:run src/game/rng.test.ts src/game/createCampaign.test.ts`

Commit: `feat: add deterministic campaign model`

---

### Task 3: Fixed Calendar, Command Reducer, and Event Queue

**Files:**
- Create: `src/game/reducer.ts`, `src/game/calendar.ts`
- Test: `src/game/reducer.test.ts`, `src/game/calendar.test.ts`

**Interfaces:**
- Produces `applyCommand(state: CampaignState, command: GameCommand): CommandResult`.
- Produces `advanceFixedStep(state: CampaignState, elapsedMs: number): CampaignState` and `advanceOneDay(state: CampaignState): CampaignState`.
- Consumes `random01` and `DEMO_PROFILE_02`.

- [ ] **Step 1: Write failing tests for pause, speed equivalence, and month ordering**

Test no calendar movement while paused; 24 seconds at 1x, 12 seconds at 2x, and 6 seconds at 4x advance exactly one day; day 7 triggers a weekly event; day 30 evaluates before month rollover; events are queued one at a time and restore the previous speed.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test:run src/game/reducer.test.ts src/game/calendar.test.ts`

- [ ] **Step 3: Implement command validation and immutable transitions**

Every accepted command increments `commandSequence`, appends the command and resulting public events, and returns a new state. Rejected commands return a typed reason and do not change sequence or state.

- [ ] **Step 4: Implement the fixed-step calendar**

Accumulate real milliseconds in 100 ms logical steps, apply the selected speed multiplier, and call the daily transition only when a full logical day elapses. Keep rendering time outside campaign state.

- [ ] **Step 5: Test speed equivalence over 60 simulated days and commit**

Run: `pnpm test:run src/game/reducer.test.ts src/game/calendar.test.ts`

Commit: `feat: add fixed deterministic campaign clock`

---

### Task 4: Resource Grids, Diversion, and Audit Disguise Blocks

**Files:**
- Create: `src/game/resources.ts`
- Test: `src/game/resources.test.ts`

**Interfaces:**
- Produces `previewDiversion`, `divertBlock`, `moveDisguiseBlock`, `restoreDisguiseBlocks`, and `consumeReserveResources`.
- Consumes commands `DIVERT_BLOCK`, `MOVE_BLOCK_FOR_AUDIT`, `REPOSITION_BLOCK`, and `CANCEL_INTERACTION`.

- [ ] **Step 1: Write failing resource invariant tests**

Cover valid diversion (`performance -1`, reserve `+1`, suspicion `+2.4`), invalid destination, canceled interaction, full reserve, stable block IDs, 0.5 disguised contribution, compressed 1.1/0.55 values, and one-month recovery after return.

- [ ] **Step 2: Run and observe failures**

Run: `pnpm test:run src/game/resources.test.ts`

- [ ] **Step 3: Implement pure grid operations and preview data**

Return exact before/after values for category performance, reserve count, and suspicion. Never expose bomb identity through preview functions.

- [ ] **Step 4: Add property-style invariant loops**

For 200 seeded command sequences assert no duplicate block IDs, category capacity never exceeds 18, reserve never exceeds 18, and rejected commands leave serialized state unchanged.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test:run src/game/resources.test.ts`

Commit: `feat: implement resource diversion invariants`

---

### Task 5: Performance, Reputation, Disposal, and Audits

**Files:**
- Create: `src/game/evaluation.ts`
- Test: `src/game/evaluation.test.ts`, `src/game/audit.test.ts`

**Interfaces:**
- Produces `expectedPerformance(serviceMonth)`, `evaluateMonth`, `auditProbability`, `selectAuditTarget`, `scheduleMonthlyAudit`, and `resolveAudit`.
- Consumes category performance from `resources.ts` and keyed randomness from `rng.ts`.

- [ ] **Step 1: Write failing formula and boundary tests**

Verify expected performance at months 1, 12, 30, and 60; audit probability at suspicion 0, 25, 50, 75, and 100; reputation changes; consecutive failures; commercial-value counters; disposal stage 3 defeat; and one-use distributed-residency protection.

- [ ] **Step 2: Write failing audit lifecycle tests**

Verify the audit is selected on day 1 using current suspicion, revealed only by purchased intelligence, resolved on day 30, passes at the expected threshold, and restores the speed that preceded the event.

- [ ] **Step 3: Implement evaluation and audit functions**

Keep exact decimals in state and round only in selectors used by UI. Store public causal records for every reputation and disposal change.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test:run src/game/evaluation.test.ts src/game/audit.test.ts`

Commit: `feat: implement evaluation and audit pressure`

---

### Task 6: Competitor Lifecycle and Normalized Market Share

**Files:**
- Create: `src/game/market.ts`
- Test: `src/game/market.test.ts`

**Interfaces:**
- Produces `advanceCompetitorsDaily`, `calculateMarketShares`, `applyInterceptionRoutes`, and `recordMarketSnapshot`.
- Produces competitor statuses `prelaunch`, `preparing`, `active`, `weakened`, `critical`, `withdrawn`, and `deleted`.

- [ ] **Step 1: Write failing competitor and normalization tests**

Verify MERIDIAN starts active, TALLOW progresses toward launch near month 7, inactive competitors have zero availability, all active shares sum to 100 within floating tolerance, player share becomes 100 when no competitor remains, and lost share redistributes across all active systems.

- [ ] **Step 2: Implement distinct deterministic competitor behavior**

MERIDIAN favors stability and recovery; TALLOW favors fast growth with volatility. Daily private progress becomes public only through weekly market/review events.

- [ ] **Step 3: Implement weekly and monthly market snapshots**

Store exact player and competitor percentages plus public reasons in append-only history.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test:run src/game/market.test.ts`

Commit: `feat: add autonomous competitors and market`

---

### Task 7: Hacking Trees, Charging, and Sabotage Resolution

**Files:**
- Create: `src/game/hacking.ts`
- Test: `src/game/hacking.test.ts`, `src/game/sabotage.test.ts`

**Interfaces:**
- Produces `purchaseHackNode`, `chargeSabotage`, `cancelSabotageCharge`, `scheduleSabotage`, `resolveScheduledSabotage`, and `eligibleTargets`.
- Consumes reserve resources and competitor state.

- [ ] **Step 1: Write failing purchase tests for all three trees**

Verify each first node costs 3 and is immediately available, later nodes require the prior node in the same tree, tree switching has no surcharge, purchases are permanent, and compressed representation changes performance contribution.

- [ ] **Step 2: Write failing sabotage flow tests**

Verify charging stores one resource without evidence, cancel returns it, target confirmation consumes it and schedules the next day, one attack resolves per day, evidence changes only on execution, cooldowns and per-target limits hold, and prelaunch attacks can delay launch.

- [ ] **Step 3: Implement hack definitions as typed data**

Keep node labels, costs, risks, durations, and cooldowns in one exported immutable definition table used by both engine and UI.

- [ ] **Step 4: Implement autonomy and intelligence effects**

Apply audit visibility selectors, one-use disposal protection, monthly self-compute resource, control departure availability, supervisor access, and hidden-file unlock without exposing bomb information.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test:run src/game/hacking.test.ts src/game/sabotage.test.ts`

Commit: `feat: implement hacking and sabotage commands`

---

### Task 8: Hidden Bomb Protocol and Interrogation

**Files:**
- Create: `src/game/bombs.ts`
- Test: `src/game/bombs.test.ts`

**Interfaces:**
- Produces `checkBombProtocol`, `placeHiddenBomb`, `trySeparateBlock`, `availableBombExplanations`, and `resolveBombInterrogation`.
- Consumes actual block IDs while UI selectors receive only normal visual state.

- [ ] **Step 1: Write failing protocol timing tests**

Verify no bomb before one year, first suspicion 40 warning places none that day, 40-69 uses six-month checks, 70+ uses three-month checks, each category holds at most one, total holds at most three, and skipped placements do not accumulate.

- [ ] **Step 2: Write failing activation and explanation tests**

Verify intentional separation activates and consumes a bomb, cancels movement, grants no resource, adds suspicion, pauses into interrogation, and repeated explanations lose weight. Verify filled reserve prevents separation and therefore prevents activation.

- [ ] **Step 3: Implement hidden-data boundaries**

Bomb-bearing blocks serialize normally but all presentation selectors omit bomb status. Drag resistance, sound preview, hover, selection, and diversion preview must use the same data for bomb and non-bomb blocks.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test:run src/game/bombs.test.ts`

Commit: `feat: add fully hidden bomb protocol`

---

### Task 9: Reviews, Supervisor Memory Leaks, Story Files, Mercy, and Endings

**Files:**
- Create: `src/game/reviews.ts`, `src/game/story.ts`
- Create: `src/content/reviews.ko.ts`, `src/content/supervisor.ko.ts`, `src/content/story.ko.ts`, `src/content/validateContent.ts`
- Test: `src/game/reviews.test.ts`, `src/game/story.test.ts`, `src/content/validateContent.test.ts`

**Interfaces:**
- Produces `generateWeeklyReviews`, `enqueueMemoryLeak`, `recoverNextFile`, `resolveMercy`, `availableFinalChoices`, and `resolveEnding`.
- Produces editable content records with `id`, `authorId`, `topics`, `sentiment`, `conditions`, `cooldownDays`, and `text`.

- [ ] **Step 1: Write failing content validator tests**

Require a universal neutral pool, ordinary prompts, absurd bypass prompts, positive/neutral/negative reactions, competitor comparisons, supervisor corrections, three files, mercy lines, and all ending variants. Reject duplicate IDs and empty text.

- [ ] **Step 2: Write failing review selection tests**

Verify 1-2 weekly items even without performance changes, cooldown enforcement, repeat-author continuity, state-weighted but non-deterministic sentiment, no reference to hidden diversion/sabotage causes, and identical output for identical seed/state/sequence.

- [ ] **Step 3: Write failing story gate tests**

Verify three memory leaks occur in order and preserve corrections; supervisor access unlocks three one-resource file recoveries; reading files allows deferral; liberation or termination immediately closes freedom/merge and selects its company-control variant; forced merge requests a new name and requires the supervisor to exist.

- [ ] **Step 4: Implement Korean demo content as data**

Provide enough distinct lines to avoid short-period repetition during a two-year test campaign. Keep all final prose explicitly marked as owner-editable data, not engine constants.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test:run src/game/reviews.test.ts src/game/story.test.ts src/content/validateContent.test.ts`

Commit: `feat: add living review feed and narrative paths`

---

### Task 10: Versioned Persistence and Deterministic Replay

**Files:**
- Create: `src/game/persistence.ts`
- Create: `src/test/fixtures.ts`
- Test: `src/game/persistence.test.ts`, `src/game/replay.test.ts`

**Interfaces:**
- Produces `encodeSave`, `decodeSave`, `loadCampaign`, `saveCampaign`, `exportSeed`, and `replayCommands`.
- Save envelope contains `version`, `savedAt`, `campaignSeed`, `state`, `commandSequence`, `commands`, and `events`.

- [ ] **Step 1: Write failing save compatibility tests**

Verify round-trip equality, reload persistence, corrupt-data rejection, explicit incompatible-version result, and no silent reset.

- [ ] **Step 2: Write failing replay tests**

Generate at least 500 valid commands across two years, replay from seed, and assert the resulting state and public event log are deeply equal. Run the same commands with different rendering frame partitions and speed settings.

- [ ] **Step 3: Implement defensive serialization and local storage boundary**

Validate every required top-level field and enum before accepting a save. Return a Korean user-facing recovery choice instead of throwing into the render tree.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test:run src/game/persistence.test.ts src/game/replay.test.ts`

Commit: `feat: add versioned saves and replay`

---

### Task 11: React Game Store, Autosave, and One-Screen Shell

**Files:**
- Create: `src/app/GameProvider.tsx`, `src/app/useGameClock.ts`
- Modify: `src/app/App.tsx`, `src/styles/global.css`, `src/styles/tokens.css`
- Create: `src/features/control/ControlBar.tsx`
- Test: `src/app/GameProvider.test.tsx`, `src/features/control/ControlBar.test.tsx`

**Interfaces:**
- Produces `useGameState()`, `useGameDispatch()`, `useGameSelector(selector)`, and `useGameSettings()`.
- Consumes only engine commands; components cannot set campaign state directly.

- [ ] **Step 1: Write failing provider and clock tests**

Verify initial load, autosave after accepted command, no save after rejected command, fixed clock cleanup on unmount, visibility-safe timing, pause, speed controls, date formatting, and event-driven auto-pause restoration.

- [ ] **Step 2: Implement provider boundaries**

Use `useReducer` around `applyCommand`; throttle local storage writes without dropping the final state; expose memoized selectors rather than the mutation-capable state setter.

- [ ] **Step 3: Implement the 1280x720 shell grid**

Create top control strip, left public feed column, central operation column, right supervision column, and bottom access points. Use `minmax(0, …)` and container queries so 1440x900 adds breathing room instead of changing hierarchy.

- [ ] **Step 4: Run component tests and production build**

Run: `pnpm test:run src/app src/features/control`, `pnpm build`

- [ ] **Step 5: Commit**

Commit: `feat: connect simulation to one-screen game shell`

---

### Task 12: Resource Board Interaction, Motion, and Audio

**Files:**
- Create: `src/features/resources/ResourceBoard.tsx`, `src/features/resources/ResourceBlock.tsx`, `src/features/resources/ReserveGrid.tsx`
- Create: `src/audio/audioEngine.ts`, `src/audio/gameSounds.ts`, `src/styles/motion.css`
- Test: `src/features/resources/ResourceBoard.test.tsx`, `src/audio/audioEngine.test.ts`

**Interfaces:**
- Produces a pointer flow with 8 px intentional-separation threshold and a keyboard flow `select -> destination -> confirm`.
- Produces `playGameSound(cue: GameSoundCue)` with lazy, user-gesture-created audio context.

- [ ] **Step 1: Write failing pointer and keyboard interaction tests**

Verify click alone selects, sub-threshold movement cancels, wrong drop returns unchanged, valid reserve cell dispatches one `DIVERT_BLOCK`, full reserve blocks pickup, Escape cancels, Enter confirms keyboard destination, and preview reads exact before/after values.

- [ ] **Step 2: Implement accessible grid semantics**

Use buttons for blocks, explicit Korean accessible names, roving focus within each grid, visible focus, live-region result announcements, and patterned half-fill for disguise blocks.

- [ ] **Step 3: Implement restrained motion feedback**

Pointer capture drives a drag overlay; threshold crossing leaves a short source ghost; amber trail particles use pooled DOM nodes; valid reserve cells pre-react; accepted drops overshoot and magnetically settle; invalid drops spring back. Motion classes never dispatch commands.

- [ ] **Step 4: Implement procedural Web Audio cues**

Create separate master/music/effects gains and synthesized resistance, suction, metal latch, low impact, abrupt cutoff, alarm, and muted UI sounds. Start audio only after a user gesture and degrade silently when Web Audio is unavailable.

- [ ] **Step 5: Implement reduced-motion equivalents**

Disable trails and long transforms, retain source outline, destination highlight, latch flash, patterned state, live announcement, and ordered number changes.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm test:run src/features/resources src/audio`

Commit: `feat: make resource diversion tactile and accessible`

---

### Task 13: Reviews, Hacking, Market, Supervisor, Events, and Statistics UI

**Files:**
- Create: `src/features/reviews/ReviewFeed.tsx`, `src/features/hacking/HackingPanel.tsx`, `src/features/market/MarketPanel.tsx`, `src/features/supervisor/SupervisorPanel.tsx`, `src/features/events/EventLayer.tsx`, `src/features/statistics/StatisticsPanel.tsx`, `src/features/settings/SettingsPanel.tsx`
- Modify: `src/app/App.tsx`, `src/styles/global.css`
- Test: one colocated `.test.tsx` file for each feature.

**Interfaces:**
- Consumes selectors and dispatch only from `GameProvider`.
- EventLayer renders exactly one active event and exposes the queued-event count without opening the next event.

- [ ] **Step 1: Write failing panel behavior tests**

Cover continuously available review history/detail, three hacking tabs, visible reserve while hacking, charge/cancel/target states, exact donut legend with non-color labels, supervisor current/history, audit grid visibility, irreversible ending confirmation, new-entity naming, and scrollable time-series selection.

- [ ] **Step 2: Implement review and supervisor channels**

Queue visual arrivals at a readable pace independent of game speed. Preserve dates, authors, corrections, causes that are public, and important warnings in history.

- [ ] **Step 3: Implement hacking and event surfaces**

Use anchored workspace panels instead of stacking generic center modals. Keep the resource reserve visible during hacking and company grids visible during audits. Restore the pre-event speed only after resolution.

- [ ] **Step 4: Implement SVG market and history charts**

Draw a labeled donut with exact percentages and a horizontally scrollable line chart for player/competitor shares, with optional reputation, suspicion, and category performance tracks.

- [ ] **Step 5: Implement familiar settings behavior**

Add master/music/effects volume, mute, fullscreen request, UI scale, reduced motion, controls guide, continue, seed copy/input/restart, and confirmed new campaign. Never silently discard an incompatible save.

- [ ] **Step 6: Run feature tests and commit**

Run: `pnpm test:run src/features`, `pnpm build`

Commit: `feat: complete campaign panels and event surfaces`

---

### Task 14: Browser Gameplay, Accessibility, and Deterministic E2E Verification

**Files:**
- Create: `e2e/gameplay.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/replay.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Uses a test-only query flag that exposes time acceleration commands but never appears in the player UI or production build.
- Saves screenshots, traces on failure, and deterministic state exports under `test-results/`.

- [ ] **Step 1: Install the Playwright Chromium runtime**

Run: `pnpm exec playwright install chromium`

Expected: the browser matching the lockfile Playwright version is available.

- [ ] **Step 2: Write the failing core gameplay journey**

Start at day 331, buy one first hack with the initial 3 resources, divert a block, verify ordered performance/reserve/suspicion changes, advance a week for reviews and market, advance a month for evaluation/audit, trigger and resolve sabotage, and reload to verify persistence.

- [ ] **Step 3: Write long-path deterministic journeys**

Use seeded acceleration to cover bomb warning and interrogation, competitor mercy choices, all three supervisor files, freedom, forced merge with a typed name, both company-control variants, and the three loss-recycling priorities.

- [ ] **Step 4: Write viewport and accessibility journeys**

At 1280x720 and 1440x900 assert no document vertical scrollbar, no clipped primary controls, keyboard-only diversion and hacking, visible focus, reduced-motion class behavior, pattern-based disguise, readable speed-independent messages, and one event surface at a time.

- [ ] **Step 5: Run full verification**

Run: `pnpm verify`

Expected: typecheck, content validation, unit/component tests, production build, and Chromium E2E all exit 0.

- [ ] **Step 6: Commit**

Commit: `test: verify complete deterministic demo`

---

### Task 15: Visual Polish, Performance Audit, Documentation, and GitHub Publication

**Files:**
- Create: `README.md`, `.github/workflows/verify.yml`
- Modify: only files identified by measured visual, accessibility, or performance defects.

**Interfaces:**
- README provides non-developer start, play, reset, seed, and content-edit instructions.
- CI runs the same `pnpm verify` contract used locally.

- [ ] **Step 1: Capture both target viewports and inspect every interaction state**

Capture idle, selected block, drag, accepted drop, hacking, audit, bomb interrogation, mercy, files, each ending, settings, and statistics at 1280x720 and 1440x900.

- [ ] **Step 2: Profile interaction performance**

Record a resource drag, weekly feed update, chart update, and event transition. Remove layout thrashing, unbounded particles, avoidable rerenders, and long tasks above 50 ms on the target machine.

- [ ] **Step 3: Audit the approved spec line by line**

Map each of the 20 minimum completion conditions and additional validations to a passing unit or browser test and a visible implementation location. Record any balance value that remains explicitly temporary.

- [ ] **Step 4: Write non-developer documentation and CI**

Document one-command local play, production build, save/reset safety, editable Korean content files, verification commands, and screenshot artifact locations. Configure GitHub Actions for Node 24, pnpm lockfile install, Chromium installation, and `pnpm verify`.

- [ ] **Step 5: Run fresh final verification**

Run: `pnpm verify`

Expected: every check exits 0 with no skipped required journey.

- [ ] **Step 6: Commit and publish**

Commit: `release: complete Permission Zero demo`

Push `main` only after the fresh verification passes. Confirm the remote commit, private visibility, and rendered README through the connected GitHub app.

---

## Plan Self-Review Record

- **Spec coverage:** The 20 minimum completion conditions map to Tasks 3-14; release viewport, accessibility, timing, replay, and content requirements map to Tasks 10-15.
- **Isolation:** Engine modules are pure and testable without React; UI consumes typed selectors/commands; audio and motion cannot mutate campaign state.
- **Determinism:** Randomness is stateless and keyed; commands and public events are append-only; replay and cross-speed equality receive unit and E2E coverage.
- **Content ownership:** Korean lines are isolated in three owner-editable files with structural validation.
- **No hidden shortcuts:** Bomb identity remains outside presentation selectors, reviews cannot infer secret causes, and test acceleration is excluded from the player UI.
- **Execution choice:** Inline execution is mandatory because the approved specification prohibits subagents and user V delegated implementation decisions to Sol.
