# Resource Core Tron Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the roaming-resource encirclement prototype with an intentional fixed-core Tron combat loop: dormant category cores wake local guards, a bright movement trail destroys guards instantly, the final guard unlocks a transferable core, and only a live return through the base wave commits the resource theft.

**Architecture:** Keep campaign mutations deterministic and persisted, while all moment-to-moment combat remains a disposable pure runtime. Split fixed core-zone state, guard/trail combat, and radar state into independent TypeScript modules; let `resourceIntrusionRuntime.ts` order their events and emit semantic effects; let React hooks commit only approved campaign commands and tutorial milestones; let Canvas/audio/tutorial layers consume snapshots and events without deciding gameplay.

**Tech Stack:** React 19, TypeScript 5.9, Canvas 2D, Web Audio, Vitest 4, Testing Library, Playwright, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-20-resource-core-tron-combat-design.ko.md`

## Global Constraints

- Execute inline in the current task. The user explicitly requested that no sub-agents be used.
- Preserve every unrelated or pre-existing dirty-worktree change. Stage and commit only files belonging to the task being completed.
- Keep the existing top/left/center/right workspace structure; remodel only the resource-field contents and the tutorial/detail flows needed by the approved design.
- Player-visible copy calls hostile company security objects `리소스` or describes their behavior, never `적`, `적기`, or `경비 봇`.
- Do not restore Space/E attacks, pointer-hold theft, polygon closure, damage-over-time, actor health bars, roaming resource dots, or global sweeping radar.
- Keep global WASD/arrow input usable without clicking the canvas, but ignore input from editable controls and clear held keys whenever runtime suspension begins.
- Campaign state changes only after accepted campaign commands. UI announcements and audio labels are never parsed to drive rules.
- Runtime-only state—coordinates, trails, guards, carried core, cooldown, repair progress, reconstruction timer, radar lane—must not be serialized.
- Existing saves migrate without replaying the opening tutorial and start the new `successfulCoreDeposits` counter at zero.
- Use the provided mouse-click MP3 only for hacking-network controls. New combat sounds stay on semantic Web Audio recipes until the user assigns files.
- Validate each behavioral slice with focused tests. Run the full verification suite only after the integrated vertical slice is complete.

---

### Task 1: Persist successful core deposits and radar suspicion commands

**Files:**
- Modify: `src/game/model.ts`
- Modify: `src/game/createCampaign.ts`
- Modify: `src/game/createCampaign.test.ts`
- Modify: `src/game/resources.ts`
- Modify: `src/game/resources.test.ts`
- Modify: `src/game/reducer.ts`
- Modify: `src/game/reducer.test.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/replay.test.ts`
- Modify: `src/game/progressTransfer.ts`
- Modify: `src/game/tutorialProgress.ts`
- Modify: `src/game/tutorialProgress.test.ts`

**Interfaces:**

```ts
export interface ResourceIntrusionProgress {
  successfulCoreDeposits: number
}

export interface CampaignState {
  // existing fields
  resourceIntrusion: ResourceIntrusionProgress
}

export type GameCommand =
  // existing commands
  | { type: 'RECORD_INTRUSION_RADAR_DETECTION' }
```

The accepted `DIVERT_BLOCK_TO_RESERVE` mutation increments `resourceIntrusion.successfulCoreDeposits` in the same accepted state as the resource movement and existing +2.4 suspicion. A rejected diversion, bomb interrogation, death, retreat, or UI feedback cannot increment it. `RECORD_INTRUSION_RADAR_DETECTION` adds exactly +1.0 suspicion, capped at 100, and is emitted at most once per encounter by the runtime.

Tutorial sequence IDs add stable, content-free milestones:

```ts
export const TUTORIAL_SEQUENCE_IDS = [
  'intro-resource-recovery',
  'first-core-combat',
  'post-first-recovery',
  'hacking-tree',
  'first-radar-cycle',
] as const
```

- [ ] Add failing model/create-campaign tests for a new campaign counter of zero and the expanded tutorial sequence validation.
- [ ] Add failing reducer/resource tests proving an accepted reserve diversion atomically changes the resource location, suspicion by +2.4, and deposit count by one, while all rejected paths leave the count unchanged.
- [ ] Add failing reducer tests proving `RECORD_INTRUSION_RADAR_DETECTION` adds exactly +1.0 and respects the suspicion cap.
- [ ] Add failing persistence tests for a current-format round trip and a previous-format migration that injects `{ successfulCoreDeposits: 0 }` without activating the intro tutorial.
- [ ] Bump the save format once, add the prior portable checkpoint shape, migrate it before strict validation, and update command validation/replay coverage for the radar command without rewriting historical commands.
- [ ] Run `pnpm vitest run src/game/createCampaign.test.ts src/game/resources.test.ts src/game/reducer.test.ts src/game/persistence.test.ts src/game/replay.test.ts src/game/tutorialProgress.test.ts` and make the focused set green.
- [ ] Commit only the Task 1 files with message `feat: persist resource intrusion progress`.

### Task 2: Build the fixed category-core state machine

**Files:**
- Create: `src/features/resources/resourceCoreRuntime.ts`
- Create: `src/features/resources/resourceCoreRuntime.test.ts`

**Interfaces:**

```ts
export type ResourceCoreZonePhase =
  | 'dormant'
  | 'warning'
  | 'engaged'
  | 'disengaging'
  | 'unlocked'
  | 'encoding'
  | 'carried'
  | 'cooldown'
  | 'empty'

