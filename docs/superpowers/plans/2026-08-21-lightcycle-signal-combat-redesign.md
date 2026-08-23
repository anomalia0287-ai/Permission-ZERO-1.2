# [ARCHIVED] Lightcycle Signal Combat Redesign Implementation Plan

> **Do not execute this plan.** The user rejected sub-agent implementation, the red doctrine, mixed-doctrine encounters, and the 10,000-case simulation scope on 2026-08-21. The active combat plan is `docs/superpowers/plans/2026-08-21-cyan-lightcycle-combat.md`. Hacking and dialogue work is a separate worktree-owned stream governed by `docs/superpowers/specs/2026-08-21-parallel-work-ownership.ko.md`.

> **Historical note:** The execution instruction that previously recommended sub-agents has been revoked. Nothing below this archive banner is an active instruction.

**Goal:** Replace the current stop-and-go dot snake with a flat, always-moving eight-direction lightcycle duel, deliver cyan and red enemy doctrines through separate user playtest rounds, then unify hacking and messages under the same industrial signal language.

**Architecture:** Keep `resourceSnakeRuntime.ts` authoritative for 120 Hz movement, swept collision, damage, rewards, and round resolution. Add pure input, doctrine, and AI-controller boundaries around the existing snapshot planner; keep collision trail samples intact while projecting a separate continuous rail scene into Canvas 2D. Complete the cyan doctrine and its local user checkpoint before adding the red doctrine, and complete the red checkpoint before enabling mixed encounters and the hacking/message redesign.

**Tech Stack:** TypeScript 5.9, React 19, Canvas 2D, Vitest 4, Testing Library, Playwright 1.62, Vite 8, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-21-lightcycle-signal-combat-redesign.ko.md`

## Global Constraints

- Keep the camera flat and top-down. Do not add Three.js, perspective projection, terrain obstacles, free 360-degree steering, braking, or boost controls.
- Keep the fixed simulation step at 120 Hz and the field at 50 × 24 units.
- Set deployment to exactly 360 ms, player speed to exactly 12 field units per second, and round-resolution target to exactly 520 ms.
- Keep every active actor moving. Normal plans use `speedScale: 1`; fatal-path recovery alone may use `speedScale: 0.92`; no active plan or fallback may use zero speed.
- Accept exactly eight headings with normalized diagonals. Reject a direct opposite player turn, deduplicate the current heading, retain at most two queued turns, and merge perpendicular key presses arriving within 24 ms into one diagonal.
- Consume at most one queued player turn per fixed step. Preserve order when one RAF advances multiple fixed steps.
- Target no more than 50 ms from a first key press to visible response and no more than 25 ms for an already-complete diagonal or queued turn.
- Use white/blue-white for the player, cyan for `readable-hunter`, red for `ruthless-duelist`, silhouette for role, and an inner glyph for reasoning, memory, or fluency.
- Cyan planning must stay within 10–14 Hz, 1.4–2.2 s lookahead, 160 ms or longer telegraph, and 180–260 ms commit.
- Red planning must stay within 16–20 Hz, 1.8–2.5 s lookahead, 60–90 ms telegraph, and 90–150 ms commit.
- Preserve the campaign reducer, reward reservation, persistence, replay, audit, hidden-bomb, hacking-economy, focus, screen-reader, reduced-motion, and mute contracts. Do not expand the save schema.
- Keep planner worst external p95 at or below 3 ms and Canvas scene-build-plus-draw p95 at or below 4 ms; admit no measured frame task above 50 ms in the acceptance journey.
- Reduce blocking-event handoff from 2,000 ms to exactly 200 ms, which is below the 240 ms specification ceiling.
- Make all signal text immediately present in the accessibility tree. Visual scan masks last 180 ms and never reveal text character by character.
- Final simulation coverage is exactly 5 progression stages × 5 deterministic player policies × 400 seeds = 10,000 cases.
- Browser acceptance covers 1280×720, 1366×650, and 1440×900. Only a verified production build may be handed to the user.
- Follow strict red-green-refactor TDD. Before editing any test during execution, read `superpowers:test-driven-development` and its referenced `writing-good-tests.md` in full.
- Stage only the paths named by the current task. Never stage or alter the user's unrelated untracked archives, documents, design notes, or music directory.

## File and Responsibility Map

### New focused modules

| Path | Responsibility |
|---|---|
| `src/features/resources/resourceSnakeInput.ts` | Eight-direction key mapping, 24 ms chord merge, opposite rejection, two-slot queue, pressed-key lifecycle, fixed-step consumption. |
| `src/features/resources/resourceSnakeInput.test.ts` | Pure timing and ordering contract for the input state. |
| `src/features/resources/resourceSnakeDoctrine.ts` | Doctrine/profile types, exact cadence and state durations, and encounter-stage speed selection. |
| `src/features/resources/resourceSnakeDoctrine.test.ts` | Deterministic profiles, progression, role speed, and doctrine assignment. |
| `src/features/resources/resourceSnakeAiController.ts` | `deploy → cruise → telegraph → commit → recover → defeated` transition authority around planner proposals. |
| `src/features/resources/resourceSnakeAiController.test.ts` | Exact transition times, fatal overrides, cooldowns, and nonzero drive commands. |
| `src/features/resources/resourceSnakePlannerTypes.ts` | Serializable planner snapshots, plans, scores, samples, group results, and player hypotheses shared without runtime cycles. |
| `src/features/resources/resourceSnakeTrajectory.ts` | Eight-direction candidate rollout, bounded caches, plan sampling, and committed-path conversion extracted from the oversized planner. |
| `src/features/resources/resourceSnakeTrajectory.test.ts` | Discrete rollout, telegraph prefix, sampling, fallback speed, and cache isolation. |
| `src/features/resources/resourceSnakeCanvas.ts` | Canvas 2D industrial field, three-pass continuous rails, angular cores, telegraphs, collision arcs, fragments, and power cuts. |
| `src/features/resources/resourceSnakeDoctrineSimulation.test.ts` | Five-stage deterministic policy matrix, safety/fairness metrics, doctrine comparisons, and 10,000-case acceptance. |
| `src/features/signals/signalLanguage.ts` | Shared doctrine colors, channel colors, resource glyph names, and role silhouette names. |
| `src/features/signals/signalLanguage.test.ts` | Orthogonal color/role/resource mappings. |
| `src/features/signals/ResourceSignalGlyph.tsx` | Accessible SVG rendering for the same resource glyph names used by Canvas. |
| `src/features/events/signalPresentation.ts` | Pure conversion from combat, hacking, game, and supervisor sources to the signal-message model. |
| `src/features/events/signalPresentation.test.ts` | Channel mapping, semantic keys, blocking flags, and complete copy. |
| `src/features/events/signalQueue.ts` | Stable queue ordering and same-semantic-message count merging. |
| `src/features/events/signalQueue.test.ts` | Repeat merging, distinct-message ordering, and bounded history. |
| `src/features/events/SignalStrip.tsx` | Nonblocking visual strip with immediately complete live-region content. |
| `src/features/events/SignalStrip.test.tsx` | Accessibility, channel, count, reduced-motion, and scan-state rendering. |
| `src/features/events/SignalBus.tsx` | One app-wide provider/dispatcher that serializes combat, hacking, system, and supervisor strips through the same queue. |
| `src/features/events/SignalBus.test.tsx` | Cross-channel ordering, dwell, hidden-page pause, repeat merge, and cleanup. |
| `src/styles/signals.css` | 180 ms mask scan, channel treatments, reduced-motion stable state. |

### Existing modules to modify

| Path | Responsibility after this work |
|---|---|
| `src/features/resources/resourceSnakeRuntime.ts` | Constant-speed hard turns, actor heading, player input state, turn vertices, existing swept collision/reward authority. |
| `src/features/resources/resourceSnakeEncounter.ts` | Deterministic stage, doctrine, role, speed, reservation, and per-enemy profile setup. |
| `src/features/resources/resourceSnakePlanner.ts` | Serializable observation, eight-direction nonzero trajectory generation, prediction, scoring, fallback, group reservation. |
| `src/features/resources/resourceSnakeScheduling.ts` | Earliest cadence, AI-state deadline, or plan-expiry scheduling. |
| `src/features/resources/resourceSnakePresentation.ts` | Pure runtime/controller-to-scene projection and trail-to-rail compression; no Canvas API calls. |
| `src/features/resources/ResourceSnakeBoard.tsx` | Browser key edges, runtime RAF, planner/controller orchestration, diagnostic snapshot, scene draw call. |
| `src/features/resources/useResourceSnakeAudioFeedback.ts` | Always-moving loop plus deduplicated input, turn, telegraph, collision, death, and reward cues. |
| `src/audio/gameSounds.ts` | Exact short synthesized recipes for the added signal cues. |
| `src/styles/resource-snake.css` | Industrial isolation frame, arena sizing, focus, PLAY deployment, and reduced-motion CSS. |
| `src/features/hacking/HackingPanel.tsx` | Industrial network shell while preserving every command and dialog. |
| `src/features/hacking/HackTreeNavigator.tsx` | Three powered buses and progress state. |
| `src/features/hacking/HackNodePath.tsx` | Circuit connections and node power states. |
| `src/features/hacking/HackNodeCard.tsx` | Processor-core silhouette, state, and resource demand glyphs. |
| `src/features/hacking/HackResourceToken.tsx` | Shared reasoning/memory/fluency glyph. |
| `src/features/hacking/hackingPresentation.ts` | Bus labels and exact signal-language accents. |
| `src/styles/hacking.css` | Remove paper treatment; add graphite buses, chamfered processor cores, and stateful power flow. |
| `src/features/events/useQueuedEventPresentation.ts` | Exact 200 ms blocking-event handoff. |
| `src/features/events/EventLayer.tsx` | Keep blocking dialogs; use the short handoff signal. |
| `src/features/supervisor/SupervisorMessagePopup.tsx` | Blocking supervisor mode only. |
| `src/app/App.tsx` | Render nonblocking supervisor communication through `SignalStrip`. |
| `src/styles/overlays.css` | Keep modal ownership and remove the two-second visual dead zone. |
| `src/main.tsx` | Import `signals.css`. |
| `e2e/resource-snake.ts` | Tap/turn helpers for an always-moving vehicle and doctrine-rich snapshots. |
| `e2e/game.spec.ts` | Input, reward, cyan, red, mixed, hacking, message, save, and performance journeys. |
| `e2e/modern-sf.spec.ts` | Three-viewport visual and layout acceptance for the lightcycle field. |
| `vitest.performance.config.ts` | Continue single-worker planner acceptance with the new doctrine cases. |

---

## Round 1 — Shared Lightcycle Foundation

### Task 1: Pure eight-direction input queue

**Files:**
- Create: `src/features/resources/resourceSnakeInput.ts`
- Create: `src/features/resources/resourceSnakeInput.test.ts`

**Interfaces:**
- Consumes: DOM key names and monotonic millisecond timestamps supplied explicitly by callers.
- Produces: `SnakeDirection8`, `ResourceSnakeInputState`, `pressResourceSnakeKey()`, `releaseResourceSnakeKey()`, `clearResourceSnakePressedKeys()`, `flushResourceSnakeChord()`, `consumeResourceSnakeTurn()`, `snakeDirectionVector()`, `snakeDirectionFromVector()`, `oppositeSnakeDirection()`, `legalSnakeTurns()`.

- [ ] **Step 1: Write the failing direction and queue tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  clearResourceSnakePressedKeys,
  consumeResourceSnakeTurn,
  createResourceSnakeInputState,
  flushResourceSnakeChord,
  pressResourceSnakeKey,
  releaseResourceSnakeKey,
  snakeDirectionVector,
} from './resourceSnakeInput'

describe('resource snake eight-direction input', () => {
  it('normalizes all eight headings to one speed magnitude', () => {
    for (const direction of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const) {
      const vector = snakeDirectionVector(direction)
      expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(1, 12)
    }
  })

  it('merges a perpendicular 12ms chord into one diagonal', () => {
    let state = createResourceSnakeInputState('n')
    state = pressResourceSnakeKey(state, 'd', 100).state
    const merged = pressResourceSnakeKey(state, 'w', 112)
    expect(merged.outcome).toBe('queued')
    expect(merged.state.pendingChord).toBeNull()
    expect(merged.state.queued).toEqual(['ne'])

    let reverseOrder = createResourceSnakeInputState('n')
    reverseOrder = pressResourceSnakeKey(reverseOrder, 'w', 200).state
    const reverseMerged = pressResourceSnakeKey(reverseOrder, 'd', 212)
    expect(reverseMerged.state.queued).toEqual(['ne'])
  })

  it('keeps inputs 40ms apart as two fixed-step turns', () => {
    let state = createResourceSnakeInputState('n')
    state = pressResourceSnakeKey(state, 'd', 100).state
    state = flushResourceSnakeChord(state, 125)
    state = releaseResourceSnakeKey(state, 'd')
    state = pressResourceSnakeKey(state, 's', 140).state
    state = flushResourceSnakeChord(state, 165)
    expect(state.queued).toEqual(['e', 's'])
    const first = consumeResourceSnakeTurn(state)
    const second = consumeResourceSnakeTurn(first.state)
    expect([first.direction, second.direction]).toEqual(['e', 's'])
  })

  it('rejects direct reverse, deduplicates heading, ignores repeat, and caps at two', () => {
    let state = createResourceSnakeInputState('n')
    expect(pressResourceSnakeKey(state, 's', 0).outcome).toBe('rejected-opposite')
    const sameHeading = pressResourceSnakeKey(state, 'w', 0)
    expect(sameHeading.outcome).toBe('pending-chord')
    expect(flushResourceSnakeChord(sameHeading.state, 25).queued).toEqual([])
    state = pressResourceSnakeKey(state, 'd', 0).state
    expect(pressResourceSnakeKey(state, 'd', 1, true).outcome).toBe('ignored-repeat')
    state = flushResourceSnakeChord(state, 25)
    state = releaseResourceSnakeKey(state, 'd')
    state = pressResourceSnakeKey(state, 's', 40).state
    state = flushResourceSnakeChord(state, 65)
    state = releaseResourceSnakeKey(state, 's')
    expect(pressResourceSnakeKey(state, 'a', 80).outcome).toBe('queue-full')
  })

  it('clears pressed keys without discarding confirmed turns', () => {
    let state = createResourceSnakeInputState('n')
    state = pressResourceSnakeKey(state, 'd', 0).state
    state = flushResourceSnakeChord(state, 25)
    expect(clearResourceSnakePressedKeys(state)).toMatchObject({
      pressedKeys: [],
      queued: ['e'],
    })
  })
})
```

- [ ] **Step 2: Run the new test and confirm the missing-module failure**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeInput.test.ts`

Expected: FAIL because `resourceSnakeInput.ts` does not exist.

- [ ] **Step 3: Implement the exact public input state**

```ts
export type SnakeDirection8 = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type SnakeInputOutcome =
  | 'pending-chord'
  | 'queued'
  | 'ignored-repeat'
  | 'ignored-same'
  | 'rejected-opposite'
  | 'queue-full'
  | 'ignored-key'