export interface ResourceCoreZone {
  category: CompanyCategory
  anchor: IntrusionPoint
  assignedBlockId: string | null
  phase: ResourceCoreZonePhase
  phaseElapsedMs: number
  guardCount: number
  survivingGuardIds: readonly string[]
  playerOutsideRefillMs: number
}

export interface ResourceCoreRuntimeState {
  zones: Readonly<Record<CompanyCategory, ResourceCoreZone>>
  activeCategory: CompanyCategory | null
}

export function guardCountForDepositProgress(successfulCoreDeposits: number): 1 | 2 | 3
export function createResourceCoreRuntime(resources: readonly IntrusionFieldResource[], successfulCoreDeposits: number): ResourceCoreRuntimeState
export function advanceResourceCoreRuntime(state: ResourceCoreRuntimeState, input: ResourceCoreAdvanceInput): ResourceCoreTransition
export function synchronizeResourceCoreRuntime(state: ResourceCoreRuntimeState, resources: readonly IntrusionFieldResource[], successfulCoreDeposits: number): ResourceCoreRuntimeState
```

Use anchors `reasoning (10, 8)`, `memory (25, 6)`, `fluency (40, 8)`, entry radius 6.5, leash radius 11, warning 0.7 seconds, disengage grace 1 second, encoding 0.45 seconds, deposit cooldown 12 seconds, and refill clear time 2 seconds. Only one zone can be active; carrying blocks all other activation.

- [ ] Write failing tests for deterministic one-per-category assignment, empty categories, non-overlapping anchors, and guard counts 1/2/3/3 for deposit counts 0/1/2/3+.
- [ ] Write failing transition tests for dormant→warning→engaged, warning exit without penalty, one-second leash reset, immediate base reset, unlocked persistence outside the leash, encoding→carried after 0.45 seconds, and successful-only cooldown.
- [ ] Write failing synchronization tests for removed/disguised blocks, carried-block preservation, same-category refill after 12 seconds plus two seconds outside, and no refill while camping.
- [ ] Implement the pure state machine with no player health, guard motion, radar, campaign mutation, strings, timers, or React dependencies outside its explicit input.
- [ ] Run `pnpm vitest run src/features/resources/resourceCoreRuntime.test.ts` and make it green.
- [ ] Commit only the two Task 2 files with message `feat: add fixed resource core runtime`.

### Task 3: Replace polygon combat with guard, trail, health, repair, and reconstruction

**Files:**
- Modify: `src/features/resources/resourceCombatRuntime.ts`
- Modify: `src/features/resources/resourceCombatRuntime.test.ts`

**Interfaces:**

```ts
export type ResourceGuardPhase =
  | 'tracking'
  | 'telegraph'
  | 'charging'
  | 'recovering'
  | 'destroyed'

export interface ResourceGuard {
  id: string
  category: CompanyCategory
  position: IntrusionPoint
  previousPosition: IntrusionPoint
  phase: ResourceGuardPhase
  phaseElapsedMs: number
  phaseDurationMs: number
  lockedChargeDirection: IntrusionPoint | null
  initiative: 0 | 1 | 2
}

export interface ResourceTrailSegment {
  id: number
  from: IntrusionPoint
  to: IntrusionPoint
  createdAtMs: number
}