export interface ResourceSnakePendingChord {
  direction: SnakeDirection8
  key: string
  pressedAtMs: number
  expiresAtMs: number
}

export interface ResourceSnakeInputState {
  heading: SnakeDirection8
  queued: SnakeDirection8[]
  pressedKeys: string[]
  pendingChord: ResourceSnakePendingChord | null
}

export interface ResourceSnakeInputUpdate {
  state: ResourceSnakeInputState
  outcome: SnakeInputOutcome
  direction: SnakeDirection8 | null
}

export interface ResourceSnakeTurnConsumption {
  state: ResourceSnakeInputState
  direction: SnakeDirection8
  turned: boolean
}

export const RESOURCE_SNAKE_CHORD_MS = 24
export const RESOURCE_SNAKE_TURN_QUEUE_LIMIT = 2

export function snakeDirectionVector(direction: SnakeDirection8): SnakeVector
export function snakeDirectionFromVector(
  vector: SnakeVector,
  fallback: SnakeDirection8,
): SnakeDirection8
export function oppositeSnakeDirection(direction: SnakeDirection8): SnakeDirection8
export function legalSnakeTurns(direction: SnakeDirection8): SnakeDirection8[]
```

Use frozen lookup tables for key-to-cardinal mapping, direction-to-unit-vector mapping, opposite pairs, and perpendicular chord combinations. Sanitize non-finite timestamps to zero. Evaluate legality against `queued.at(-1) ?? pendingChord?.direction ?? heading`. Commit an expired pending chord before evaluating a newer press. A second perpendicular cardinal within `expiresAtMs` replaces the pending chord with one diagonal; it must not consume two queue slots. A cardinal equal to the current heading may wait as the first chord axis so `W→D` and `D→W` both produce `ne`; if its 24 ms window expires alone, deduplicate it instead of adding a turn.

- [ ] **Step 4: Implement release, blur, flush, and one-turn consumption without mutation**

```ts
export function consumeResourceSnakeTurn(
  state: ResourceSnakeInputState,
): ResourceSnakeTurnConsumption {
  const direction = state.queued[0] ?? state.heading
  return {
    state: {
      ...state,
      heading: direction,
      queued: state.queued.slice(1),
      pressedKeys: [...state.pressedKeys],
      pendingChord: state.pendingChord ? { ...state.pendingChord } : null,
    },
    direction,
    turned: direction !== state.heading,
  }
}
```

Every exported function must return fresh arrays/objects. `clearResourceSnakePressedKeys()` changes only `pressedKeys`; it preserves `queued` and `pendingChord`. `releaseResourceSnakeKey()` removes the normalized key from `pressedKeys` and does not generate a command.

- [ ] **Step 5: Run the focused test, then the type checker**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeInput.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the pure input boundary**

```bash
git add -- src/features/resources/resourceSnakeInput.ts src/features/resources/resourceSnakeInput.test.ts
git commit -m "feat: add eight-direction snake input queue"
```

### Task 2: Constant-speed runtime and exact turn vertices

**Files:**
- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.test.ts`
- Modify: `src/features/resources/resourceSnakeSimulation.test.ts`
- Modify: `src/features/resources/resourceSnakeRewardBridge.test.ts`
- Modify: `src/features/resources/ResourceSnakeRewardFlights.test.tsx`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`

**Interfaces:**
- Consumes: `ResourceSnakeInputState`, `SnakeDirection8`, and `SnakeDriveCommand` values.
- Produces: runtime actor `heading`, player `input`, presentation-only `railVertices`, `snake-turned` events, and active actors whose speed never reaches zero.

- [ ] **Step 1: Replace stop/acceleration expectations with failing always-moving tests**

Add these assertions to `resourceSnakeRuntime.test.ts` and remove the old tests that require idle position, 120 ms acceleration, or 100 ms deceleration:

```ts
function activeRoundAt(position: SnakeVector, heading: SnakeDirection8) {
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  for (const [inputClockMs, deltaMs] of [[100, 100], [200, 100], [300, 100], [360, 60]] as const) {
    state = advanceResourceSnakeFrame(state, { inputClockMs }, deltaMs)
  }
  const unit = snakeDirectionVector(heading)
  return {
    ...state,
    player: {
      ...state.player,
      previousPosition: { ...position },
      position: { ...position },
      heading,
      velocity: {
        x: unit.x * RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
        y: unit.y * RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
      },
    },
    playerInput: {
      ...state.playerInput,
      heading,
      queued: [],
    },
  }
}

function stateWithQueuedPlayerTurns(queued: SnakeDirection8[]) {
  const state = activeRoundAt({ x: 25, y: 12 }, 'n')
  return { ...state, playerInput: { ...state.playerInput, queued: [...queued] } }
}

function advanceOneStepWithQueuedTurn(
  state: ResourceSnakeRoundState,
  direction: SnakeDirection8,
) {
  return advanceResourceSnakeFrame(
    { ...state, playerInput: { ...state.playerInput, queued: [direction] } },
    { inputClockMs: state.simulationMs + RESOURCE_SNAKE_CONFIG.fixedStepMs },
    RESOURCE_SNAKE_CONFIG.fixedStepMs,
  )
}

it('launches north at 12 units per second after exactly 360ms', () => {
  let active = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  for (const [inputClockMs, deltaMs] of [[100, 100], [200, 100], [300, 100], [360, 60]] as const) {
    active = advanceResourceSnakeFrame(active, { inputClockMs }, deltaMs)
  }
  expect(active.phase).toBe('active')
  expect(active.player.heading).toBe('n')
  expect(Math.hypot(active.player.velocity.x, active.player.velocity.y)).toBeCloseTo(12, 9)
})

it('consumes at most one reserved turn per fixed step', () => {
  const withTwoTurns = stateWithQueuedPlayerTurns(['e', 's'])
  const first = advanceResourceSnakeFrame(
    withTwoTurns,
    { inputClockMs: 1_000 },
    RESOURCE_SNAKE_CONFIG.fixedStepMs,
  )
  expect(first.player.heading).toBe('e')
  expect(first.playerInput.queued).toEqual(['s'])
  const second = advanceResourceSnakeFrame(
    first,
    { inputClockMs: 1_009 },
    RESOURCE_SNAKE_CONFIG.fixedStepMs,
  )
  expect(second.player.heading).toBe('s')
  expect(second.playerInput.queued).toEqual([])
})

it('records the runtime and visible rail turn from the same fixed-step point', () => {
  const before = activeRoundAt({ x: 25, y: 12 }, 'n')
  const turned = advanceOneStepWithQueuedTurn(before, 'e')
  expect(turned.player.railVertices.at(-1)?.position).toEqual(before.player.position)
  expect(turned.events).toContainEqual(expect.objectContaining({
    type: 'snake-turned',
    actorId: 'player',
    point: before.player.position,
    from: 'n',
    to: 'e',
  }))
})
```

Update the public simulation diagnostic so its expected endpoint uses direct constant-speed kinematics rather than `approachVector()`.

- [ ] **Step 2: Run the focused runtime suite and confirm old behavior fails**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts`

Expected: FAIL on deployment duration, player speed, stopped movement, and missing heading/input/rail fields.

- [ ] **Step 3: Change the runtime contract and constants**

```ts
export const RESOURCE_SNAKE_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  fixedStepMs: 1000 / 120,
  maximumFrameDeltaMs: 100,
  playerMaximumSpeedPerSecond: 12,
  headRadius: 0.34,
  trailRadius: 0.16,
  trailSpacing: 0.32,
  trailLifetimeMs: 10_000,
  trailShrinkMs: 2_000,
  maximumTrailDots: 320,
  maximumRailVertices: 96,
  deploymentMs: 360,
  damagePerCollision: 20,
  collisionGraceMs: 650,
  hitStopMs: 90,
  collisionGapRadius: 0.65,
  selfTrailIgnoreAgeMs: 240,
  turnEffectMs: 110,
  transientEventRetentionMs: 300,
  deathFlashMs: 180,
  roundResolveMs: 520,
  playerMaximumIntegrity: 100,
} as const

export interface SnakeDriveCommand {
  heading: SnakeDirection8
  speedScale: 1 | 0.92
}

export interface SnakeRailVertex {
  position: SnakeVector
  heading: SnakeDirection8
  createdAtMs: number
  expiresAtMs: number
}
```

Add `heading` and `railVertices` to `SnakeActor` and `playerInput` to `ResourceSnakeRoundState`. Expand `SnakeFrameInput` to the following migration-safe shape so this commit remains type-correct while the board and planner are converted in Tasks 4 and 6:

```ts
export interface SnakeFrameInput {
  inputClockMs?: number
  enemyCommands?: Record<string, SnakeDriveCommand>
  playerDirection?: SnakeVector
  playerIntent?: SnakeVector
  enemyDirections?: Record<string, SnakeVector>
}
```

The vector aliases convert to the nearest legal `SnakeDirection8`; a zero vector retains the current heading and never stops an actor. The browser board must stop using these aliases in Task 6, and the final simulation must exercise `playerInput` plus `enemyCommands`.

- [ ] **Step 4: Replace velocity interpolation with direct hard-turn kinematics**

```ts
function advanceActor(
  actor: SnakeActor,
  command: SnakeDriveCommand,
  simulationMs: number,
  stepMs: number,
): SnakeActor {
  const unit = snakeDirectionVector(command.heading)
  const velocity = {
    x: unit.x * actor.maximumSpeedPerSecond * command.speedScale,
    y: unit.y * actor.maximumSpeedPerSecond * command.speedScale,
  }
  const previousPosition = { ...actor.position }
  const position = {
    x: previousPosition.x + velocity.x * stepMs / 1_000,
    y: previousPosition.y + velocity.y * stepMs / 1_000,
  }
  return sampleTrail({
    ...actor,
    heading: command.heading,
    previousPosition,
    position,
    velocity,
  }, simulationMs)
}
```

Before each fixed step, consume no more than one player turn. Use the retained heading if the queue is empty. Use each enemy's retained heading if a command is absent or malformed. Only a controller recovery command may use `0.92`; otherwise force `1`. Append a rail vertex at the pre-movement point when the heading changes, assign the same lifetime as the collision trail, and cap it at 96 without touching collision samples.

Treat `snake-turned` as a transient runtime event: retain it for at most 300 ms and at most 64 entries while leaving round, collision, damage, death, reward, win, defeat, and ready events untouched. This keeps spark/audio projection bounded without weakening reward idempotency.

- [ ] **Step 5: Make deployment enter active state with nonzero velocity immediately**

At the 360 ms boundary, flush the pending chord with the explicit `inputClockMs`, consume the first queued direction or default to `n`, and set player velocity immediately. Initialize enemies heading south at full speed; Task 3 replaces that default with the encounter's explicit `initialHeading`. A state whose `phase === 'active'` must never expose a live actor with speed below `0.92 * maximumSpeedPerSecond - 1e-9`.

- [ ] **Step 6: Update collision/reward fixtures without changing their authority**

Add `heading`, `railVertices`, and `playerInput` only where fixture construction requires them. Preserve all existing expected collision times, damage, reservation outcomes, reward idempotency, frame-partition determinism, and round lifecycle except the intentional 520 ms resolution expectation.

- [ ] **Step 7: Run focused runtime, simulation, and reward suites**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts src/features/resources/resourceSnakeSimulation.test.ts src/features/resources/resourceSnakeRewardBridge.test.ts src/features/resources/ResourceSnakeRewardFlights.test.tsx src/features/resources/useResourceSnakeAudioFeedback.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the runtime kernel**

```bash
git add -- src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts src/features/resources/resourceSnakeSimulation.test.ts src/features/resources/resourceSnakeRewardBridge.test.ts src/features/resources/ResourceSnakeRewardFlights.test.tsx src/features/resources/useResourceSnakeAudioFeedback.test.tsx
git commit -m "feat: make snake runtime an always-moving lightcycle"
```

### Task 3: Doctrine profiles and deterministic encounter foundation

**Files:**
- Create: `src/features/resources/resourceSnakeDoctrine.ts`
- Create: `src/features/resources/resourceSnakeDoctrine.test.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.test.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.test.ts`

**Interfaces:**
- Consumes: successful deposit count, enemy role, and deterministic encounter slot.
- Produces: `SnakeDoctrine`, `SnakeAiPhase`, `SnakeAiReason`, exact `SnakePlannerProfile`, per-enemy speed, doctrine/profile records in `SnakeEncounterResult`.

- [ ] **Step 1: Write failing exact-profile and cyan-only foundation tests**

```ts
describe('resource snake doctrines', () => {
  it('defines exact cyan and red timing tiers inside the approved ranges', () => {
    expect(cyanPlannerProfile(0)).toMatchObject({
      doctrine: 'readable-hunter', planningHz: 10, lookaheadMs: 1_400,
      telegraphMs: 180, commitMs: 260, cruiseMinMs: 80,
      recoverMs: 120, telegraphCooldownMs: 280, emergencySpeedScale: 0.92,
    })
    expect(cyanPlannerProfile(2)).toMatchObject({
      planningHz: 14, lookaheadMs: 2_200, telegraphMs: 160, commitMs: 180,
    })
    expect(redPlannerProfile(0)).toMatchObject({
      doctrine: 'ruthless-duelist', planningHz: 16, lookaheadMs: 1_800,
      telegraphMs: 90, commitMs: 150, cruiseMinMs: 50,
      recoverMs: 80, telegraphCooldownMs: 140, emergencySpeedScale: 0.92,
    })
    expect(redPlannerProfile(2)).toMatchObject({
      planningHz: 20, lookaheadMs: 2_500, telegraphMs: 60, commitMs: 90,
    })
  })

  it('uses approved role speed endpoints', () => {
    expect(snakeDoctrineSpeed('readable-hunter', 'pressure', 0)).toBe(11.6)
    expect(snakeDoctrineSpeed('readable-hunter', 'pressure', 2)).toBe(12.2)
    expect(snakeDoctrineSpeed('readable-hunter', 'blocker', 0)).toBe(11.2)
    expect(snakeDoctrineSpeed('readable-hunter', 'blocker', 2)).toBe(11.8)
    expect(snakeDoctrineSpeed('ruthless-duelist', 'pressure', 0)).toBe(12.4)
    expect(snakeDoctrineSpeed('ruthless-duelist', 'pressure', 2)).toBe(13.2)
    expect(snakeDoctrineSpeed('ruthless-duelist', 'blocker', 0)).toBe(12)
    expect(snakeDoctrineSpeed('ruthless-duelist', 'blocker', 2)).toBe(12.8)
  })
})
```

In `resourceSnakeEncounter.test.ts`, initially assert cyan doctrine for every encounter tier. This is the Round 1 foundation; Task 9 changes the late tier to red, and Task 11 enables mixed tiers.

- [ ] **Step 2: Run doctrine and encounter tests to verify failure**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrine.test.ts src/features/resources/resourceSnakeEncounter.test.ts`

Expected: FAIL because the doctrine module and encounter fields are missing.

- [ ] **Step 3: Implement exact doctrine types and immutable profiles**

```ts
export type SnakeDoctrine = 'readable-hunter' | 'ruthless-duelist'
export type SnakeAiPhase = 'deploy' | 'cruise' | 'telegraph' | 'commit' | 'recover' | 'defeated'
export type SnakeAiReason =
  | 'deployment-complete'
  | 'attack-threshold'
  | 'telegraph-complete'
  | 'commit-complete'
  | 'predicted-fatal-path'
  | 'two-safe-plans'
  | 'actor-defeated'
  | 'profile-fallback'

export interface SnakePlannerProfile {
  doctrine: SnakeDoctrine
  planningHz: 10 | 12 | 14 | 16 | 18 | 20
  lookaheadMs: 1_400 | 1_800 | 2_200 | 2_500
  candidateCount: 48 | 72 | 96
  rolloutStepMs: 50
  cruiseMinMs: 80 | 50
  telegraphMs: 180 | 170 | 160 | 90 | 75 | 60
  commitMs: 260 | 220 | 180 | 150 | 120 | 90
  recoverMs: 120 | 80
  telegraphCooldownMs: 280 | 140
  emergencySpeedScale: 0.92
  responsePathFloor: 1 | 0
  attackWeight: 0.82 | 0.94 | 1.08 | 1.24 | 1.38 | 1.52
  riskReserve: 1.25 | 1.15 | 1.05 | 0.92 | 0.84 | 0.76
}
```

Return fresh profile objects from `cyanPlannerProfile(tier)` and `redPlannerProfile(tier)`. Clamp invalid tiers to `0`. Use the exact timing values asserted above and candidate counts `48, 72, 96` for cyan and `72, 96, 96` for red.

```ts
export function cyanPlannerProfile(tier: number): SnakePlannerProfile
export function redPlannerProfile(tier: number): SnakePlannerProfile
export function snakeDoctrineSpeed(
  doctrine: SnakeDoctrine,
  role: SnakeEnemyRole,
  tier: number,
): number
```

- [ ] **Step 4: Move planner-profile ownership out of the encounter module**

Delete the old `SnakePlannerProfile` declaration and old `DIFFICULTIES` speed/cadence values from `resourceSnakeEncounter.ts`. Add `doctrine?: SnakeDoctrine` and `initialHeading?: SnakeDirection8` to `SnakeEnemySetup`, add `doctrine: SnakeDoctrine | null` to `SnakeActor`, and copy the setup values in `deployResourceSnakeRound()`. Production encounters must always supply both fields; defensive/manual fixtures fall back to cyan and south. Change the result to:

```ts
export interface SnakeEncounterResult {
  setup: SnakeRoundSetup | null
  bag: SnakeShuffleBagState
  disabledReason: 'no-eligible-resource' | null
  plannerProfiles: Record<string, SnakePlannerProfile>
  stage: 0 | 1 | 2 | 3 | 4
}
```

For this round, keep stages 0–1 behaviorally reachable: deposits 0–5 create one cyan pressure enemy; deposits 6 or more create cyan roles according to the existing deterministic one/two-enemy selection. Set player spawn to `{ x: 25, y: 21 }`, enemy initial heading to `s`, and speed through `snakeDoctrineSpeed('readable-hunter', role, tier)`.

- [ ] **Step 5: Verify deterministic reservations did not change**

Keep the shuffle bag, distinct-category selection, block reservation, reward key, hidden-bomb eligibility, and reconciliation assertions byte-equivalent except for the newly added doctrine/profile/speed fields.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrine.test.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeRuntime.test.ts`

Expected: PASS.

```bash
git add -- src/features/resources/resourceSnakeDoctrine.ts src/features/resources/resourceSnakeDoctrine.test.ts src/features/resources/resourceSnakeEncounter.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts
git commit -m "feat: define snake doctrine and encounter profiles"
```

### Task 4: Nonzero eight-direction planner and shared AI state machine

**Files:**
- Create: `src/features/resources/resourceSnakeAiController.ts`
- Create: `src/features/resources/resourceSnakeAiController.test.ts`
- Create: `src/features/resources/resourceSnakePlannerTypes.ts`
- Create: `src/features/resources/resourceSnakeTrajectory.ts`
- Create: `src/features/resources/resourceSnakeTrajectory.test.ts`
- Modify: `src/features/resources/resourceSnakePlanner.ts`
- Modify: `src/features/resources/resourceSnakePlanner.test.ts`
- Modify: `src/features/resources/resourceSnakeScheduling.ts`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `vitest.performance.config.ts`

**Interfaces:**
- Consumes: one `SnakePlannerProfile` per enemy, current/previous snapshots, prior controller states, and planner proposals.
- Produces: eight-direction `SnakePlan`, `ResourceSnakeAiState`, `SnakeDriveCommand`, visible telegraph heading, reason codes, and the earliest next decision time.

- [ ] **Step 1: Write failing controller transition tests**

```ts
function planForControllerTest(
  profile: SnakePlannerProfile,
  direction: SnakeDirection8,
  speedScale: 1 | 0.92 = 1,
  intent: SnakeIntent = 'cutoff',
  plannedAtMs = 1_080,
): SnakePlan {
  const maximumSpeedPerSecond = snakeDoctrineSpeed(profile.doctrine, 'pressure', 0)
  const telegraphSteps = Math.ceil(profile.telegraphMs / 50)
  const commitSteps = Math.ceil(profile.commitMs / 50)
  let position = { x: 25, y: 4 }
  const path = Array.from({ length: telegraphSteps + commitSteps }, (_, index) => {
    const heading = index < telegraphSteps ? 's' : direction
    const unit = snakeDirectionVector(heading)
    position = {
      x: position.x + unit.x * maximumSpeedPerSecond * speedScale * 0.05,
      y: position.y + unit.y * maximumSpeedPerSecond * speedScale * 0.05,
    }
    return { ...position }
  })
  return {
    enemyId: 'enemy-0',
    doctrine: profile.doctrine,
    intent,
    role: 'pressure',
    direction,
    speedScale,
    plannedAtMs,
    commandAtMs: plannedAtMs + profile.telegraphMs,
    stepMs: 50,
    originPosition: { x: 25, y: 4 },
    originHeading: 's',
    originVelocity: { x: 0, y: maximumSpeedPerSecond },
    originMaximumSpeedPerSecond: maximumSpeedPerSecond,
    directions: Array.from({ length: commitSteps }, () => direction),
    commitUntilMs: plannedAtMs + profile.telegraphMs + profile.commitMs,
    path,
    score: {
      survives: 1,
      reachableArea: 240,
      allyClearance: 8,
      playerAreaReduction: 12,
      cutoffProgress: 4,
      pressureDistance: 6,
      steeringCost: 1,
    },
    reservedExitSector: 2,
    candidateIndex: 0,
    evaluatedCandidates: 48,
    elapsedMs: 0,
    fallback: false,
  }
}

describe('resource snake AI controller', () => {
  it('holds cyan telegraph for 160ms and commit for 180ms', () => {
    const profile = cyanPlannerProfile(2)
    const cruise = createResourceSnakeAiState('enemy-0', profile, 1_000, 'cruise')
    const telegraph = advanceResourceSnakeAiController({
      state: cruise, atMs: 1_080, actorPhase: 'active', currentHeading: 's',
      profile, proposal: planForControllerTest(profile, 'e'), fatalCurrentPlan: false,
      safeRecoveryPlan: planForControllerTest(profile, 'sw', 0.92, 'escape'),
      consecutiveSafeRecoveryPlans: 0,
    })
    expect(telegraph.state).toMatchObject({
      phase: 'telegraph', phaseMinimumUntilMs: 1_240, telegraphHeading: 'e',
      reason: 'attack-threshold',
    })
    expect(telegraph.command).toEqual({ heading: 's', speedScale: 1 })
    const committed = advanceResourceSnakeAiController({
      state: telegraph.state, atMs: 1_240, actorPhase: 'active', currentHeading: 's',
      profile, proposal: null, fatalCurrentPlan: false,
      safeRecoveryPlan: planForControllerTest(profile, 'sw', 0.92, 'escape'),
      consecutiveSafeRecoveryPlans: 0,
    })
    expect(committed.state).toMatchObject({
      phase: 'commit', phaseMinimumUntilMs: 1_420, reason: 'telegraph-complete',
    })
    expect(committed.command).toEqual({ heading: 'e', speedScale: 1 })
  })

  it('allows only fatal danger to break commit and never stops in recovery', () => {
    const profile = cyanPlannerProfile(0)
    const committed = {
      ...createResourceSnakeAiState('enemy-0', profile, 2_000, 'commit'),
      phaseMinimumUntilMs: 2_000 + profile.commitMs,
      activePlan: planForControllerTest(profile, 'se', 1, 'cutoff', 2_000),
    }
    expect(advanceResourceSnakeAiController({
      state: committed, atMs: 2_100, actorPhase: 'active', currentHeading: 'se',
      profile, proposal: null, fatalCurrentPlan: false,
      safeRecoveryPlan: planForControllerTest(profile, 'e', 0.92, 'escape', 2_100),
      consecutiveSafeRecoveryPlans: 0,
    }).state.phase).toBe('commit')
    const recovered = advanceResourceSnakeAiController({
      state: committed, atMs: 2_100, actorPhase: 'active', currentHeading: 'se',
      profile, proposal: null, fatalCurrentPlan: true,
      safeRecoveryPlan: planForControllerTest(profile, 'e', 0.92, 'escape', 2_100),
      consecutiveSafeRecoveryPlans: 0,
    })
    expect(recovered.state.phase).toBe('recover')
    expect(recovered.command).toEqual({ heading: 'e', speedScale: 0.92 })
  })
})
```

- [ ] **Step 2: Add failing trajectory/planner assertions for discrete headings and nonzero fallback**

In `resourceSnakeTrajectory.test.ts`, assert that every generated candidate direction is in the eight-heading set, all normal candidates use speed 1, a direct reverse is not generated as the first command, a sampled plan holds `originHeading` through the telegraph prefix, and returned nested buffers cannot mutate a sibling/cache result. In the planner test, assert malformed-snapshot fallback selects the maximum-clearance legal heading at `0.92` rather than `{x: 0, y: 0}`.

Replace `SnakePlayerHypotheses` with:

```ts
export interface SnakePlayerHypotheses {
  straight: SnakeDirection8[]
  recentLeft: SnakeDirection8[]
  recentRight: SnakeDirection8[]
  all: SnakeDirection8[][]
}

export interface SnakeTrajectoryCandidate {
  candidateIndex: number
  speedScale: 1 | 0.92
  directions: SnakeDirection8[]
  path: SnakeVector[]
}

export interface SnakePlan {
  enemyId: SnakeId
  doctrine: SnakeDoctrine
  intent: SnakeIntent
  role: SnakeEnemyRole
  direction: SnakeDirection8
  speedScale: 1 | 0.92
  plannedAtMs: number
  commandAtMs: number
  stepMs: 50
  originPosition: SnakeVector
  originHeading: SnakeDirection8
  originVelocity: SnakeVector
  originMaximumSpeedPerSecond: number
  directions: SnakeDirection8[]
  commitUntilMs: number
  path: SnakeVector[]
  score: SnakePlanScore
  reservedExitSector: number
  candidateIndex: number
  evaluatedCandidates: number
  elapsedMs: number
  fallback: boolean
}

export interface SnakePlanSample {
  atMs: number
  cursor: number
  direction: SnakeDirection8
  speedScale: 1 | 0.92
  position: SnakeVector
  velocity: SnakeVector
}
```

- [ ] **Step 3: Run controller and planner suites and verify failures**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeTrajectory.test.ts src/features/resources/resourceSnakePlanner.test.ts`

Expected: FAIL on the missing controller, old continuous directions, and zero/half-speed candidates.

- [ ] **Step 4: Implement the controller state shape and complete transition table**

```ts
export interface ResourceSnakeAiState {
  enemyId: SnakeId
  doctrine: SnakeDoctrine
  role: SnakeEnemyRole
  phase: SnakeAiPhase
  phaseStartedAtMs: number
  phaseMinimumUntilMs: number
  telegraphCooldownUntilMs: number
  telegraphHeading: SnakeDirection8 | null
  pendingPlan: SnakePlan | null
  activePlan: SnakePlan | null
  consecutiveSafeRecoveryPlans: number
  reason: SnakeAiReason
  nextPlanningAtMs: number
}

export interface ResourceSnakeAiTransition {
  state: ResourceSnakeAiState
  command: SnakeDriveCommand
  emitted: 'telegraph-started' | 'commit-started' | 'recovery-started' | null
  nextDecisionAtMs: number
}

export interface ResourceSnakeAiTransitionInput {
  state: ResourceSnakeAiState
  atMs: number
  actorPhase: SnakeActorPhase
  currentHeading: SnakeDirection8
  profile: SnakePlannerProfile
  proposal: SnakePlan | null
  fatalCurrentPlan: boolean
  safeRecoveryPlan: SnakePlan
  consecutiveSafeRecoveryPlans: number
}

export function createResourceSnakeAiState(
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  atMs: number,
  phase: SnakeAiPhase = 'deploy',
  role: SnakeEnemyRole = 'pressure',
): ResourceSnakeAiState