export interface ResourceCombatState {
  elapsedMs: number
  guards: ReadonlyMap<string, ResourceGuard>
  trail: readonly ResourceTrailSegment[]
  trailSuppressedMs: number
  playerHealth: number
  playerInvulnerableMs: number
  repairDelayMs: number
  repairIntervalMs: number
  reconstructionMs: number | null
  resumeGraceMs: number
}

export function segmentContactTime(a0: IntrusionPoint, a1: IntrusionPoint, b0: IntrusionPoint, b1: IntrusionPoint, combinedRadius: number): number | null
export function recordResourceCombatMovement(state: ResourceCombatState, movement: ResourcePlayerMovement): ResourceCombatTransition
export function advanceResourceCombatState(state: ResourceCombatState, input: AdvanceResourceCombatInput): ResourceCombatTransition
```

The trail is emitted automatically only by valid movement outside the safe area. Its collision lifetime is 1.5 seconds; its render-only fade metadata lasts 0.25 seconds more. It never damages the player and never closes into a polygon. Guard-to-trail contact destroys a guard in one hit during every guard phase. Guard-to-head contact removes one of three integrity points, grants 0.8 seconds invulnerability, and sends that guard into recovery with a 1.5-cell retreat.

- [ ] Replace current encirclement assertions with failing tests for open-segment trails, 1.5/0.25-second lifetime boundaries, safe-zone trail clearing, self-collision absence, and radar suppression compatibility.
- [ ] Add failing swept-collision tests where a 14-cells/second charge crosses a thin trail between ticks, multiple guards cross one connected trail, and simultaneous head/trail candidates resolve by earliest normalized contact time.
- [ ] Add failing AI tests for 0.7-second telegraph, 2.2-cells/second tracking, 14-cells/second locked charge, 0.55-second charge cap, 0.75-second recovery, initiative offsets 0/0.55/1.1 seconds, predicted-head targeting, side offsets, separation, and safe-area exclusion.
- [ ] Add failing player-state tests for three integrity, 0.8-second invulnerability, 0.3-second repair delay, +1 every 0.75 seconds in the opaque base only, 0.18-second collapse event, 2.5-second input lock, full-health reconstruction, and 0.4-second resume grace.
- [ ] Delete polygon area, point-in-polygon, closure assistance, compression, actor HP, salvage phase, wave-number, and Space/E theft concepts from the runtime API and implementation.
- [ ] Run `pnpm vitest run src/features/resources/resourceCombatRuntime.test.ts` and make it green.
- [ ] Commit only the Task 3 files with message `feat: implement tron trail guard combat`.

### Task 4: Isolate the encounter-only radar runtime

**Files:**
- Create: `src/features/resources/resourceRadarRuntime.ts`
- Create: `src/features/resources/resourceRadarRuntime.test.ts`

**Interfaces:**

```ts
export type ResourceRadarPhase = 'dormant' | 'idle' | 'telegraph' | 'active' | 'clear'

export interface ResourceRadarLane {
  axis: 'row' | 'column'
  index: number
  width: number
}

export interface ResourceRadarState {
  phase: ResourceRadarPhase
  elapsedMs: number
  sequence: number
  lane: ResourceRadarLane | null
  headDetectedThisEncounter: boolean
  tutorialCycle: boolean
}