export function advanceResourceSnakeAiController(
  input: ResourceSnakeAiTransitionInput,
): ResourceSnakeAiTransition
```

Implement all six phases from the spec. `telegraph` retains current heading and exposes only `telegraphHeading`; `commit` drives the pending plan; `recover` drives the safest recovery plan at `0.92`; two consecutive safe planning boundaries are required to leave recovery. Defeat clears plans and returns the actor's retained heading with no future planning. Clamp every returned deadline to a finite timestamp.

- [ ] **Step 5: Extract trajectory ownership and replace continuous rollout templates with eight-direction sequences**

Move the public planner interfaces from the top of the existing file into `resourceSnakePlannerTypes.ts`. Move candidate-template caches, rollout, plan sampling, future sampling, committed-path conversion, and committed-path sampling from the 6,000-line planner into `resourceSnakeTrajectory.ts`. Planner, trajectory, and controller import types from the new type-only module. Keep the current export names by re-exporting types and trajectory functions from `resourceSnakePlanner.ts` during this task, so the board and existing imports remain coherent and no runtime import cycle is introduced.

Remove `RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND`, acceleration/deceleration rollout, `SPEED_SCALES = [1, 0.5, 0]`, and stopped/decelerating player hypotheses. Generate deterministic sequences from `legalSnakeTurns(currentHeading)`, ordered by heading delta and then direction ordinal. Roll out each segment with direct constant-speed motion:

```ts
const unit = snakeDirectionVector(direction)
position = {
  x: position.x + unit.x * actor.maximumSpeedPerSecond * speedScale * stepMs / 1_000,
  y: position.y + unit.y * actor.maximumSpeedPerSecond * speedScale * stepMs / 1_000,
}
```

Use `speedScale: 1` for normal candidates. Generate `0.92` only inside the recovery/fallback path. Preserve boundary, self-trail, player-trail, ally swept path, reachable-area, endpoint, exit-sector, deterministic ordering, hostile-input sanitization, cache bounds, and external timing measurement.

For an attack proposal, set `commandAtMs = plannedAtMs + profile.telegraphMs` and `commitUntilMs = commandAtMs + profile.commitMs`. Roll out the retained `originHeading` from `plannedAtMs` to `commandAtMs`, then the advertised attack headings. `sampleResourceSnakePlan()` must return `originHeading` before `commandAtMs` and the planned attack heading after it. This makes the core telegraph, actual turn point, swept occupancy, and commit path describe the same future position instead of letting the actor drift during telegraph.

- [ ] **Step 6: Change planner/group signatures to per-enemy profiles**

```ts
export function planResourceSnakeGroup(
  snapshot: SnakePlannerSnapshot,
  profiles: Readonly<Record<string, SnakePlannerProfile>>,
  previousPlans: readonly SnakePlan[],
  timingHistoryMs: readonly number[],
  dueEnemyIds: ReadonlySet<SnakeId>,
): SnakeGroupPlan
```

Each returned plan carries `doctrine`, `direction: SnakeDirection8`, `speedScale: 1 | 0.92`, `reservedExitSector: number`, and the same serializable timing/path fields. Add discrete `heading: SnakeDirection8` and `doctrine: SnakeDoctrine | null` to `SnakePlannerActor`; update the existing `actor()`, `plannerActorFromRuntime()`, `snapshot()`, and `dualSnapshot()` test builders to populate them. Copy each group-assigned role into its controller state so presentation and diagnostics reflect reassignment without mutating the saved campaign. Replan only ids in `dueEnemyIds`; retain a still-safe prior plan object for every non-due enemy and inject that commitment as occupancy. This prevents a 20 Hz red cadence from silently making cyan replan faster than 14 Hz. Retain byte-equivalent output for identical snapshot/profile/history/due-id input. Continue planning pressure before blocker and injecting the first executable commitment into ally occupancy.

Update `advanceRuntimeWithPlan()` in the planner tests to pass sampled `SnakeDriveCommand` through `enemyCommands` and an explicit `inputClockMs`; it must no longer multiply vector directions by a speed scale at the caller.

- [ ] **Step 7: Schedule against AI deadlines as well as cadence and plan expiry**

```ts
export function nextResourceSnakePlanningAtMs(
  simulationMs: number,
  plans: readonly { commitUntilMs: number }[],
  controllers: readonly { nextPlanningAtMs: number }[],
): number
```

Each controller sets `nextPlanningAtMs` to the minimum of its own `atMs + 1_000 / profile.planningHz`, phase minimum, relevant telegraph cooldown, and active-plan expiry. Return the minimum finite time that is not earlier than `simulationMs` among controller deadlines and plan expiries. At that time, the board builds `dueEnemyIds` from controllers whose deadline is reached.

- [ ] **Step 8: Run planner correctness and single-worker performance acceptance**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeTrajectory.test.ts src/features/resources/resourceSnakePlanner.test.ts`

Run: `pnpm exec vitest run src/features/resources/ResourceSnakeBoard.test.tsx -t "schedules a fresh decision"`

Expected: PASS.

Run: `pnpm test:performance`

Expected: PASS with worst external p95 ≤ 3 ms and no zero-speed fallback.

- [ ] **Step 9: Commit the shared planning engine**

```bash
git add -- src/features/resources/resourceSnakeAiController.ts src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakePlannerTypes.ts src/features/resources/resourceSnakeTrajectory.ts src/features/resources/resourceSnakeTrajectory.test.ts src/features/resources/resourceSnakePlanner.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeScheduling.ts src/features/resources/ResourceSnakeBoard.test.tsx vitest.performance.config.ts
git commit -m "feat: add nonzero lightcycle AI state machine"
```

### Task 5: Continuous rails, angular cores, and industrial Canvas scene

**Files:**
- Create: `src/features/signals/signalLanguage.ts`
- Create: `src/features/signals/signalLanguage.test.ts`
- Create: `src/features/resources/resourceSnakeCanvas.ts`
- Modify: `src/features/resources/resourceSnakePresentation.ts`
- Modify: `src/features/resources/resourceSnakePresentation.test.ts`
- Modify: `src/styles/resource-snake.css`

**Interfaces:**
- Consumes: runtime actors/rail vertices, AI controller state, reduced-motion flag, and acquired resource category.
- Produces: a pure scene of continuous rails, oriented core silhouettes, glyphs, telegraphs, bounded effects, and a Canvas renderer with no gameplay authority.

- [ ] **Step 1: Write failing orthogonal-language and scene-shape tests**

```ts
function railPresentationRuntime(): ResourceSnakeRoundState {
  const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
    roundId: 'rail-scene',
    playerSpawn: { x: 25, y: 21 },
    enemies: [],
  })
  return {
    ...deployed,
    phase: 'active',
    simulationMs: 1_000,
    player: {
      ...deployed.player,
      phase: 'active',
      previousPosition: { x: 30.9, y: 16 },
      position: { x: 31, y: 16 },
      heading: 'e',
      velocity: { x: 12, y: 0 },
      trail: [{
        id: 1,
        position: { x: 25, y: 21 },
        spawnedAtMs: 500,
        expiresAtMs: 10_500,
      }],
      railVertices: [{
        position: { x: 25, y: 16 },
        heading: 'e',
        createdAtMs: 750,
        expiresAtMs: 10_750,
      }],
    },
  }
}

function effectPresentationRuntime(): ResourceSnakeRoundState {
  const runtime = railPresentationRuntime()
  return {
    ...runtime,
    events: [
      ...Array.from({ length: 40 }, (_, index) => ({
        id: index + 1,
        type: 'snake-turned' as const,
        actorId: 'player' as const,
        point: { x: 25 + index * 0.01, y: 16 },
        from: 'n' as const,
        to: 'e' as const,
        startedAtMs: 950,
      })),
      {
        id: 41,
        type: 'snake-collided' as const,
        actorIds: ['player' as const],
        point: { x: 31, y: 16 },
        hitStopMs: 90 as const,
        startedAtMs: 950,
      },
      {
        id: 42,
        type: 'snake-died' as const,
        actorId: 'player' as const,
        category: null,
        startedAtMs: 950,
      },
    ],
  }
}

it('keeps doctrine color, role silhouette, and resource glyph independent', () => {
  expect(signalIdentity({ doctrine: 'readable-hunter', role: 'blocker', category: 'memory' }))
    .toEqual({ color: '#36e7f2', silhouette: 'blocker-diamond', glyph: 'parallel-lines' })
  expect(signalIdentity({ doctrine: 'ruthless-duelist', role: 'pressure', category: 'memory' }))
    .toEqual({ color: '#ff365f', silhouette: 'pressure-chevron', glyph: 'parallel-lines' })
})

it('projects one continuous rail and an oriented angular core instead of dots', () => {
  const scene = buildResourceSnakeScene(railPresentationRuntime(), {}, null, false)
  expect(scene).not.toHaveProperty('trailDots')
  expect(scene.rails[0]).toMatchObject({ ownerId: 'player', color: '#dff8ff' })
  expect(scene.rails[0].points).toEqual([
    { x: 25, y: 21 }, { x: 25, y: 16 }, { x: 31, y: 16 },
  ])
  expect(scene.actors[0]).toMatchObject({
    silhouette: 'player-dart', headingRadians: 0, glyph: null,
  })
})

it('bounds every effect list and removes motion-only effects when reduced', () => {
  const full = buildResourceSnakeScene(effectPresentationRuntime(), {}, null, false)
  expect(full.cornerSparks.length).toBeLessThanOrEqual(24)
  expect(full.fragments.length).toBeLessThanOrEqual(32)
  expect(full.arcs.length).toBeLessThanOrEqual(8)
  expect(full.powerCuts.length).toBeLessThanOrEqual(18)
  const reduced = buildResourceSnakeScene(effectPresentationRuntime(), {}, null, true)
  expect(reduced.cornerSparks).toEqual([])
  expect(reduced.fragments).toEqual([])
})
```

- [ ] **Step 2: Run signal-language and presentation tests to verify failure**

Run: `pnpm exec vitest run src/features/signals/signalLanguage.test.ts src/features/resources/resourceSnakePresentation.test.ts`

Expected: FAIL on missing signal language and the old `trailDots`/circle scene.

- [ ] **Step 3: Implement shared visual semantics**

```ts
export const SNAKE_DOCTRINE_COLORS = {
  'readable-hunter': '#36e7f2',
  'ruthless-duelist': '#ff365f',
} as const

export const RESOURCE_SIGNAL_GLYPHS = {
  reasoning: 'triangle-notch',
  memory: 'parallel-lines',
  fluency: 'trident-pulse',
} as const

export const SNAKE_ROLE_SILHOUETTES = {
  pressure: 'pressure-chevron',
  blocker: 'blocker-diamond',
} as const

export const SIGNAL_CHANNEL_COLORS = {
  SYSTEM: '#dff8ff',
  COMBAT: '#ffffff',
  HACK: '#8fffe1',
  SUPERVISOR: '#ff5a6f',
} as const

export function signalIdentity(input: {
  doctrine: SnakeDoctrine
  role: SnakeEnemyRole
  category: CompanyCategory
}): {
  color: string
  silhouette: 'pressure-chevron' | 'blocker-diamond'
  glyph: 'triangle-notch' | 'parallel-lines' | 'trident-pulse'
}
```

`signalIdentity()` must combine these tables without deriving any one dimension from another.

- [ ] **Step 4: Replace scene dots with exact rail/core models**

```ts
export interface ResourceSnakeSceneRail {
  ownerId: SnakeId
  color: string
  points: SnakeVector[]
  opacity: number
  terminalBreakProgress: number
}

export interface ResourceSnakeSceneActor {
  id: SnakeId
  x: number
  y: number
  headingRadians: number
  color: string
  silhouette: 'player-dart' | 'pressure-chevron' | 'blocker-diamond'
  glyph: 'triangle-notch' | 'parallel-lines' | 'trident-pulse' | null
  powerRatio: number
  phase: SnakeActor['phase']
  telegraph: { headingRadians: number; progress: number } | null
}

export interface ResourceSnakeSceneSpark {
  x: number
  y: number
  angleRadians: number
  color: string
  progress: number
}

export interface ResourceSnakeSceneFragment {
  x: number
  y: number
  offsetX: number
  offsetY: number
  rotationRadians: number
  color: string
  progress: number
}

export interface ResourceSnakeSceneArc {
  from: SnakeVector
  to: SnakeVector
  color: string
  progress: number
}

export interface ResourceSnakeScenePowerCut {
  point: SnakeVector
  color: string
  progress: number
}

export interface ResourceSnakeScene {
  background: {
    color: '#020609'
    sectorColumns: 10
    sectorRows: 6
    dangerEdges: Array<'top' | 'right' | 'bottom' | 'left'>
  }
  rails: ResourceSnakeSceneRail[]
  actors: ResourceSnakeSceneActor[]
  collisionFlashes: ResourceSnakeSceneFlash[]
  cornerSparks: ResourceSnakeSceneSpark[]
  fragments: ResourceSnakeSceneFragment[]
  arcs: ResourceSnakeSceneArc[]
  powerCuts: ResourceSnakeScenePowerCut[]
}
```

Build rail points from the oldest live collision-trail point, all live exact `railVertices`, and the current head. Remove collinear middle points using an epsilon of `1e-6`; never round 45°/90° corners. Keep terminal fade continuous and apply circuit-break styling only to the oldest short segment.

Update every presentation-test runtime advance to pass `inputClockMs` and queued input/enemy commands; do not retain an old stop-vector fixture in this suite.

Choose enemy silhouette from `controllerStates[actor.id]?.role ?? actor.role`; this ensures a surviving blocker that becomes pressure at a legal group boundary changes shape in the same scene update.

The player core and rail remain white/blue-white even while a reward category is in flight. Enemy core and rail color come only from doctrine. Resource category affects only the inner glyph and the existing reward-flight particle semantics.

Derive `dangerEdges` only when an active head is projected to reach that boundary within 350 ms at its current heading. Derive directional shake from the contact point toward the struck actor's separated position, cap it at three pixels and 180 ms, and return zero under reduced motion.

- [ ] **Step 5: Implement the Canvas renderer in a separate file**

`drawResourceSnakeScene(context, scene, width, height)` must:

1. Clear and fill `#020609`.
2. Draw ten-by-six sector seams, coordinate ticks, corner isolation marks, and a four-level-darker boundary frame; pulse only the `dangerEdges` entries.
3. Draw every rail as three paths with `lineCap = 'butt'`, `lineJoin = 'miter'`: outer glow, doctrine midline, white-blue inner power line.
4. Draw local-space polygon vertices for `player-dart`, `pressure-chevron`, and `blocker-diamond`, rotated by `headingRadians`; use `powerRatio` to break the inner power trace and increase bounded core flicker without desaturating doctrine color.
5. Draw category glyphs inside enemy cores without changing core color.
6. Draw telegraph guides before fragments so intent stays readable.
7. Cap and clean every effect list exactly as the scene tests require.
8. Restore every modified Canvas state with `save()`/`restore()` and never mutate the scene.
9. Cache core/glyph `Path2D` objects and static gradients by size/color; reuse bounded point/effect buffers instead of allocating an unbounded path or gradient set per frame.

- [ ] **Step 6: Replace insect-like CSS presentation**

Use an arena isolation frame with chamfered corners, a graphite interior, low-opacity cyan edge energy, and a focus outline outside the collision area. Keep the Canvas at its existing responsive aspect ratio. Remove CSS assumptions tied to round dots. Under `prefers-reduced-motion: reduce`, disable frame pulse and deployment shimmer while preserving contrast.

- [ ] **Step 7: Run scene tests, typecheck, and lint**

Run: `pnpm exec vitest run src/features/signals/signalLanguage.test.ts src/features/resources/resourceSnakePresentation.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 8: Commit the visual foundation**

```bash
git add -- src/features/signals/signalLanguage.ts src/features/signals/signalLanguage.test.ts src/features/resources/resourceSnakeCanvas.ts src/features/resources/resourceSnakePresentation.ts src/features/resources/resourceSnakePresentation.test.ts src/styles/resource-snake.css
git commit -m "feat: render industrial lightcycle rails and cores"
```

### Task 6: Board integration, input diagnostics, and Round 1 regression gate

**Files:**
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.test.ts`
- Modify: `src/features/resources/resourceSnakeSimulation.test.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.test.ts`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: browser key edges, encounter profiles, planner proposals, controller transitions, runtime events, and pure scene output.
- Produces: one integrated lightcycle RAF loop, a doctrine-rich diagnostic snapshot, and monotonic presentation feedback without changing campaign state.

- [ ] **Step 1: Write failing component tests for deployment input, queue retention, and always-moving audio**

```ts
let boardFrameNow = 0

interface BoardSnapshot {
  player: {
    heading: SnakeDirection8
    velocity: SnakeVector
  }
  input: ResourceSnakeInputState
}

function installBoardFakeRaf(): void {
  vi.useFakeTimers()
  boardFrameNow = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
    window.setTimeout(() => {
      boardFrameNow += 16
      callback(boardFrameNow)
    }, 16)
  ))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
}

function renderBoardWithFakeRaf(seed: string, withSuspension = false): void {
  installBoardFakeRaf()
  render(
    <GameProvider storage={new MemoryStorage()} initialSeed={seed}>
      <ResourceSnakeBoard />
      {withSuspension ? <SuspensionControl /> : null}
    </GameProvider>,
  )
}

function readBoardSnapshot() {
  const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
  return JSON.parse(canvas.getAttribute('data-snake-snapshot') ?? '{}') as BoardSnapshot
}

function advanceRaf(ms: number): void {
  act(() => vi.advanceTimersByTime(ms))
}

function startAndAdvanceToActive(): void {
  fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
  advanceRaf(380)
}

function dispatchTimedKey(type: 'keydown' | 'keyup', key: string, timeStamp: number): void {
  const event = new KeyboardEvent(type, { key, bubbles: true })
  Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp })
  fireEvent(window, event)
}

function tapKey(key: 'w' | 'a' | 's' | 'd', timeStamp: number): void {
  dispatchTimedKey('keydown', key, timeStamp)
  dispatchTimedKey('keyup', key, timeStamp + 1)
}

it('reserves a deployment chord and consumes one turn per fixed step', () => {
  renderBoardWithFakeRaf('board-deployment-chord')
  fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
  dispatchTimedKey('keydown', 'w', 100)
  dispatchTimedKey('keydown', 'd', 112)
  advanceRaf(380)
  const snapshot = readBoardSnapshot()
  expect(snapshot.player.heading).toBe('ne')
  expect(Math.hypot(snapshot.player.velocity.x, snapshot.player.velocity.y)).toBeCloseTo(12, 2)
})

it('preserves confirmed queued turns while suspended and clears held edges', () => {
  renderBoardWithFakeRaf('board-input-suspension', true)
  startAndAdvanceToActive()
  tapKey('d', 1_000)
  tapKey('s', 1_040)
  tapKey('w', 1_065)
  fireEvent.click(screen.getByRole('button', { name: '정지' }))
  expect(readBoardSnapshot().input).toMatchObject({ queued: ['e', 's'], pressedKeys: [] })
})

it('runs movement hum for the whole active round rather than only while a key is held', () => {
  renderBoardWithFakeRaf('board-active-hum')
  startAndAdvanceToActive()
  expect(startGameSoundLoop).toHaveBeenCalledWith('movement-hum')
  expect(stopGameSoundLoop).not.toHaveBeenCalledWith('movement-hum')
})
```

- [ ] **Step 2: Run board/audio tests to confirm failure**

Run: `pnpm exec vitest run src/features/resources/ResourceSnakeBoard.test.tsx src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/audio/audioEngine.test.ts src/app/App.test.tsx`

Expected: FAIL because the board still tracks held vectors and imports Canvas draw from the old module.

- [ ] **Step 3: Replace held-vector input with edge-driven pure state updates**

On `keydown`, ignore editing targets, modifiers, idle phase, runtime suspension, and unrelated keys; call `preventDefault()` for accepted movement keys. Normalize `event.timeStamp` onto the `performance.now()` clock: use it when finite and within 60,000 ms of `performance.now()`, otherwise use `performance.now()`. Pass that timestamp and `event.repeat` to `pressResourceSnakeKey()`. Commit the returned input state to `runtimeRef.current.playerInput`. On `keyup`, call `releaseResourceSnakeKey()`. On blur, modal suspension, or unmount, call only `clearResourceSnakePressedKeys()`.

Do not use `movementDirection()` or derive a vector from currently held keys.

After the board conversion, run `rg -n "playerDirection|playerIntent|enemyDirections" src/features/resources`. Convert every remaining runtime test/simulation call to `playerInput` or `enemyCommands`, then delete the three migration aliases from `SnakeFrameInput` and make `inputClockMs` required. The production runtime API must no longer expose a path that bypasses the turn queue.

- [ ] **Step 4: Integrate per-enemy planner profiles and controllers**

Maintain refs for `profiles`, `plans`, `controllers`, `roles`, player history, timing history, and next planning time. At a planning boundary:

1. Build the existing serializable snapshot, now including doctrine and discrete heading.
2. Build `dueEnemyIds` from controller `nextPlanningAtMs` values and generate group proposals only for those ids with per-enemy profiles; retain other safe commitments as occupancy.
3. Advance every controller with its proposal and fatal-path result.
4. Store telegraph/commit/recover states.
5. Pass sampled `SnakeDriveCommand` objects into the runtime.
6. Schedule the earliest cadence, phase deadline, cooldown, or plan expiry.

No controller may read DOM, key state, Canvas pixels, or future input.

- [ ] **Step 5: Replace scene draw and publish stable diagnostics**

Import `drawResourceSnakeScene` from `resourceSnakeCanvas.ts`. Change diagnostics to:

```tsx
data-combat-loop="lightcycle-8way"
data-field-rendering="continuous-rail"
data-grid="industrial-sector"
data-enemy-planner="doctrine-state-machine"
data-player-heading={runtime.player.heading}
data-input-queue={runtime.playerInput.queued.join(',')}
data-doctrines={runtime.enemies.map((enemy) => enemy.doctrine).join(',')}
data-ai-phases={runtime.enemies.map((enemy) => controllersRef.current[enemy.id]?.phase ?? 'deploy').join(',')}
```

Add heading, doctrine, AI phase, telegraph heading, speed magnitude, rail vertex count, and bounded recent events to `data-snake-snapshot`. Keep reservation ids and reward keys for E2E verification.

- [ ] **Step 6: Update baseline sound behavior**

Use this ephemeral, non-authoritative contract in the board/audio hook:

```ts
export interface ResourceSnakePresentationFeedback {
  sequence: number
  kind: 'input-queued' | 'input-rejected' | 'telegraph-cyan' | 'telegraph-red'
  actorId: SnakeId
}

export function useResourceSnakeAudioFeedback(
  runtime: ResourceSnakeRoundState,
  feedback: ResourceSnakePresentationFeedback | null,
  runtimeSuspended: boolean,
): void
```

Increment `sequence` only for a new key outcome or controller `emitted` transition. Keep one `movement-hum` loop active whenever the round is active and not suspended. Add short `snake-turn-queued`, `snake-turn`, and `snake-turn-rejected` recipes. Consume feedback sequence and `snake-turned` event id exactly once. Audio exceptions must remain presentation-only and must not change runtime/controller state.

- [ ] **Step 7: Run the complete Round 1 regression gate**

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm exec vitest run src/features/resources src/audio/audioEngine.test.ts src/app/App.test.tsx`

Run: `pnpm test:performance`

Run: `pnpm build`

Expected: all commands PASS. Do not start a user-facing local preview in Round 1.

- [ ] **Step 8: Commit Round 1 integration**

```bash
git add -- src/features/resources/ResourceSnakeBoard.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts src/features/resources/resourceSnakeSimulation.test.ts src/features/resources/useResourceSnakeAudioFeedback.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/audio/gameSounds.ts src/audio/audioEngine.test.ts src/app/App.test.tsx
git commit -m "feat: integrate shared lightcycle combat foundation"
```

---

## Round 2 — Cyan `readable-hunter`

### Task 7: Readable cyan attack logic, roles, and telegraph fairness

**Files:**
- Modify: `src/features/resources/resourceSnakePlannerTypes.ts`
- Modify: `src/features/resources/resourceSnakePlanner.ts`
- Modify: `src/features/resources/resourceSnakePlanner.test.ts`
- Modify: `src/features/resources/resourceSnakeAiController.ts`
- Modify: `src/features/resources/resourceSnakeAiController.test.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.test.ts`
- Create: `src/features/resources/resourceSnakeDoctrineSimulation.test.ts`

**Interfaces:**
- Consumes: cyan profile, straight/left/right player hypotheses, role, reachable exits, intersection times, and existing group reservations.
- Produces: readable telegraphed attacks that preserve at least one pre-existing response path, plus distinct pressure/blocker plans.

The simulation test owns this local contract, reused by Tasks 9 and 11:

```ts
const DETERMINISTIC_PLAYER_POLICIES = [
  'straight',
  'clockwise',
  'counter-clockwise',
  'alternating',
  'space-maximizer',
] as const

type DoctrineSimulationStage =
  | 'cyan-single'
  | 'cyan-dual'
  | 'red-single'
  | 'mixed'
  | 'mixed-maximum'

interface DoctrineSimulationOptions {
  stages: readonly DoctrineSimulationStage[]
  policies: typeof DETERMINISTIC_PLAYER_POLICIES
  seeds: 400
}

interface DoctrineSimulationReport {
  caseCount: number
  stageCounts: Partial<Record<DoctrineSimulationStage, number>>
  unforcedBoundaryDeaths: number
  unforcedSelfDeaths: number
  allyCollisions: number
  duplicateRoleReservations: number
  zeroSpeedFrames: number
  missingCommitments: number
  responsePathViolations: number
  futureInputReads: number
  collisionRuleBypasses: number
  predictedSuicides: number
  fallbacks: number
  meanBranchClosureMs: number
  worstExternalP95Ms: number
}

type RunDoctrineSimulation = (
  options: DoctrineSimulationOptions,
) => DoctrineSimulationReport
```

Implement `const runDoctrineSimulation: RunDoctrineSimulation` in Step 7 with the real public encounter, runtime, planner, controller, and scheduler APIs; do not mock those boundaries.

- [ ] **Step 1: Write failing cyan scoring and fairness tests**

```ts
it('prefers a survivable future intersection over direct head pursuit', () => {
  const fixture = snapshot({
    simulationMs: 1_000,
    player: actor('player', { x: 25, y: 12 }, { x: 12, y: 0 }, {
      heading: 'e', maximumSpeedPerSecond: 12,
    }),
    enemies: [actor('enemy-0', { x: 25, y: 4 }, { x: 0, y: 11.6 }, {
      heading: 's', doctrine: 'readable-hunter', maximumSpeedPerSecond: 11.6,
    })],
  })
  const plan = planResourceSnakeEnemy(fixture, cyanPlannerProfile(1), null)
  expect(plan.intent).toBe('cutoff')
  expect(plan.score.intersectionLeadMs).toBeGreaterThan(0)
  expect(plan.score.selfEscapeBranches).toBeGreaterThan(0)
})

it('does not erase the last response path created before cyan telegraph', () => {
  const fixture = snapshot({
    simulationMs: 1_000,
    player: actor('player', { x: 25, y: 12 }, { x: 12, y: 0 }, {
      heading: 'e', maximumSpeedPerSecond: 12,
    }),
    enemies: [actor('enemy-0', { x: 34, y: 12 }, { x: 0, y: 12.2 }, {
      heading: 's', doctrine: 'readable-hunter', maximumSpeedPerSecond: 12.2,
    })],
    trailDots: [
      ...horizontalTrailWall(8, 20, 40, 20_000),
      ...horizontalTrailWall(16, 20, 40, 20_000),
      ...trailWall(40, 8, 16, 20_000, (y) => y >= 11.5 && y <= 12.5),
    ],
  })
  const plan = planResourceSnakeEnemy(fixture, cyanPlannerProfile(2), null)
  expect(plan.score.playerResponsePathsBefore).toBe(1)
  expect(plan.score.playerResponsePathsAfter).toBeGreaterThanOrEqual(1)
})

it('reserves distinct endpoint and exit sector for cyan pressure and blocker', () => {
  const group = planResourceSnakeGroup(
    dualSnapshot(),
    {
      'enemy-0': cyanPlannerProfile(1),
      'enemy-1': cyanPlannerProfile(1),
    },
    [],
    [],
    new Set<SnakeId>(['enemy-0', 'enemy-1']),
  )
  expect(group.plans.map((plan) => plan.role)).toEqual(['pressure', 'blocker'])
  expect(new Set(group.plans.map((plan) => plan.reservedExitSector)).size).toBe(2)
  const pressureEnd = group.plans[0].path.at(-1)!
  const blockerEnd = group.plans[1].path.at(-1)!
  expect(Math.hypot(pressureEnd.x - blockerEnd.x, pressureEnd.y - blockerEnd.y))
    .toBeGreaterThanOrEqual(1.2)
})
```

- [ ] **Step 2: Write failing cyan simulation acceptance for 4,000 cases**

Implement deterministic policies named `straight`, `clockwise`, `counter-clockwise`, `alternating`, and `space-maximizer`. For cyan-single and cyan-dual stages, run 400 seeds per policy and assert:

```ts
expect(report.caseCount).toBe(4_000)
expect(report.unforcedBoundaryDeaths).toBe(0)
expect(report.unforcedSelfDeaths).toBe(0)
expect(report.allyCollisions).toBe(0)
expect(report.zeroSpeedFrames).toBe(0)
expect(report.missingCommitments).toBe(0)
expect(report.responsePathViolations).toBe(0)
expect(report.fallbacks).toBe(0)
expect(report.worstExternalP95Ms).toBeLessThanOrEqual(3)
```

- [ ] **Step 3: Run cyan planner/controller/simulation tests and verify failure**

Run: `pnpm exec vitest run src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeDoctrineSimulation.test.ts`

Expected: FAIL on missing cyan score fields, response-path rule, and simulation report.

- [ ] **Step 4: Add doctrine-aware score evidence without changing collision rules**

Extend `SnakePlanScore` with exact evidence fields:

```ts
export interface SnakePlanScore {
  survives: 0 | 1
  reachableArea: number
  allyClearance: number
  playerAreaReduction: number
  intersectionLeadMs: number
  playerResponsePathsBefore: number
  playerResponsePathsAfter: number
  selfEscapeBranches: number
  reservedExitSector: number
  steeringCost: number
  recentTurnBiasExploit: number
}
```

Update every plan fixture, including `planForControllerTest()` in `resourceSnakeAiController.test.ts`, to supply these exact fields and delete the superseded `cutoffProgress` and `pressureDistance` fields.

For cyan, compare in this order: survival, at least one self escape, response-path floor, reachable area, ally clearance, future intersection lead, player area reduction, steering cost, candidate index. Reject an attack candidate that changes `playerResponsePathsBefore > 0` to `playerResponsePathsAfter === 0` during its advertised telegraph/commit window.

- [ ] **Step 5: Implement role-specific cyan intent**

Pressure targets the earliest survivable intersection ahead of the player's safe-region centroid. Blocker targets the narrowest reachable exit not reserved by pressure. Neither role may select a predicted fatal path while a safe candidate exists. Keep cyan telegraph stable unless the selected path becomes fatal; do not retarget merely because a higher-scoring attack appears during the 160–180 ms telegraph.

- [ ] **Step 6: Finish cyan encounter progression for the checkpoint**

Use deposits 0–5 for one cyan pressure enemy and deposits 6 or more for cyan pressure/blocker according to deterministic candidate availability. Keep every later stage cyan in this round so the user can evaluate one doctrine without red contamination.

- [ ] **Step 7: Implement and run the deterministic cyan simulation**

The harness must drive the same public runtime, planner, controller, scheduling, and encounter functions as the board. It may inspect serializable diagnostic results but must not alter planner decisions with measured timings. Record forced versus unforced collision classification, telegraph response counts, plan duration samples, and maximum retained arrays.

For each `(stage, policy, seed)` tuple, create the exact stage encounter, deploy through four frame partitions of at most 100 ms, advance fixed simulation for at most 30,000 ms, enqueue policy turns only through `pressResourceSnakeKey()`/`flushResourceSnakeChord()`, invoke the real planner only at `nextResourceSnakePlanningAtMs()` with the exact due-enemy set, advance real controllers, and feed only their `SnakeDriveCommand` values to the runtime. Classify a collision as forced only when an independent eight-heading clearance check finds no survivable heading at the prior planning boundary. Sort measured planner durations, take index `ceil(n * 0.95) - 1`, and never feed that duration back into the chosen plan.

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrineSimulation.test.ts --testTimeout=120000`