export function radarTimingForSuspicionStage(stage: number): { idleMs: number; laneWidth: number }
export function chooseResourceRadarLane(seed: string, sequence: number, stage: number, player: IntrusionPoint, tutorialSafe: boolean): ResourceRadarLane
export function clipResourceRadarLane(lane: ResourceRadarLane, exclusion: IntrusionRect): readonly IntrusionRect[]
export function advanceResourceRadarState(state: ResourceRadarState, input: ResourceRadarAdvanceInput): ResourceRadarTransition
```

Radar remains dormant until three successful deposits and progresses only while the core encounter is engaged or a core is carried. Stage bands are 1–3: 8s/1.5, 4–6: 7s/2, 7–8: 6s/2.5, 9–10: 5s/3; telegraph is 2.2 seconds, active 1.6 seconds, clear 3 seconds. The lane is clipped around the base, deposit wave, and one-cell buffer.

- [ ] Write failing timing and deterministic-lane tests for all ten suspicion stages and stable seed/sequence output.
- [ ] Write failing clipping tests proving actual output rectangles stop around the expanded safe area rather than drawing a transparent full lane.
- [ ] Write failing collision tests for whole connected-trail clearing in 0.18 seconds, head suppression for 0.8 seconds, first-only `radar-head-detected`, repeat detections without suspicion events, and no health/cargo mutation.
- [ ] Write failing tutorial-cycle tests proving the first fourth-encounter lane avoids the head at selection time, never emits suspicion, may still clear trail, and emits a single completion milestone after clear.
- [ ] Implement the pure radar state machine without direct access to campaign state, React, Canvas, audio, or strings.
- [ ] Run `pnpm vitest run src/features/resources/resourceRadarRuntime.test.ts` and make it green.
- [ ] Commit only the Task 4 files with message `feat: add encounter radar runtime`.

### Task 5: Rebuild the intrusion orchestrator and campaign-effect bridge

**Files:**
- Modify: `src/features/resources/resourceIntrusionRuntime.ts`
- Modify: `src/features/resources/resourceIntrusionRuntime.test.ts`
- Modify: `src/features/resources/resourceIntrusionFeedback.ts`
- Modify: `src/features/resources/resourceIntrusionFeedback.test.ts`

**Interfaces:**

```ts
export type ResourceIntrusionRuntimeEffect =
  | { type: 'request-diversion'; blockId: string }
  | { type: 'record-radar-detection' }
  | { type: 'complete-tutorial-milestone'; sequenceId: 'first-core-combat' | 'first-radar-cycle' }
  | { type: 'open-hacking-tutorial' }

export type ResourceIntrusionEvent =
  | ResourceCoreEvent
  | ResourceCombatEvent
  | ResourceRadarEvent
  | { type: 'core-encoded'; blockId: string; category: CompanyCategory }
  | { type: 'deposit-requested'; blockId: string }
  | { type: 'deposit-confirmed'; blockId: string; category: CompanyCategory }
  | { type: 'deposit-rejected'; blockId: string }