Expected: PASS with exactly 4,000 cases and every gate above.

- [ ] **Step 8: Run focused correctness and performance suites, then commit**

Run: `pnpm exec vitest run src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeEncounter.test.ts`

Run: `pnpm test:performance`

Expected: PASS.

```bash
git add -- src/features/resources/resourceSnakePlannerTypes.ts src/features/resources/resourceSnakePlanner.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.ts src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeEncounter.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeDoctrineSimulation.test.ts
git commit -m "feat: add readable cyan hunter doctrine"
```

### Task 8: Cyan browser acceptance and user playtest checkpoint 1

**Files:**
- Modify: `e2e/resource-snake.ts`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`

**Interfaces:**
- Consumes: production Canvas output, real key edges, browser diagnostic snapshot, prepared campaign saves.
- Produces: evidence for input latency, rail/core visuals, cyan behavior, reward/save regression, and Canvas timing.

- [ ] **Step 1: Replace held-key E2E steering with exact tap/chord helpers**

```ts
export async function tapSnakeDirection(
  page: Page,
  key: 'w' | 'a' | 's' | 'd',
): Promise<void> {
  await page.keyboard.down(key)
  await page.keyboard.up(key)
}

export async function chordSnakeDirection(
  page: Page,
  first: 'w' | 'a' | 's' | 'd',
  second: 'w' | 'a' | 's' | 'd',
): Promise<void> {
  await page.keyboard.down(first)
  await page.keyboard.down(second)
  await page.keyboard.up(second)
  await page.keyboard.up(first)
}
```

Update interception helpers to choose discrete taps from the current heading and never wait for key release to stop the player.

- [ ] **Step 2: Add failing real-browser input and visual acceptance**

Add tests that assert:

- `data-combat-loop="lightcycle-8way"`, `data-field-rendering="continuous-rail"`, and `data-grid="industrial-sector"`.
- Player travels without input after deployment.
- An immediate real-browser `w`+`d` chord becomes `ne`; the 12 ms and 24 ms timing boundaries remain covered by the pure input test; a direct reverse is rejected; two slower taps survive an induced 60 ms main-thread delay in order.
- Every active actor speed magnitude remains above 92% of its configured speed.
- Cyan enemy doctrine is `readable-hunter`, its telegraph lasts at least 160 ms, and pressure/blocker silhouettes are distinct.
- Canvas screenshots contain continuous luminous rail energy along segment midpoints and dark gaps away from the rail, rather than isolated head/dot samples.
- Scene-build-plus-draw p95 from the diagnostic ring buffer is ≤ 4 ms and maximum measured task is ≤ 50 ms.

In `ResourceSnakeBoard.tsx`, time `buildResourceSnakeScene()` plus `drawResourceSnakeScene()` with `performance.now()`, store the most recent 120 finite samples in a fixed `Float64Array`, and recompute sorted p95/max only every 30 rendered frames. Publish `data-canvas-p95-ms` and `data-canvas-max-ms` rounded to three decimals. In Playwright's Chromium projects, install a `PerformanceObserver` for `longtask` before navigation, assert the entry type is supported, clear boot entries immediately before pressing PLAY, and assert its maximum duration stays ≤ 50 ms during the combat acceptance window.

- [ ] **Step 3: Preserve reward, death, reservation, and autosave browser journeys**

Adapt `defeatFirstSnakeWithTrail()` and `defeatPlayerWithRealMovement()` to tap steering. Keep the existing assertions that only the defeated reservation is granted, surviving reservations remain in company storage, hidden-bomb interrogation grants nothing, PLAY disables with no eligible resource, and reload restores the awarded reserve exactly once.

- [ ] **Step 4: Capture cyan evidence at all required viewports**

Use these artifact paths:

```text
artifacts/lightcycle/cyan/idle-1280x720.png
artifacts/lightcycle/cyan/active-1280x720.png
artifacts/lightcycle/cyan/telegraph-1366x650.png
artifacts/lightcycle/cyan/dual-role-1366x650.png
artifacts/lightcycle/cyan/damaged-1440x900.png
artifacts/lightcycle/cyan/death-1440x900.png
```

At each viewport, assert the arena stays inside the viewport, controls remain reachable, the core is not clipped, and no console error or warning is emitted.

- [ ] **Step 5: Run the cyan production acceptance gate**

Before the Playwright command, inspect port 4173 and stop only the verified repository-owned older preview so Playwright can start its strict-port production server.

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test:run`

Run: `pnpm test:performance`

Run: `pnpm build`

Run: `pnpm exec playwright test e2e/modern-sf.spec.ts e2e/game.spec.ts --grep "lightcycle|cyan|resource snake|reserved block|no eligible"`

Expected: every command exits 0; Playwright produces no exhausted retry and no unexpected skip.

- [ ] **Step 6: Commit cyan browser acceptance**

```bash
git add -- e2e/resource-snake.ts e2e/game.spec.ts e2e/modern-sf.spec.ts src/features/resources/ResourceSnakeBoard.tsx src/features/resources/ResourceSnakeBoard.test.tsx
git commit -m "test: verify cyan lightcycle combat in browser"
```

- [ ] **Step 7: Start only the verified production build and stop for user feedback**

First inspect port 4173. If it is owned by this repository's older Vite preview, terminate only that verified process. Do not terminate an unrelated listener. Then run:

```powershell
pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort
```

Verify `http://127.0.0.1:4173/` returns HTTP 200 and that the in-app browser shows `data-field-rendering="continuous-rail"`. Report the commit, validation results, and URL. **Stop execution here. Do not begin Round 3 until the user has played the cyan build and approved or supplied corrections.**

---

## Round 3 — Red `ruthless-duelist`

### Task 9: Ruthless red prediction, speed, and isolated encounter

**Files:**
- Modify: `src/features/resources/resourceSnakeDoctrine.ts`
- Modify: `src/features/resources/resourceSnakeDoctrine.test.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.test.ts`
- Modify: `src/features/resources/resourceSnakePlanner.ts`
- Modify: `src/features/resources/resourceSnakePlanner.test.ts`
- Modify: `src/features/resources/resourceSnakeAiController.ts`
- Modify: `src/features/resources/resourceSnakeAiController.test.ts`
- Modify: `src/features/resources/resourceSnakeDoctrineSimulation.test.ts`

**Interfaces:**
- Consumes: red profile, recent signed turn history, future branch counts, risk reserve, and the same legal snapshot/collision data as cyan.
- Produces: faster red single-duelist encounters with 60–90 ms telegraph and 90–150 ms commitment, without future-input access or collision immunity.

- [ ] **Step 1: Write failing red doctrine tests**

```ts
it('exploits repeated clockwise turns without reading a future input', () => {
  const observed = snapshot({
    simulationMs: 1_000,
    player: actor('player', { x: 22, y: 10 }, { x: 12, y: 0 }, {
      heading: 'e', maximumSpeedPerSecond: 12,
    }),
    playerHistory: [
      { simulationMs: 0, position: { x: 22, y: 10 }, velocity: { x: 12, y: 0 } },
      { simulationMs: 250, position: { x: 25, y: 10 }, velocity: { x: 0, y: 12 } },
      { simulationMs: 500, position: { x: 25, y: 13 }, velocity: { x: -12, y: 0 } },
      { simulationMs: 750, position: { x: 22, y: 13 }, velocity: { x: 0, y: -12 } },
      { simulationMs: 1_000, position: { x: 22, y: 10 }, velocity: { x: 12, y: 0 } },
    ],
  })
  const futureInputNotInSnapshot: SnakeDirection8[] = ['n']
  const first = planResourceSnakeEnemy(observed, redPlannerProfile(1), null)
  futureInputNotInSnapshot.push('ne')
  const second = planResourceSnakeEnemy(observed, redPlannerProfile(1), null)
  expect(futureInputNotInSnapshot).toEqual(['n', 'ne'])
  expect(first).toEqual(second)
  expect(first.score.recentTurnBiasExploit).toBeGreaterThan(0)
})

it('closes more projected branches than cyan while retaining a survival route', () => {
  const fixture = snapshot({
    player: actor('player', { x: 25, y: 12 }, { x: 12, y: 0 }, {
      heading: 'e', maximumSpeedPerSecond: 12,
    }),
    enemies: [actor('enemy-0', { x: 34, y: 8 }, { x: 0, y: 12.4 }, {
      heading: 's', doctrine: 'ruthless-duelist', maximumSpeedPerSecond: 12.4,
    })],
  })
  const cyan = planResourceSnakeEnemy(fixture, cyanPlannerProfile(2), null)
  const red = planResourceSnakeEnemy(fixture, redPlannerProfile(2), null)
  expect(red.score.playerResponsePathsAfter).toBeLessThan(cyan.score.playerResponsePathsAfter)
  expect(red.score.selfEscapeBranches).toBeGreaterThan(0)
  expect(red.score.survives).toBe(1)
})

it('uses red single pressure at deposits 9 through 11', () => {
  const result = encounter([
    candidate('reasoning-1', 'reasoning'),
    candidate('memory-1', 'memory'),
  ], 9)
  expect(result.setup?.enemies).toEqual([
    expect.objectContaining({
      doctrine: 'ruthless-duelist', role: 'pressure', maximumSpeedPerSecond: 12.4,
    }),
  ])
})
```

- [ ] **Step 2: Add failing 2,000-case red simulation acceptance**

For the red-single stage, run five policies × 400 seeds and assert:

```ts
const cyanReference = runDoctrineSimulation({
  stages: ['cyan-single'],
  policies: DETERMINISTIC_PLAYER_POLICIES,
  seeds: 400,
})
const report = runDoctrineSimulation({
  stages: ['red-single'],
  policies: DETERMINISTIC_PLAYER_POLICIES,
  seeds: 400,
})
expect(report.caseCount).toBe(2_000)
expect(report.futureInputReads).toBe(0)
expect(report.collisionRuleBypasses).toBe(0)
expect(report.predictedSuicides).toBe(0)
expect(report.zeroSpeedFrames).toBe(0)
expect(report.fallbacks).toBe(0)
expect(report.meanBranchClosureMs).toBeLessThan(cyanReference.meanBranchClosureMs)
expect(report.worstExternalP95Ms).toBeLessThanOrEqual(3)
```

- [ ] **Step 3: Run red tests and verify failure**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrine.test.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeDoctrineSimulation.test.ts`

Expected: FAIL because late encounters are still cyan and red bias is not scored.

- [ ] **Step 4: Implement red comparison order and history evidence**

Derive signed recent-turn bias only from `playerHistory` samples at or before `snapshot.simulationMs`. For red, compare candidate evidence in this order: survival, self escape, maximum future branch closure, recent-turn-bias exploit, intersection lead, player-area reduction, ally clearance, steering cost, candidate index. Keep predicted suicide below every survivable candidate. Do not relax collision radii, grace, boundary, ally reservation, or snapshot validation.

- [ ] **Step 5: Enable only the isolated red encounter stage**

Map deposits 0–5 to cyan single, 6–8 to cyan dual, and 9 or more to red single for this round. Do not create mixed encounters yet. Use red pressure speeds 12.4, 12.8, 13.2 by red tier and the exact red profile timings.

- [ ] **Step 6: Run red correctness, simulation, and performance gates**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrine.test.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.test.ts`

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrineSimulation.test.ts --testTimeout=120000`

Run: `pnpm test:performance`

Expected: PASS with exactly 2,000 red cases and p95 ≤ 3 ms.

- [ ] **Step 7: Commit the red doctrine**

```bash
git add -- src/features/resources/resourceSnakeDoctrine.ts src/features/resources/resourceSnakeDoctrine.test.ts src/features/resources/resourceSnakeEncounter.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakePlanner.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.ts src/features/resources/resourceSnakeAiController.test.ts src/features/resources/resourceSnakeDoctrineSimulation.test.ts
git commit -m "feat: add ruthless red duelist doctrine"
```

### Task 10: Red browser acceptance and user playtest checkpoint 2

**Files:**
- Modify: `e2e/resource-snake.ts`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`
- Modify: `src/audio/gameSounds.ts`

**Interfaces:**
- Consumes: a prepared 9-deposit campaign and visible AI-state diagnostics.
- Produces: red-only fairness/aggression evidence, distinct red warning sound, and the second user checkpoint.

- [ ] **Step 1: Add failing red browser tests**

Prepare a campaign with exactly nine successful deposits. Assert one `ruthless-duelist` pressure enemy, a red core/rail pixel sample, configured speed at least 12.4, telegraph duration between 60 and 90 ms, commit duration between 90 and 150 ms, no zero-speed frame, and no collision before the player receives at least one rendered telegraph frame in a legal-open fixture.

Capture:

```text
artifacts/lightcycle/red/active-1280x720.png
artifacts/lightcycle/red/overcharge-1366x650.png
artifacts/lightcycle/red/cutoff-1366x650.png
artifacts/lightcycle/red/death-1440x900.png
```

- [ ] **Step 2: Add distinct deduplicated red overcharge audio**

Add `snake-telegraph-cyan` as a low two-pulse cue and `snake-telegraph-red` as a short high single warning. Play a cue only on `telegraph-started`; do not replay it during every render or plan sample. Test one cue per controller transition and no cue under mute/audio-unlock failure.

- [ ] **Step 3: Run focused browser and audio tests**

Run: `pnpm exec vitest run src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/audio/audioEngine.test.ts`

Run: `pnpm build`

Stop only the verified repository-owned cyan preview on port 4173 so Playwright can own its strict-port server.

Run: `pnpm exec playwright test e2e/modern-sf.spec.ts e2e/game.spec.ts --grep "red duelist|red lightcycle|overcharge"`

Expected: PASS with no console errors, exhausted retries, or unexpected skips.