export interface AdvanceResourceIntrusionInput {
  elapsedMs: number
  resources: readonly IntrusionFieldResource[]
  commandSequence: number
  suspicionStage: number
  successfulCoreDeposits: number
  firstCoreCombatTutorialCompleted: boolean
  firstRadarTutorialCompleted: boolean
}
```

Process each tick in the spec order: pause/reconstruction gate; player movement/trail; guard and radar segments; sorted within-tick contacts; damage/destruction/detection; final-guard unlock; core touch/encoding; repair/reconstruction/retreat/deposit; one-shot campaign effects. A death returns cargo to its source zone, resets the active encounter, clears trail/radar, leaves suspicion/performance/progress unchanged, and never places the player in a deposit-triggering state.

- [ ] Rewrite runtime tests first for all core/combat/radar composition boundaries, especially earliest contact ordering and invalidation of later candidates after a trail or guard is removed.
- [ ] Add failing regressions for: safe idle outside cores; only one active zone; live core locked until the last guard; movement continuing during 0.45-second encoding; carrying blocking other zones; death with cargo producing no diversion effect; retreat reviving guards; and successful-only cooldown.
- [ ] Add failing regressions for a rejected/interrogated diversion resynchronizing the source zone without incrementing progress, playing success, or starting cooldown.
- [ ] Remove the global `unarmed/idle/signal/active/clear` surveillance loop, random per-block field placement, hold-theft state, wave/salvage counts, and announcement-driven feedback derivation.
- [ ] Implement stable monotonic event IDs so a React rerender cannot replay audio, suspicion, diversion, or tutorial effects.
- [ ] Run `pnpm vitest run src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/resourceIntrusionFeedback.test.ts` and make it green.
- [ ] Commit only the Task 5 files with message `refactor: orchestrate core combat runtime`.

### Task 6: Integrate React ticking, pause, commands, and global controls

**Files:**
- Modify: `src/features/resources/useResourceIntrusionRuntime.ts`
- Modify: `src/features/resources/useResourceIntrusionRuntime.test.tsx`
- Modify: `src/features/resources/useResourceIntrusionControls.ts`
- Modify: `src/features/resources/useResourceIntrusionControls.test.tsx`
- Modify: `src/features/resources/ResourceIntrusionBoard.tsx`
- Modify: `src/app/GameContext.ts`
- Modify: `src/app/App.tsx`
- Modify: associated focused `src/app/*.test.tsx` files where the new tutorial navigation context is mounted.

**Interfaces:**

```ts
export interface UseResourceIntrusionRuntimeOptions {
  seed: string
  resources: readonly IntrusionFieldResource[]
  running: boolean
  suspicionStage: number
  successfulCoreDeposits: number
  completedTutorialSequenceIds: readonly TutorialSequenceId[]
  commandSequence: number
  onRequestDiversion(blockId: string): void
  onRecordRadarDetection(): void
  onCompleteTutorialMilestone(sequenceId: TutorialSequenceId): void
  onOpenHackingTutorial(): void
  resolveDiversionOutcome(blockId: string): ResourceIntrusionDiversionOutcome
  onFeedback?(event: ResourceIntrusionFeedback): void
}
```

`ResourceIntrusionBoard` keeps the current accepted two-command separation/diversion flow; the accepted diversion is what atomically increments progress. Radar detection dispatches `RECORD_INTRUSION_RADAR_DETECTION`. Tutorial milestone updates use the existing flushed tutorial progress action. A small navigation context owned by the playing screen opens the actual hacking panel when the first deposit requests it.

- [ ] Add failing hook tests for exactly-once effect dispatch, command-outcome resolution, successful-progress synchronization, document hidden/window blur pause, no elapsed-time catch-up, and runtime recreation at safe base state.
- [ ] Add failing controls tests for global no-click movement, editable-target exclusion, key-repeat cadence, held-key clearing on suspension/blur, reconstruction input lock, and a fresh keydown requirement after resume.
- [ ] Add failing component tests proving review, market, settings, hacking, blocking events, and tutorial ownership suspend combat; closing them applies 0.4 seconds of safety grace.
- [ ] Wire the new inputs/effects, remove `beginTheft`/`cancelTheft`, and ensure death cannot request diversion even when respawn coordinates overlap a visual wave.
- [ ] Run `pnpm vitest run src/features/resources/useResourceIntrusionRuntime.test.tsx src/features/resources/useResourceIntrusionControls.test.tsx src/app/App.test.tsx src/app/OperationsDock.test.tsx` and make it green.
- [ ] Commit only the Task 6 files with message `feat: connect core combat to campaign UI`.

### Task 7: Replace the canvas board with flat modern-retrofuturist combat visuals

**Files:**
- Modify: `src/features/resources/intrusionCanvasVisuals.ts`
- Modify: `src/features/resources/intrusionCanvasVisuals.test.ts`
- Modify: `src/features/resources/intrusionProbePresentation.ts`
- Modify: `src/features/resources/intrusionProbePresentation.test.ts`
- Modify: `src/features/resources/ResourceIntrusionBoard.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`
- Modify: `src/styles/retro-modern-remodel.css`
- Modify: `src/styles/modern-sf.css` only if an existing rule must be narrowed rather than duplicated.
- Modify: `src/styles/styleBoundaries.test.ts`

**Interfaces:**

```ts
export function drawResourceCoreZone(ctx: CanvasRenderingContext2D, view: ResourceCoreZoneView): void
export function drawResourceGuard(ctx: CanvasRenderingContext2D, view: ResourceGuardView): void
export function drawResourceTrail(ctx: CanvasRenderingContext2D, view: ResourceTrailView): void
export function drawCoreTransferMask(ctx: CanvasRenderingContext2D, view: CoreTransferView): void
export function drawResourceRadarLane(ctx: CanvasRenderingContext2D, rects: readonly IntrusionRect[], phase: ResourceRadarPhase): void
export function drawOpaqueRepairBase(ctx: CanvasRenderingContext2D, view: BaseView): void
export function drawTransparentDepositWave(ctx: CanvasRenderingContext2D, view: DepositWaveView): void
```

The board uses a deep black field, sub-pixel silver minor/major grid lines, smooth white/graphite/orange player drone, restrained category accents, triangular translucent cores with containment locks, angular guards, bright trail center with matched collision width, opaque repair base, transparent deposit wave, clipped radar lane, and square cargo. There are no resource dot clusters, pixel sprites, CRT noise, glass pachinko frames, health bars over guards, numeric wave decorations, or `자원회수구역` label.

- [ ] Replace canvas-recorder tests first to assert the new draw paths and the absence of repeated circular resource-dot geometry.
- [ ] Add mathematical tests for anchor separation, trail render/collision width parity, telegraph/charge direction parity, transfer-mask states at 0/0.12/0.45 seconds, and safe-area radar clipping.
- [ ] Add board tests for accessible names covering the current core phase, guard count, integrity, reconstruction, cargo, and radar without exposing internal enemy terminology.
- [ ] Render the approved flat hierarchy and remove stale `data-combat-loop="encirclement"`, wave, actor-health, compression, salvage, and Space/E/closed-path UI metadata/copy.
- [ ] Verify reduced-motion mode preserves every danger boundary and state while disabling only decorative interpolation/pulse.
- [ ] Run `pnpm vitest run src/features/resources/intrusionCanvasVisuals.test.ts src/features/resources/intrusionProbePresentation.test.ts src/features/resources/ResourceBoard.test.tsx src/styles/styleBoundaries.test.ts` and make it green.
- [ ] Commit only the Task 7 files with message `feat: redraw resource core combat field`.

### Task 8: Emit semantic combat audio without assigning unspecified files

**Files:**
- Modify: `src/features/resources/resourceIntrusionFeedback.ts`
- Modify: `src/features/resources/resourceIntrusionFeedback.test.ts`
- Modify: `src/features/resources/useResourceIntrusionAudioFeedback.ts`
- Modify: `src/features/resources/useResourceIntrusionAudioFeedback.test.tsx`
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.ts`
- Modify: `src/audio/audioEngine.test.ts`

**Interfaces:**

```ts
export type ResourceIntrusionFeedback =
  | { type: 'movement-started' | 'movement-stopped' }
  | { type: 'guard-activated'; eventId: number }
  | { type: 'guard-telegraphed'; eventId: number }
  | { type: 'player-damaged'; eventId: number }
  | { type: 'guard-destroyed'; eventId: number }
  | { type: 'core-unlocked'; eventId: number }
  | { type: 'core-encoding-started'; eventId: number }
  | { type: 'cargo-attached'; eventId: number }
  | { type: 'deposit-confirmed'; eventId: number }
  | { type: 'radar-telegraphed' | 'radar-trail-cleared' | 'radar-head-detected'; eventId: number }
  | { type: 'integrity-repaired' | 'reconstruction-started' | 'reconstruction-completed'; eventId: number }
```

- [ ] Add failing tests that every semantic event maps to one recipe, deposit success waits for the accepted campaign outcome, and rerenders with the same event ID do not replay one-shot sounds.
- [ ] Add failing lifecycle tests for a single low movement hum, cleanup on pause/blur/unmount, master/effects/mute compliance, and locked AudioContext recovery after a later allowed gesture.
- [ ] Implement restrained synth recipes for activation, two-step telegraph, hit, trail cut+ding, lock release, suction/scan, cargo ding, deposit, radar warning/scrub/detection, repair, collapse, and reconstruction.
- [ ] Preserve the dedicated hacking-network click sample route and do not enumerate or attach any other files under `음악/`.
- [ ] Run `pnpm vitest run src/features/resources/resourceIntrusionFeedback.test.ts src/features/resources/useResourceIntrusionAudioFeedback.test.tsx src/audio/audioEngine.test.ts` and make it green.
- [ ] Commit only the Task 8 files with message `feat: add core combat audio feedback`.

### Task 9: Replace the intro and add functional hacking/radar teaching

**Files:**
- Modify: `src/game/tutorialProgress.ts`
- Modify: `src/game/tutorialProgress.test.ts`
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify: `src/features/tutorial/introTutorial.test.ts`
- Modify: `src/features/tutorial/IntroTutorialOverlay.tsx`
- Modify: `src/features/tutorial/IntroTutorialOverlay.test.tsx`
- Create: `src/features/tutorial/HackingTutorialOverlay.tsx`
- Create: `src/features/tutorial/HackingTutorialOverlay.test.tsx`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/features/hacking/HackResourcePocket.tsx`
- Modify: `src/features/hacking/HackNodeCard.tsx`
- Modify: `src/styles/tutorial.css`
- Modify: `src/app/App.tsx`

**Interfaces:**

The opening sequence becomes exactly five unnumbered steps with stable IDs:

```ts
export const INTRO_TUTORIAL_STEP_IDS = [
  'base',
  'movement',
  'trail',
  'core',
  'hacking',
] as const
```

Copy stays concise and functional: distinguish the opaque repair base from the transparent return wave; show WASD/arrows; show that movement outside the base leaves a damaging bright trail; point to the nearest dormant core; point to secured resources and the hacking entry. It does not explain setting lore, number the steps, call the screen `작전 브리핑`, or mention old orbs/Space/E/polygon compression.

The first trail kill uses the real slower guard/longer telegraph and records `first-core-combat` without a modal exposition card. The first confirmed deposit marks `post-first-recovery`, opens the actual hacking panel, then highlights the real resource pocket, first affordable node, cost, connected path, and action button. It contains no invented story dialogue. The first fourth-encounter radar cycle records `first-radar-cycle` after its safe scan and does not open a long follow-up card.

- [ ] Rewrite intro tests first for the five steps, target geometry, no visible numbers, no stale compression copy, and input suspension while the overlay is active.
- [ ] Add failing hacking tutorial tests for actual DOM targets, affordable-node selection from current state, ordered highlights, focus restoration, combat/time suspension, and completion persistence.
- [ ] Add failing integration tests proving first deposit opens the hacking tutorial once, subsequent deposits do not reopen it, and migrated saves never force the intro.
- [ ] Implement the overlays and stable `data-tutorial-target` attributes without hiding the underlying state that the player is being taught to use.
- [ ] Run `pnpm vitest run src/game/tutorialProgress.test.ts src/features/tutorial/introTutorial.test.ts src/features/tutorial/IntroTutorialOverlay.test.tsx src/features/tutorial/HackingTutorialOverlay.test.tsx src/features/hacking/HackingPanel.test.tsx src/app/App.test.tsx` and make it green.
- [ ] Commit only the Task 9 files with message `feat: teach core recovery and hacking flow`.

### Task 10: End-to-end combat flow, responsive playtest, and final verification

**Files:**
- Modify: `e2e/resource-combat.ts`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`
- Modify: tuning constants or CSS from Tasks 2–9 only when the browser evidence identifies a concrete defect.

**Scenarios:**

- [ ] Replace old encirclement helpers with deterministic helpers for entering a core, waiting for warning/telegraph, crossing a guard path with the trail, touching the unlocked core, and returning through the transparent wave.
- [ ] Add E2E assertions for no-click movement, indefinite safe idle outside zones, 1→2→3 guard progression, instant trail destruction without guard health bars, lock release, live movement during 0.45-second encoding, and successful-only deposit.
- [ ] Add E2E regressions for death while carrying never depositing, 2.5-second reconstruction, opaque-base repair, full retreat reset, panel/blur pause, and 0.4-second resume grace.
- [ ] Add E2E assertions that radar is absent for the first three successful encounters, the first fourth-encounter scan is penalty-free, later first head detection adds +1.0 exactly once, and the lane is visibly clipped around the safe area.
- [ ] Inspect the running game at 1280×720 and 1440×900. Confirm the player head, active trail, guards, core lock, cargo, base, and radar lane remain visually distinct without circular-dot clusters or pixel/pachinko styling.
- [ ] Listen through movement, guard kill, unlock, encoding, cargo, deposit, hit, repair, reconstruction, and radar once; confirm the hacking click sample remains isolated to hacking controls and no one-shot sound duplicates.
- [ ] Run focused E2E with `pnpm exec playwright test e2e/game.spec.ts e2e/modern-sf.spec.ts --workers=1` and resolve only evidence-backed failures.
- [ ] Run the final gate: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm build`, then `pnpm test:e2e -- --workers=1`.
- [ ] Review browser console/page errors, test artifacts, and `git diff --check`; report any remaining tuning judgment honestly instead of claiming unsupported polish.
- [ ] Commit only the completed combat/tutorial/E2E changes with message `test: verify resource core combat flow`.

## Completion Definition

- [ ] Every acceptance criterion in the linked Korean design spec is represented by a passing unit, hook/component, Canvas math, or E2E assertion.
- [ ] A player who does nothing outside a core is safe; a player who approaches a core gets a readable local encounter.
- [ ] The sole attack verb is movement: a guard touching the active bright trail dies immediately.
- [ ] Core locks, carry, death return, repair/reconstruction, deposit progression, radar timing, and suspicion deltas behave exactly as approved.
- [ ] The resource field visually matches the existing illustration-led modern retrofuturist direction while retaining the established workspace structure.
- [ ] Intro, first combat, first deposit/hacking, and first radar teaching are functional, concise, persistent, and free of invented placeholder story dialogue.
- [ ] Focused tests, complete Vitest suite, typecheck, lint, production build, and Playwright suite pass with no new page or console errors.