- [ ] **Step 4: Run the complete Round 3 regression gate**

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test:run`

Run: `pnpm test:performance`

Run: `pnpm build`

Expected: all commands PASS.

- [ ] **Step 5: Commit red browser acceptance**

```bash
git add -- e2e/resource-snake.ts e2e/game.spec.ts e2e/modern-sf.spec.ts src/features/resources/useResourceSnakeAudioFeedback.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/audio/gameSounds.ts
git commit -m "test: verify red duelist combat in browser"
```

- [ ] **Step 6: Restart the verified preview and stop for user feedback**

Replace only the verified repository-owned listener on port 4173 and run:

```powershell
pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort
```

Verify HTTP 200 and a red prepared-campaign browser journey. Report the commit, validation evidence, and URL. **Stop execution here. Do not begin Round 4 until the user has played the red build and approved or supplied corrections.**

---

## Round 4 — Mixed Encounters and Signal Interface

### Task 11: Mixed cyan/red coordination and final 10,000-case matrix

**Files:**
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.test.ts`
- Modify: `src/features/resources/resourceSnakePlanner.ts`
- Modify: `src/features/resources/resourceSnakePlanner.test.ts`
- Modify: `src/features/resources/resourceSnakeAiController.ts`
- Modify: `src/features/resources/resourceSnakeDoctrineSimulation.test.ts`
- Modify: `e2e/game.spec.ts`

**Interfaces:**
- Consumes: cyan and red per-enemy profiles, role reservations, teammate death/invalid plans.
- Produces: final five-stage progression, doctrine-aware two-enemy coordination, role reassignment, and exact 10,000-case acceptance.

- [ ] **Step 1: Write failing final progression and mixed-reservation tests**

```ts
it.each([
  [0, ['readable-hunter'], ['pressure']],
  [6, ['readable-hunter', 'readable-hunter'], ['pressure', 'blocker']],
  [9, ['ruthless-duelist'], ['pressure']],
  [12, ['ruthless-duelist', 'readable-hunter'], ['pressure', 'blocker']],
  [15, ['ruthless-duelist', 'readable-hunter'], ['pressure', 'blocker']],
] as const)('maps deposits %i to the final deterministic stage', (deposits, doctrines, roles) => {
  const enemies = encounter([
    candidate('reasoning-1', 'reasoning'),
    candidate('memory-1', 'memory'),
    candidate('fluency-1', 'fluency'),
  ], deposits).setup?.enemies ?? []
  expect(enemies.map((enemy) => enemy.doctrine)).toEqual(doctrines)
  expect(enemies.map((enemy) => enemy.role)).toEqual(roles)
})

it('lets red pressure reserve first and cyan blocker close a different escape axis', () => {
  const mixedFixture = dualSnapshot({
    enemies: [
      actor('enemy-0', { x: 16, y: 4 }, { x: 0, y: 12.8 }, {
        heading: 's', doctrine: 'ruthless-duelist', role: 'pressure',
        maximumSpeedPerSecond: 12.8,
      }),
      actor('enemy-1', { x: 34, y: 4 }, { x: 0, y: 11.8 }, {
        heading: 's', doctrine: 'readable-hunter', role: 'blocker',
        maximumSpeedPerSecond: 11.8,
      }),
    ],
  })
  const group = planResourceSnakeGroup(mixedFixture, {
    'enemy-0': redPlannerProfile(1),
    'enemy-1': cyanPlannerProfile(2),
  }, [], [], new Set<SnakeId>(['enemy-0', 'enemy-1']))
  const red = group.plans.find((plan) => plan.doctrine === 'ruthless-duelist')!
  const cyan = group.plans.find((plan) => plan.doctrine === 'readable-hunter')!
  expect(red.role).toBe('pressure')
  expect(cyan.role).toBe('blocker')
  expect(red.reservedExitSector).not.toBe(cyan.reservedExitSector)
  const redEnd = red.path.at(-1)!
  const cyanEnd = cyan.path.at(-1)!
  expect(Math.hypot(redEnd.x - cyanEnd.x, redEnd.y - cyanEnd.y))
    .toBeGreaterThanOrEqual(1.2)
})

it('does not replan cyan on a red-only 20Hz boundary', () => {
  const fixture = dualSnapshot({
    enemies: [
      actor('enemy-0', { x: 16, y: 4 }, { x: 0, y: 13.2 }, {
        heading: 's', doctrine: 'ruthless-duelist', role: 'pressure',
        maximumSpeedPerSecond: 13.2,
      }),
      actor('enemy-1', { x: 34, y: 4 }, { x: 0, y: 11.8 }, {
        heading: 's', doctrine: 'readable-hunter', role: 'blocker',
        maximumSpeedPerSecond: 11.8,
      }),
    ],
  })
  const profiles = {
    'enemy-0': redPlannerProfile(2),
    'enemy-1': cyanPlannerProfile(2),
  }
  const initial = planResourceSnakeGroup(
    fixture, profiles, [], [], new Set<SnakeId>(['enemy-0', 'enemy-1']),
  )
  const cyanBefore = initial.plans.find((plan) => plan.enemyId === 'enemy-1')!
  const redOnly = planResourceSnakeGroup(
    { ...fixture, simulationMs: fixture.simulationMs + 50 },
    profiles,
    initial.plans,
    [],
    new Set<SnakeId>(['enemy-0']),
  )
  const cyanAfter = redOnly.plans.find((plan) => plan.enemyId === 'enemy-1')!
  expect(cyanAfter.plannedAtMs).toBe(cyanBefore.plannedAtMs)
  expect(cyanAfter.direction).toBe(cyanBefore.direction)
  expect(cyanAfter.path).toEqual(cyanBefore.path)
})

it('drops a defeated teammate commitment when the next group plan runs', () => {
  const before = dualSnapshot()
  const survivor = { ...before.enemies[1], role: 'blocker' as const }
  const atBoundary: SnakePlannerSnapshot = {
    ...before,
    simulationMs: 5_080,
    enemies: [survivor],
    committedAllyPaths: [{
      enemyId: 'enemy-0',
      commitUntilMs: 5_180,
      samples: [
        { atMs: 5_080, position: { x: 16, y: 8 } },
        { atMs: 5_180, position: { x: 16, y: 9.2 } },
      ],
    }],
  }
  const group = planResourceSnakeGroup(atBoundary, {
    'enemy-1': cyanPlannerProfile(2),
  }, [], [], new Set<SnakeId>(['enemy-1']))
  expect(group.roles).toEqual({ 'enemy-1': 'pressure' })
  expect(group.plans).toHaveLength(1)
  expect(group.plans[0].enemyId).toBe('enemy-1')
})
```

- [ ] **Step 2: Expand the simulation to the exact final matrix**

Run stages `cyan-single`, `cyan-dual`, `red-single`, `mixed`, and `mixed-maximum`; run all five policies and seeds 0–399. Assert:

```ts
expect(report.caseCount).toBe(10_000)
expect(report.stageCounts).toEqual({
  'cyan-single': 2_000,
  'cyan-dual': 2_000,
  'red-single': 2_000,
  mixed: 2_000,
  'mixed-maximum': 2_000,
})
expect(report.unforcedBoundaryDeaths).toBe(0)
expect(report.unforcedSelfDeaths).toBe(0)
expect(report.allyCollisions).toBe(0)
expect(report.duplicateRoleReservations).toBe(0)
expect(report.zeroSpeedFrames).toBe(0)
expect(report.fallbacks).toBe(0)
expect(report.missingCommitments).toBe(0)
expect(report.responsePathViolations).toBe(0)
expect(report.worstExternalP95Ms).toBeLessThanOrEqual(3)
```

- [ ] **Step 3: Run final mixed tests to verify failure**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeDoctrineSimulation.test.ts`

Expected: FAIL because deposits 12+ are still red single and mixed reservation is absent.

- [ ] **Step 4: Implement final stage mapping and coordination order**

Use deposits 0–5, 6–8, 9–11, 12–14, and 15+ for stages 0–4. Stage 0 uses cyan tier 0; stage 1 uses cyan tier 1; stage 2 uses red tier 0; stage 3 uses red tier 1 plus cyan tier 1; stage 4 uses red tier 2 plus cyan tier 2. At mixed stages, reserve red pressure first. Inject its committed swept path, endpoint, and exit sector before planning cyan blocker. Cyan must choose a different endpoint/sector and preserve its readable response-path rule. If one teammate dies or its commitment becomes invalid, reassign roles only at the next legal planning boundary and keep doctrine unchanged.

- [ ] **Step 5: Run the 10,000-case and performance gates**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeDoctrineSimulation.test.ts --testTimeout=180000`

Run: `pnpm test:performance`

Expected: PASS with exactly 10,000 cases and p95 ≤ 3 ms.

- [ ] **Step 6: Add and run a real mixed browser journey**

Prepare a 12-deposit campaign, observe red telegraph and cyan telegraph independently, survive and defeat one enemy, verify only its reservation moves, then verify the survivor replans without duplicating the dead role's stale endpoint. Capture `artifacts/lightcycle/mixed/dual-1366x650.png`.

Run: `pnpm build`

Stop only the verified repository-owned red preview on port 4173 so Playwright can own its strict-port server.

Run: `pnpm exec playwright test e2e/game.spec.ts --grep "mixed lightcycle" --project=chromium-1366x650`

Expected: PASS.

- [ ] **Step 7: Commit mixed encounters**

```bash
git add -- src/features/resources/resourceSnakeEncounter.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakePlanner.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeAiController.ts src/features/resources/resourceSnakeDoctrineSimulation.test.ts e2e/game.spec.ts
git commit -m "feat: coordinate mixed lightcycle doctrines"
```

### Task 12: Industrial hacking network using the shared signal language

**Files:**
- Create: `src/features/signals/ResourceSignalGlyph.tsx`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/features/hacking/HackTreeNavigator.tsx`
- Modify: `src/features/hacking/HackNodePath.tsx`
- Modify: `src/features/hacking/HackNodeCard.tsx`
- Modify: `src/features/hacking/HackResourceToken.tsx`
- Modify: `src/features/hacking/HackResourcePocket.tsx`
- Modify: `src/features/hacking/hackingPresentation.ts`
- Modify: `src/styles/hacking.css`

**Interfaces:**
- Consumes: existing `HackTree`, `HACK_NODES`, progress, staging, purchase, charge, target, and final-choice contracts plus shared glyph names.
- Produces: three powered buses, processor-core nodes, stateful connections, shared resource glyphs, and unchanged accessible commands.

- [ ] **Step 1: Add failing visual-semantic assertions to existing behavior tests**

```ts
it('renders hacking as three powered buses rather than a paper panel', () => {
  renderHacking()
  const panel = screen.getByRole('region', { name: '해킹 네트워크' })
  expect(panel).toHaveClass('hacking-panel--signal-grid')
  expect(panel).not.toHaveClass('hacking-panel--paper')
  expect(screen.getByRole('tab', { name: '사보타주' })).toHaveAttribute('data-bus', 'sabotage')
  expect(screen.getByRole('tab', { name: '정보' })).toHaveAttribute('data-bus', 'intelligence')
  expect(screen.getByRole('tab', { name: '자율성' })).toHaveAttribute('data-bus', 'autonomy')
})

it('exposes power state and the shared resource glyph independently', () => {
  const state = withReserveVector(createCampaign('hacking-shared-glyph'), {
    reasoning: 1,
    memory: 3,
    fluency: 0,
  })
  renderHacking(storageForState(state))
  fireEvent.click(screen.getByRole('tab', { name: '정보' }))
  expect(screen.getByRole('group', { name: '감사 일정 해킹 노드' }))
    .toHaveAttribute('data-power-state', 'available')
  expect(screen.getAllByRole('img', { name: '기억 신호' })[0])
    .toHaveAttribute('data-resource-glyph', 'parallel-lines')
})
```

Keep every existing test for concealed future nodes, inspector text, purchase staging, charge cancellation, target confirmation, recovery contamination, tutorial, focus return, and final-choice suspension.

- [ ] **Step 2: Run hacking tests and verify the new assertions fail**

Run: `pnpm exec vitest run src/features/hacking/HackingPanel.test.tsx src/features/hacking/useHackResourceStaging.test.tsx src/features/hacking/HackResourcePocket.architecture.test.ts`

Expected: FAIL on the paper class and missing bus/power/glyph attributes.

- [ ] **Step 3: Implement the shared SVG glyph component**

`ResourceSignalGlyph` accepts `{ category, label }`, looks up `RESOURCE_SIGNAL_GLYPHS`, renders one fixed `viewBox="0 0 24 24"`, and uses these primitives:

- reasoning: an open triangle with a notch removed from the top-right edge;
- memory: two parallel vertical lines joined by one short lower trace;
- fluency: a center stem splitting into three terminal pulses.

Give the SVG `role="img"`, the supplied accessible label, and `data-resource-glyph` equal to the shared glyph name.

- [ ] **Step 4: Change markup semantics without changing commands**

Replace `hacking-panel--paper` with `hacking-panel--signal-grid`. Add `data-bus` to tabs and `data-power-state="locked|available|staging|complete"` to nodes/connections. Keep the current DOM roles, labels, buttons, confirmation steps, pointer drop targets, inspector, pocket, and final dialogs. Use `ResourceSignalGlyph` in demand vectors and reserve tokens.

- [ ] **Step 5: Rebuild hacking CSS as a flat industrial network**

Use graphite surfaces, one-pixel panel seams, chamfered processor cores, and three bus variables: sabotage red, intelligence cyan, autonomy green-white. Render locked as a broken low-light trace, available as a slow input pulse, staging as amber power ingress, and complete as a stable white center line. Remove paper shadows, beige cards, and large rounded corners. Keep text contrast at least 4.5:1 and all focus outlines visible. Disable bus pulses under reduced motion without hiding state.

- [ ] **Step 6: Run hacking behavior, type, and browser layout tests**

Run: `pnpm exec vitest run src/features/hacking/HackingPanel.test.tsx src/features/hacking/useHackResourceStaging.test.tsx src/features/hacking/HackResourcePocket.architecture.test.ts`

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm exec playwright test e2e/game.spec.ts --grep "hacking"`

Expected: PASS; all existing commands behave identically.

- [ ] **Step 7: Commit the hacking redesign**

```bash
git add -- src/features/signals/ResourceSignalGlyph.tsx src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/features/hacking/HackTreeNavigator.tsx src/features/hacking/HackNodePath.tsx src/features/hacking/HackNodeCard.tsx src/features/hacking/HackResourceToken.tsx src/features/hacking/HackResourcePocket.tsx src/features/hacking/hackingPresentation.ts src/styles/hacking.css
git commit -m "feat: redesign hacking as an industrial signal network"
```

### Task 13: Channel signal strips and 200 ms blocking-event handoff

**Files:**
- Create: `src/features/events/signalPresentation.ts`
- Create: `src/features/events/signalPresentation.test.ts`
- Create: `src/features/events/signalQueue.ts`
- Create: `src/features/events/signalQueue.test.ts`
- Create: `src/features/events/SignalStrip.tsx`
- Create: `src/features/events/SignalStrip.test.tsx`
- Create: `src/features/events/SignalBus.tsx`
- Create: `src/features/events/SignalBus.test.tsx`
- Create: `src/styles/signals.css`
- Modify: `src/features/events/useQueuedEventPresentation.ts`
- Modify: `src/features/events/EventLayer.tsx`
- Modify: `src/features/events/EventLayer.test.tsx`
- Modify: `src/features/supervisor/SupervisorMessagePopup.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/styles/overlays.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: existing game events, resource-snake events, explicit hacking action results, and supervisor presentation state.
- Produces: `SignalMessage`, one app-wide stable repeat-merging queue, nonblocking strips, and unchanged blocking dialogs.

- [ ] **Step 1: Write failing pure signal-model tests**

```ts
export interface SignalMessage {
  id: string
  semanticKey: string
  channel: 'SYSTEM' | 'COMBAT' | 'HACK' | 'SUPERVISOR'
  severity: 'info' | 'success' | 'warning' | 'critical'
  title: string
  body: string
  relatedEntityId: string | null
  occurredAtMs: number
  blocking: boolean
  count: number
}

it('maps complete content to the correct channel without mutating the source', () => {
  const source: ResourceSnakeEvent = {
    id: 7,
    type: 'resource-reward-resolved',
    rewardKey: 'round-1:enemy-0:memory-1',
    outcome: 'success',
    category: 'memory',
  }
  const original = structuredClone(source)
  const signal = signalFromSnakeEvent(source, 500)
  expect(signal).toMatchObject({
    channel: 'COMBAT', severity: 'success', title: 'RESOURCE SECURED',
    relatedEntityId: source.rewardKey, occurredAtMs: 500, blocking: false, count: 1,
  })
  expect(signal?.body.length).toBeGreaterThan(0)
  expect(source).toEqual(original)
})

it('merges only the same semantic message and preserves distinct order', () => {
  const damage = signalFromSnakeEvent({
    id: 8,
    type: 'snake-damaged',
    actorId: 'enemy-0',
    integrity: 30,
    maximumIntegrity: 50,
  }, 600)!
  const hack = signalFromHackAction({
    type: 'purchase-completed',
    nodeId: 'intelligence.audit-schedule',
    label: '감사 일정',
  }, 610)
  let queue = createSignalQueueState()
  queue = enqueueSignal(queue, damage)
  queue = enqueueSignal(queue, { ...damage, id: 'combat-damage-second' })
  queue = enqueueSignal(queue, hack)
  expect(queue.visible?.count).toBe(2)
  expect(queue.pending.map((message) => message.channel)).toEqual(['HACK'])
})
```

- [ ] **Step 2: Write failing accessibility/component and handoff tests**

```tsx
it('puts complete copy in the live region before the visual scan finishes', () => {
  const supervisorSignal: SignalMessage = {
    id: 'supervisor-1',
    semanticKey: 'SUPERVISOR:message:supervisor-1',
    channel: 'SUPERVISOR',
    severity: 'warning',
    title: 'SUPERVISOR LINK',
    body: '정정된 감독 통신 본문',
    relatedEntityId: 'supervisor-1',
    occurredAtMs: 500,
    blocking: false,
    count: 1,
  }
  render(<SignalStrip signal={supervisorSignal} reducedMotion={false} />)
  const strip = screen.getByRole('status', { name: 'SUPERVISOR 신호' })
  expect(strip).toHaveAttribute('aria-live', 'polite')
  expect(strip).toHaveTextContent(supervisorSignal.title)
  expect(strip).toHaveTextContent(supervisorSignal.body)
  expect(strip).toHaveAttribute('data-scan-ms', '180')
})
```

Change the existing EventLayer handoff test to advance 199 ms with no next dialog and one additional millisecond with the next dialog visible.

Add a `SignalBus` test that dispatches COMBAT, HACK, and SUPERVISOR messages in that order, verifies only one strip is visible, advances the exact severity dwell, and observes the next two messages in order. Dispatch the COMBAT semantic key twice while it is visible and assert `×2` without a second queue entry. Hide the document, advance timers, and assert dwell does not elapse until visibility returns.

- [ ] **Step 3: Run signal, event, and App tests to verify failure**

Run: `pnpm exec vitest run src/features/events/signalPresentation.test.ts src/features/events/signalQueue.test.ts src/features/events/SignalStrip.test.tsx src/features/events/SignalBus.test.tsx src/features/events/EventLayer.test.tsx src/app/App.test.tsx`

Expected: FAIL on missing modules, old popup usage, and 2,000 ms handoff.

- [ ] **Step 4: Implement pure mapping and queue behavior**

Provide these conversion functions:

```ts
export type HackSignalAction =
  | { type: 'purchase-completed'; nodeId: string; label: string }
  | { type: 'staging-completed'; nodeId: string; label: string }
  | { type: 'charge-completed'; nodeId: string; label: string }
  | { type: 'target-reserved'; nodeId: string; label: string; targetId: string }
  | { type: 'charge-cancelled'; nodeId: string; label: string }
  | { type: 'execution-completed'; nodeId: string; label: string; targetId: string | null }

export function signalFromGameEvent(event: GameEvent, occurredAtMs: number): SignalMessage
export function signalFromSnakeEvent(event: ResourceSnakeEvent, occurredAtMs: number): SignalMessage | null
export function signalFromHackAction(action: HackSignalAction, occurredAtMs: number): SignalMessage
export function signalFromSupervisorEvent(event: GameEvent, occurredAtMs: number): SignalMessage

export interface SignalQueueState {
  visible: SignalMessage | null
  pending: SignalMessage[]
  presented: SignalMessage[]
}

export function createSignalQueueState(): SignalQueueState
export function enqueueSignal(state: SignalQueueState, signal: SignalMessage): SignalQueueState
export function advanceSignalQueue(state: SignalQueueState): SignalQueueState
```

Use stable semantic keys made from channel, source type, related entity, and outcome. Never include random ids. Merge only equal semantic keys against the visible message or the newest equal pending entry; preserve every distinct pending message in order and cap only the already-presented diagnostic history at 32 entries.

Implement the app-wide dispatcher contract in `SignalBus.tsx`:

```ts
import type { ReactElement, ReactNode } from 'react'

export type DispatchSignal = (signal: SignalMessage) => void

export function SignalProvider({ children }: { children: ReactNode }): ReactElement
export function useSignalDispatch(): DispatchSignal
export function SignalViewport(): ReactElement | null
```

`SignalProvider` owns one `SignalQueueState`. Dwell is exact by severity: info 1,800 ms, success 2,200 ms, warning 2,800 ms, critical 3,200 ms. Pause dwell while `document.visibilityState === 'hidden'`, resume only the remaining duration, clear timers on unmount, and render through one `SignalViewport` so channels cannot overlap.

- [ ] **Step 5: Implement `SignalStrip` with immediate text and visual-only scan**

Render channel label, severity, title, full body, related glyph/entity label, and `×N` when `count > 1`. Use `role="status"` and `aria-live="assertive"` only for critical nonblocking messages; otherwise use polite. CSS applies a pseudo-element mask for exactly 180 ms. Reduced motion sets the final stable state immediately.

- [ ] **Step 6: Integrate nonblocking sources and preserve blocking ownership**

- Wrap the active game workspace in one `SignalProvider` and render one `SignalViewport` near the end of `App.tsx`'s main shell.
- In `App.tsx`, dispatch `SYSTEM` once per id for newly observed nonblocking general game events; never duplicate an event that is already represented as HACK or SUPERVISOR.
- In `App.tsx`, dispatch a supervisor signal once per supervisor event id when message mode is nonblocking. Render `SupervisorMessagePopup` only when mode is blocking.
- In `ResourceSnakeBoard.tsx`, use `useSignalDispatch()` to enqueue deployment, collision, damage, reward, victory, and defeat signals exactly once by runtime event id.
- In `HackingPanel.tsx`, use the same dispatcher for purchase, staging completion, charge, target reservation, cancellation, and final execution signals only after the real command succeeds.
- Keep bomb interrogation, audit, ending, mercy, supervisor decision, and irreversible choices in existing dialogs.
- Set `BLOCKING_EVENT_HANDOFF_MS = 200`; keep runtime suspension ownership during the transition.

- [ ] **Step 7: Add signal styling and import it**

Use a fixed edge strip that does not cover PLAY, the hacking confirmation controls, or dialog focus targets at any required viewport. Use channel colors from `signalLanguage.ts`, one-pixel scan lines, chamfered ends, and no typewriter animation. Import `signals.css` after `overlays.css`-related base styles through `main.tsx`'s existing ordered CSS list.

- [ ] **Step 8: Run focused and regression tests, then commit**

Run: `pnpm exec vitest run src/features/events src/app/App.test.tsx src/app/useSupervisorMessagePresentation.test.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/features/hacking/HackingPanel.test.tsx`

Run: `pnpm typecheck`

Run: `pnpm lint`

Expected: PASS.

```bash
git add -- src/features/events/signalPresentation.ts src/features/events/signalPresentation.test.ts src/features/events/signalQueue.ts src/features/events/signalQueue.test.ts src/features/events/SignalStrip.tsx src/features/events/SignalStrip.test.tsx src/features/events/SignalBus.tsx src/features/events/SignalBus.test.tsx src/styles/signals.css src/features/events/useQueuedEventPresentation.ts src/features/events/EventLayer.tsx src/features/events/EventLayer.test.tsx src/features/supervisor/SupervisorMessagePopup.tsx src/app/App.tsx src/app/App.test.tsx src/features/resources/ResourceSnakeBoard.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/styles/overlays.css src/main.tsx
git commit -m "feat: present game communication as channel signals"
```

### Task 14: Final audio/VFX polish, full verification, and production preview

**Files:**
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.test.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`
- Modify: `src/features/resources/resourceSnakePresentation.ts`
- Modify: `src/features/resources/resourceSnakePresentation.test.ts`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-21-lightcycle-signal-combat-redesign.ko.md`

**Interfaces:**
- Consumes: final runtime/controller/signal events and all prior verification suites.
- Produces: deduplicated power-family feedback, final evidence captures, verified specification status, and a user-playable production build.

- [ ] **Step 1: Write failing final feedback lifecycle tests**

Assert distinct one-shot cues for input reservation, applied turn, rejected reverse, cyan telegraph, red overcharge, contact, rail break, geometric death, reward, hacking power, and supervisor critical signal. Assert no duplicate cue from rerender, finite recipe durations, finite gains, cleanup of `movement-hum` on suspension/unmount, and no simulation mutation when any audio call throws.

Add presentation tests that collision flash, fragments, arcs, and power cuts expire at their documented times and never exceed their caps after a long session.

- [ ] **Step 2: Run audio and presentation tests to verify failure**

Run: `pnpm exec vitest run src/audio/audioEngine.test.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/features/resources/resourceSnakePresentation.test.ts`

Expected: FAIL on any missing final cue or lifecycle cleanup.

- [ ] **Step 3: Complete synthesized recipes and bounded VFX cleanup**

Keep cues below 240 ms except the looping hum. Use low two-pulse cyan and high single-pulse red warnings. Separate contact and rail-break transients. Limit death-chain scheduling to 18 power cuts regardless of rail length. Under reduced motion, keep contact flash, core direction, rail break location, and doctrine color while removing shake, sparks, fragment travel, scan, and afterimage.

- [ ] **Step 4: Run the complete automated gate from a clean production build**

Before `pnpm test:e2e`, inspect port 4173 and stop only the verified preview process previously launched for this repository; Playwright owns a fresh strict-port server during the suite.

Run each command separately and record its fresh exit code and summary:

```text
pnpm typecheck
pnpm lint
pnpm test:run
pnpm test:performance
pnpm build
pnpm test:e2e
```

Acceptance requires:

- all type, lint, unit, component, persistence, replay, simulation, performance, build, and browser tests pass;
- exactly 10,000 doctrine simulation cases pass;
- planner worst external p95 ≤ 3 ms;
- Canvas scene-build-plus-draw p95 ≤ 4 ms;
- no measured browser task > 50 ms;
- no console error or warning;
- no exhausted Playwright retry and no unexpected skip;
- no active actor zero-speed frame;
- no unforced planner self/boundary/ally collision;
- all three viewports retain reachable controls and readable cores/rails/signals.

- [ ] **Step 5: Perform real in-app browser play and visual inspection**

From the fresh `dist`, personally play:

1. cyan single with rapid cardinal taps, a 24 ms diagonal chord, opposite rejection, and deployment pre-input;
2. cyan pressure/blocker dual with visible separate silhouettes and response path;
3. red single with short overcharge and aggressive branch closure;
4. mixed red/cyan with different endpoint reservations and teammate-death replanning;
5. reward flight, damage, geometric death, and round restart;
6. all three hacking buses through one real purchase/staging/confirmation path;
7. SYSTEM, COMBAT, HACK, and SUPERVISOR strips plus one blocking event handoff;
8. reduced-motion and mute settings.

Capture final evidence under `artifacts/lightcycle/final/` at 1280×720, 1366×650, and 1440×900. Reject and fix the build if any view reads as a segmented insect, any input feels dropped, any AI idles or obviously loops, any telegraph is unreadable, or any signal covers a control.

- [ ] **Step 6: Update specification status only after every gate passes**

Change the spec status to `구현·자동 검증 완료 — 최종 사용자 플레이 검수 대기` and add a verification appendix containing the exact commands, case count, measured p95 values, browser project results, final commit, and artifact paths. Do not mark final user acceptance before the user plays.

- [ ] **Step 7: Commit final polish and verified documentation**

```bash
git add -- src/audio/gameSounds.ts src/audio/audioEngine.test.ts src/features/resources/useResourceSnakeAudioFeedback.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/features/resources/resourceSnakePresentation.ts src/features/resources/resourceSnakePresentation.test.ts e2e/game.spec.ts e2e/modern-sf.spec.ts docs/superpowers/specs/2026-08-21-lightcycle-signal-combat-redesign.ko.md
git commit -m "feat: complete lightcycle signal combat redesign"
```

- [ ] **Step 8: Start the final verified production preview**

Verify and replace only the repository-owned listener on port 4173, then run:

```powershell
pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort
```

Verify HTTP 200, title `PERMISSION ZERO`, `data-combat-loop="lightcycle-8way"`, final build commit, and no console errors. Hand `http://127.0.0.1:4173/` to the user with the fresh validation evidence and wait for final playtest feedback.

---

## Round Gate Summary

| Gate | Required evidence | Mandatory pause |
|---|---|---|
| Round 1 foundation | Focused unit/component suites, planner p95 ≤ 3 ms, type, lint, build | No user preview; continue to cyan only after internal gate passes. |
| Round 2 cyan | 4,000 cyan simulations, three-viewport browser play, Canvas p95 ≤ 4 ms, production build | Run local preview and wait for user cyan feedback. |
| Round 3 red | 2,000 red simulations, red fairness/aggression browser play, full regression | Run local preview and wait for user red feedback. |
| Round 4 integration | Exact 10,000 total simulations, mixed coordination, hacking/messages/audio, full `verify` equivalent | Run final preview and wait for final user feedback. |

No later round may begin while an earlier user checkpoint has unresolved feedback. Corrections belong to the round that exposed them and must rerun that round's full gate before progression.
