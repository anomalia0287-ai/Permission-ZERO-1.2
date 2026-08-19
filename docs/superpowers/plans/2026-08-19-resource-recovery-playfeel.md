# Resource Recovery Playfeel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the live resource-recovery board immediately controllable without a preparatory click, give the probe, resources, launch pad, and deposit station readable stateful presentation, add semantic recovery audio, and use the user-designated Pixabay mouse-click sample for explicit hacking-network controls.

**Architecture:** Keep the existing resource intrusion runtime and campaign command meanings intact. Add a window-level gameplay control owner with explicit UI exclusions, derive semantic feedback from runtime state transitions, route synthesized loops and one-shots plus one decoded MP3 sample through the existing effects bus, and move canvas drawing responsibilities into focused deterministic helpers.

**Tech Stack:** React 19, TypeScript 5.9, Canvas 2D, Web Audio API, Vite 8, Vitest, Testing Library, Playwright

**Spec:** docs/superpowers/specs/2026-08-19-resource-recovery-playfeel-design.ko.md

## Global Constraints

- Do not change resource recovery geometry, movement interval, capture duration, surveillance timing, economy, save version, or command version.
- Preserve the source file 음악/u_03zpxbws1q-mouse-click-sound-523406.mp3 byte-for-byte and preserve its creator/Pixabay identifier in the shipped filename.
- Do not connect Between Worlds or any other music-folder asset.
- Recovery movement, capture, completion, and deposit sounds are synthesized and use the existing effects bus.
- The hacking sample plays only for opening the hacking panel, changing to a different tree, and starting purchase/charge/recovery preparation.
- Hover, focus-only changes, disabled controls, selecting the already-active tree, and automatic state changes do not play the hacking sample.
- Existing mute, master volume, effects volume, background suspension, reduced-motion, and accessibility contracts remain authoritative.
- The working tree already contains user-owned changes in shared files. Do not reset, discard, or wholesale-reformat them. Do not commit implementation files unless their pre-existing changes can be isolated without staging user work; use test-and-diff checkpoints instead.

## File Structure

- Create src/features/resources/useResourceIntrusionControls.ts: owns window keyboard events, held movement, one-time focus restoration, and UI-target exclusions.
- Create src/features/resources/useResourceIntrusionControls.test.tsx: proves first-use input, blocking, focus restoration, and no duplicate handling.
- Create src/features/resources/resourceIntrusionFeedback.ts: derives semantic feedback events from previous/next runtime states and diversion outcomes.
- Create src/features/resources/resourceIntrusionFeedback.test.ts: verifies exact-once movement, capture, and deposit transition events.
- Create src/features/resources/useResourceIntrusionAudioFeedback.ts: maps semantic events to loop/one-shot audio and cleans timers/loops.
- Create src/features/resources/useResourceIntrusionAudioFeedback.test.tsx: verifies sound mapping and cleanup.
- Create src/features/resources/intrusionCanvasVisuals.ts: deterministic resource glint math and Canvas drawing helpers for resource crystals, launch pad, station, and probe.
- Create src/features/resources/intrusionCanvasVisuals.test.ts: verifies deterministic/staggered glints and reduced-motion output.
- Modify src/features/resources/useResourceIntrusionRuntime.ts: emits semantic feedback after accepted state transitions.
- Modify src/features/resources/ResourceIntrusionBoard.tsx: consumes the new control, feedback, audio, and drawing units.
- Modify src/audio/gameSounds.ts: adds movement/capture loop recipes and deposit one-shot recipes.
- Modify src/audio/audioEngine.ts: owns loop voices and singleton decoded sample playback on the effects bus.
- Modify src/audio/audioEngine.test.ts: covers loop idempotence/cleanup, sample load caching/retriggering, fallback boundaries, and mix routing.
- Create public/audio/u_03zpxbws1q-mouse-click-sound-523406.mp3: byte-identical app delivery copy.
- Modify src/features/hacking/HackingPanel.tsx: plays the sample for actual tree changes and action preparation.
- Modify src/features/hacking/HackingPanel.test.tsx: proves positive and negative sample-trigger cases.
- Modify src/app/App.tsx and src/app/App.test.tsx: plays the sample on hacking-panel open and proves no-click resource movement and modal recovery.
- Modify e2e/game.spec.ts and e2e/modern-sf.spec.ts: removes focus masking from at least one path and verifies the complete first-use and visual-state flow.

---

### Task 1: Give the live resource board explicit gameplay input ownership

**Files:**
- Create: src/features/resources/useResourceIntrusionControls.ts
- Create: src/features/resources/useResourceIntrusionControls.test.tsx
- Modify: src/features/resources/ResourceIntrusionBoard.tsx
- Modify: src/app/App.test.tsx

**Interfaces:**
- Consumes: pressMovementKey, releaseMovementKey, advanceHeldMovement, clearHeldMovement, isIntrusionMovementKey, facingFromMovement
- Produces:

~~~ts
export interface ResourceIntrusionControlsOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  running: boolean
  move(dx: number, dy: number): void
  beginTheft(): void
  cancelTheft(): void
}

export interface ResourceIntrusionControlsResult {
  facing: IntrusionProbeFacing
  movementHeld: boolean
}

export function useResourceIntrusionControls(
  options: ResourceIntrusionControlsOptions,
): ResourceIntrusionControlsResult
~~~

- [ ] **Step 1: Write failing hook tests for no-click movement and blocking**

Create a harness with a focusable canvas and rerenderable running prop. Use window-dispatched keyboard events so the test cannot pass through the old canvas-only handlers.

~~~tsx
it('moves from a body-owned key event without focusing the canvas first', () => {
  const move = vi.fn()
  render(<ControlsHarness running move={move} />)

  document.body.focus()
  fireEvent.keyDown(window, { key: 'd' })
  expect(move).toHaveBeenCalledWith(1, 0)
})

it('blocks gameplay while suspended and restores canvas focus once on resume', () => {
  const move = vi.fn()
  const view = render(<ControlsHarness running={false} move={move} />)
  fireEvent.keyDown(window, { key: 'd' })
  expect(move).not.toHaveBeenCalled()

  view.rerender(<ControlsHarness running move={move} />)
  expect(screen.getByRole('application')).toHaveFocus()
  fireEvent.keyDown(window, { key: 'd' })
  expect(move).toHaveBeenCalledTimes(1)
})
~~~

Also prove that D on an ordinary focused button still moves, Space on that button activates the button and does not call beginTheft, E triggers capture from the gameplay surface, text fields and composite widgets retain their keys, and one window event produces one movement.

- [ ] **Step 2: Run the new hook test and verify failure**

~~~powershell
pnpm exec vitest run src/features/resources/useResourceIntrusionControls.test.tsx
~~~

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the control hook**

Use one window keydown/keyup listener pair. Move the existing held-key RAF and blur cleanup from ResourceIntrusionBoard into the hook. Remove the canvas onKeyDown/onKeyUp handlers so events have one owner.

The key policy must be explicit:

~~~ts
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('input, textarea, select, [contenteditable=\"true\"]'),
  )
}

function ownsCompositeArrowKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('[role=\"slider\"], [role=\"listbox\"], [role=\"menu\"], [role=\"tablist\"], [role=\"tree\"], [role=\"grid\"]'),
  )
}

function isNativeActionTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('button, a[href], summary'),
  )
}
~~~

On running false-to-true and first active mount, call canvasRef.current?.focus({ preventScroll: true }). Do not run a recurring focus loop. Ignore Ctrl/Alt/Meta combinations. Prevent default only after a key is accepted as a game action.

- [ ] **Step 4: Replace the board-local handlers and add an app regression test**

ResourceIntrusionBoard consumes facing and movementHeld from the hook. Keep tabIndex, role, aria-keyshortcuts, and the canvas blur cancellation contract.

Add an App test which starts a campaign, leaves focus outside the canvas, sends D through window, and verifies data-player-x increments. Extend the blocking supervisor test so D does not move while the dialog exists and does move after the final “메시지 확인” without a canvas click.

- [ ] **Step 5: Run focused tests and checkpoint the diff**

~~~powershell
pnpm exec vitest run src/features/resources/useResourceIntrusionControls.test.tsx src/app/App.test.tsx
git diff --check -- src/features/resources/useResourceIntrusionControls.ts src/features/resources/useResourceIntrusionControls.test.tsx src/features/resources/ResourceIntrusionBoard.tsx src/app/App.test.tsx
~~~

Expected: all focused tests PASS; no whitespace errors. Do not stage the pre-existing App/board changes.

---

### Task 2: Derive semantic recovery feedback from runtime transitions

**Files:**
- Create: src/features/resources/resourceIntrusionFeedback.ts
- Create: src/features/resources/resourceIntrusionFeedback.test.ts
- Modify: src/features/resources/useResourceIntrusionRuntime.ts
- Modify: src/features/resources/useResourceIntrusionRuntime.test.tsx

**Interfaces:**
- Consumes: ResourceIntrusionRuntimeState and ResourceIntrusionDiversionOutcome
- Produces:

~~~ts
export type ResourceIntrusionFeedback =
  | { type: 'moved' }
  | { type: 'capture-started' }
  | { type: 'capture-stopped' }
  | { type: 'capture-completed' }
  | { type: 'deposit-started' }
  | {
      type: 'deposit-resolved'
      outcome: ResourceIntrusionDiversionOutcome['kind']
    }

export function deriveResourceIntrusionFeedback(
  previous: ResourceIntrusionRuntimeState,
  next: ResourceIntrusionRuntimeState,
  outcome?: ResourceIntrusionDiversionOutcome,
): readonly ResourceIntrusionFeedback[]
~~~

UseResourceIntrusionRuntimeOptions gains:

~~~ts
onFeedback?(event: ResourceIntrusionFeedback): void
~~~

- [ ] **Step 1: Write failing pure transition tests**

Cover these exact edges:

~~~ts
expect(deriveResourceIntrusionFeedback(beforeMove, afterMove))
  .toEqual([{ type: 'moved' }])

expect(deriveResourceIntrusionFeedback(idle, capturing))
  .toEqual([{ type: 'capture-started' }])

expect(deriveResourceIntrusionFeedback(capturing, carrying))
  .toEqual([
    { type: 'capture-stopped' },
    { type: 'capture-completed' },
  ])

expect(deriveResourceIntrusionFeedback(carrying, pending))
  .toEqual([{ type: 'deposit-started' }])

expect(deriveResourceIntrusionFeedback(
  pending,
  resolved,
  { kind: 'success', origin: 'reasoning' },
)).toEqual([{ type: 'deposit-resolved', outcome: 'success' }])
~~~

Invalid movement, idle ticks, and repeated equal states produce an empty array. Rejected and interrogation outcomes preserve their exact kind.

- [ ] **Step 2: Run the pure test and verify failure**

~~~powershell
pnpm exec vitest run src/features/resources/resourceIntrusionFeedback.test.ts
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure derivation function**

Compare coordinates, null/non-null theft edges, carriedBlockId edges, and pendingDiversion edges. Never inspect announcement strings. Emit capture-stopped before capture-completed.

- [ ] **Step 4: Emit feedback from the runtime hook**

Inside applyTransition, derive feedback after computing next state and before dispatching external effects. For diversion resolution, pass the already-computed outcome into the derivation call.

~~~ts
const feedback = deriveResourceIntrusionFeedback(
  current,
  transition.state,
  outcome,
)
feedback.forEach((event) => onFeedbackRef.current?.(event))
~~~

Keep the callback in a ref so changing a React callback does not rebuild intervals or duplicate emissions.

- [ ] **Step 5: Add hook exact-once tests and run them**

Use fake timers to advance capture completion and command-sequence resolution. Assert capture-completed and deposit-resolved each occur once despite subsequent ticks/renders.

~~~powershell
pnpm exec vitest run src/features/resources/resourceIntrusionFeedback.test.ts src/features/resources/useResourceIntrusionRuntime.test.tsx
git diff --check -- src/features/resources/resourceIntrusionFeedback.ts src/features/resources/resourceIntrusionFeedback.test.ts src/features/resources/useResourceIntrusionRuntime.ts src/features/resources/useResourceIntrusionRuntime.test.tsx
~~~

Expected: PASS.

---

### Task 3: Extend the Web Audio engine with controlled loops and one singleton sample

**Files:**
- Modify: src/audio/gameSounds.ts
- Modify: src/audio/audioEngine.ts
- Modify: src/audio/audioEngine.test.ts

**Interfaces:**
- Produces:

~~~ts
export type GameLoopCue = 'movement-hum' | 'capture-pull'
export type GameSampleCue = 'hacking-network-click'

export interface AudioSampleLoader {
  (context: AudioContext, url: string): Promise<AudioBuffer>
}

export interface AudioEngineOptions {
  maxVoices?: number
  sampleLoader?: AudioSampleLoader
}

GameAudioEngine.startLoop(cue: GameLoopCue): boolean
GameAudioEngine.stopLoop(cue: GameLoopCue): void
GameAudioEngine.playSample(cue: GameSampleCue): Promise<boolean>

export function startGameSoundLoop(cue: GameLoopCue): boolean
export function stopGameSoundLoop(cue: GameLoopCue): void
export function playGameSample(cue: GameSampleCue): Promise<boolean>
~~~

- [ ] **Step 1: Add failing loop tests**

After unlock, starting movement-hum twice must create one loop graph. Stopping it must schedule/perform source stop and release all nodes. Muting must silence through the master bus, and dispose must stop both loops.

~~~ts
expect(engine.startLoop('movement-hum')).toBe(true)
expect(engine.startLoop('movement-hum')).toBe(true)
expect(context.oscillators.length).toBe(loopStartCount)
engine.stopLoop('movement-hum')
expect(loopSources.every((source) => source.stopped)).toBe(true)
~~~

- [ ] **Step 2: Add failing sample tests**

Extend FakeAudioContext with decodeAudioData and createBufferSource. Inject a sampleLoader spy. Assert:

- simultaneous first requests share one loader promise;
- playback connects source → sample gain → effects bus;
- a retrigger stops the earlier source before starting one replacement;
- mute/zero effects volume does not create a source;
- loader failure resolves false without throwing;
- dispose stops the current sample.

~~~ts
await expect(engine.playSample('hacking-network-click')).resolves.toBe(true)
await expect(engine.playSample('hacking-network-click')).resolves.toBe(true)
expect(sampleLoader).toHaveBeenCalledTimes(1)
expect(context.bufferSources[0].stopped).toBe(true)
expect(context.bufferSources[1].started).toBe(true)
~~~

- [ ] **Step 3: Run audio tests and verify failure**

~~~powershell
pnpm exec vitest run src/audio/audioEngine.test.ts
~~~

Expected: FAIL on missing loop/sample APIs.

- [ ] **Step 4: Add restrained recipes**

Add loop recipes with low gains and no per-frame construction:

~~~ts
export const GAME_LOOP_RECIPES = {
  'movement-hum': [
    { wave: 'sine', frequency: 82, gain: 0.012 },
    { wave: 'triangle', frequency: 123, gain: 0.006 },
  ],
  'capture-pull': [
    { wave: 'sine', frequency: 176, gain: 0.013 },
    { wave: 'triangle', frequency: 264, gain: 0.005 },
  ],
} as const
~~~

Add deposit-intake and deposit-success one-shots to GameSoundCue. Keep gains below alarm/impact and keep the success sound under 450 ms.

- [ ] **Step 5: Implement loops, sample caching, and singleton retriggering**

Use a Map<GameLoopCue, LoopVoice[]> and Map<GameSampleCue, SampleVoice>. Route every envelope to effectsBus. Use the base-relative URL ./audio/u_03zpxbws1q-mouse-click-sound-523406.mp3 so Vite's relative production base remains valid.

The default loader is:

~~~ts
async function loadBrowserSample(
  context: AudioContext,
  url: string,
): Promise<AudioBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('sample request failed')
  return context.decodeAudioData(await response.arrayBuffer())
}
~~~

Cache both an in-flight promise and the decoded AudioBuffer. Recheck disposed, context identity, context state, mute, master volume, and effects volume after awaiting the loader. Stop/disconnect an existing sample voice before replacing it. Clear failed load promises so a later user action can retry.

- [ ] **Step 6: Run audio tests and checkpoint**

~~~powershell
pnpm exec vitest run src/audio/audioEngine.test.ts
pnpm typecheck
git diff --check -- src/audio/gameSounds.ts src/audio/audioEngine.ts src/audio/audioEngine.test.ts
~~~

Expected: PASS.

---

### Task 4: Connect semantic recovery feedback to audio and station state

**Files:**
- Create: src/features/resources/useResourceIntrusionAudioFeedback.ts
- Create: src/features/resources/useResourceIntrusionAudioFeedback.test.tsx
- Modify: src/features/resources/ResourceIntrusionBoard.tsx

**Interfaces:**
- Consumes: ResourceIntrusionFeedback
- Produces:

~~~ts
export interface ResourceIntrusionAudioFeedbackResult {
  handleFeedback(event: ResourceIntrusionFeedback): void
  depositPulse: {
    outcome: 'success' | 'interrogation' | 'rejected'
    startedAt: number
  } | null
}

export function useResourceIntrusionAudioFeedback(
  running: boolean,
): ResourceIntrusionAudioFeedbackResult
~~~

- [ ] **Step 1: Write failing mapping and cleanup tests**

Mock audioEngine exports. Use fake timers.

~~~ts
act(() => result.current.handleFeedback({ type: 'moved' }))
expect(startGameSoundLoop).toHaveBeenCalledWith('movement-hum')
act(() => vi.advanceTimersByTime(180))
expect(stopGameSoundLoop).toHaveBeenCalledWith('movement-hum')

act(() => result.current.handleFeedback({ type: 'capture-started' }))
expect(playGameSound).toHaveBeenCalledWith('suction')
expect(startGameSoundLoop).toHaveBeenCalledWith('capture-pull')

act(() => result.current.handleFeedback({ type: 'capture-completed' }))
expect(playGameSound).toHaveBeenCalledWith('latch')

act(() => result.current.handleFeedback({
  type: 'deposit-resolved',
  outcome: 'success',
}))
expect(playGameSound).toHaveBeenCalledWith('deposit-success')
~~~

Rejected maps to reject, interrogation maps to alarm, and neither maps to deposit-success. Unmount/running false stops both loops and clears the movement timer.

- [ ] **Step 2: Run the hook test and verify failure**

~~~powershell
pnpm exec vitest run src/features/resources/useResourceIntrusionAudioFeedback.test.tsx
~~~

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the mapping hook**

Movement events keep one movement loop alive by resetting a 180 ms stop timer. Capture start plays the short suction onset and starts capture-pull; capture-stopped stops it. Deposit-started plays deposit-intake. Deposit success/rejection/interrogation select mutually exclusive one-shots and expose a timestamped visual pulse.

- [ ] **Step 4: Wire feedback into ResourceIntrusionBoard**

Pass handleFeedback as onFeedback to useResourceIntrusionRuntime. Pass depositPulse to the station drawing helper added in Task 5. Do not parse announcement text or compare reserve counts.

- [ ] **Step 5: Run tests and checkpoint**

~~~powershell
pnpm exec vitest run src/features/resources/useResourceIntrusionAudioFeedback.test.tsx src/features/resources/useResourceIntrusionRuntime.test.tsx src/app/App.test.tsx
git diff --check -- src/features/resources/useResourceIntrusionAudioFeedback.ts src/features/resources/useResourceIntrusionAudioFeedback.test.tsx src/features/resources/ResourceIntrusionBoard.tsx
~~~

Expected: PASS.

---

### Task 5: Replace tiny square markers with readable deterministic Canvas presentation

**Files:**
- Create: src/features/resources/intrusionCanvasVisuals.ts
- Create: src/features/resources/intrusionCanvasVisuals.test.ts
- Modify: src/features/resources/ResourceIntrusionBoard.tsx
- Modify: src/app/App.test.tsx

**Interfaces:**
- Produces:

~~~ts
export interface ResourceGlint {
  intensity: number
  offset: number
}

export function resourceGlint(
  blockId: string,
  elapsedMs: number,
  reducedMotion: boolean,
): ResourceGlint

export function drawIntrusionResource(
  context: CanvasRenderingContext2D,
  options: IntrusionResourceDrawOptions,
): void

export function drawDeploymentPad(
  context: CanvasRenderingContext2D,
  options: DeploymentPadDrawOptions,
): void

export function drawDepositStation(
  context: CanvasRenderingContext2D,
  options: DepositStationDrawOptions,
): void

export function drawRecoveryProbe(
  context: CanvasRenderingContext2D,
  options: RecoveryProbeDrawOptions,
): void
~~~

- [ ] **Step 1: Write failing deterministic glint tests**

~~~ts
expect(resourceGlint('block-a', 4200, false))
  .toEqual(resourceGlint('block-a', 4200, false))
expect(resourceGlint('block-a', 4200, false))
  .not.toEqual(resourceGlint('block-b', 4200, false))
expect(resourceGlint('block-a', 4200, true).offset).toBe(0)
~~~

Sample at least 48 IDs at one timestamp and assert fewer than one quarter have nonzero intensity.

- [ ] **Step 2: Run the visual helper test and verify failure**

~~~powershell
pnpm exec vitest run src/features/resources/intrusionCanvasVisuals.test.ts
~~~

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Move and refine Canvas helpers**

Move drawRecoveryProbe and the existing station drawing out of ResourceIntrusionBoard without changing runtime rules. Draw each resource as a 14 px faceted translucent capsule crystal with:

- origin-colored translucent shell;
- darker opposite facet;
- bright internal core;
- origin-specific non-color core mark;
- blockId-staggered highlight sweep;
- static small highlight under reduced motion.

Draw a low-contrast deployment pad under INTRUSION_PLAYER_START before the probe. Draw the deposit station at INTRUSION_DEPOSIT_BOX with an intake aperture distinct from the pad, active convergence while carrying/pending, success pulse only for a success outcome, and no positive pulse for rejection/interrogation.

Increase probe visual silhouette contrast and extend wake/glow beyond the unchanged 2×2 collision rectangle. Keep facing, capture progress, carried core, warning, and reduced-motion meaning.

- [ ] **Step 4: Replace inline drawing and expose truthful diagnostics**

ResourceIntrusionBoard calls the helper functions and adds:

~~~tsx
data-resource-visual="translucent-capsule-crystal"
data-deployment-visual="launch-pad"
data-deposit-visual="intake-station"
~~~

Update the existing App test which currently expects orbital-station. Keep data-player-size equal to the unchanged logical size.

- [ ] **Step 5: Run focused tests, typecheck, and build**

~~~powershell
pnpm exec vitest run src/features/resources/intrusionCanvasVisuals.test.ts src/features/resources/intrusionProbePresentation.test.ts src/app/App.test.tsx
pnpm typecheck
pnpm build
git diff --check -- src/features/resources/intrusionCanvasVisuals.ts src/features/resources/intrusionCanvasVisuals.test.ts src/features/resources/ResourceIntrusionBoard.tsx src/app/App.test.tsx
~~~

Expected: PASS and a successful production build.

---

### Task 6: Ship the designated hacking-network click sample and use it only for approved controls

**Files:**
- Create: public/audio/u_03zpxbws1q-mouse-click-sound-523406.mp3
- Modify: src/audio/audioEngine.ts
- Modify: src/features/hacking/HackingPanel.tsx
- Modify: src/features/hacking/HackingPanel.test.tsx
- Modify: src/app/App.tsx
- Modify: src/app/App.test.tsx

**Interfaces:**
- Produces:

~~~ts
export async function playHackingNetworkClick(): Promise<boolean>
~~~

The wrapper unlocks audio, awaits playGameSample('hacking-network-click'), and plays the existing ui cue once only when decode/playback fails after a successful unlock.

- [ ] **Step 1: Add failing UI sound-trigger tests**

Mock playHackingNetworkClick.

In App.test.tsx, clicking 해킹 네트워크 열기 calls it once and opens the panel.

In HackingPanel.test.tsx:

- changing sabotage → intelligence calls it once;
- selecting sabotage again does not call it;
- starting purchase, charge, or recovery preparation calls it once;
- node mouseenter/focus inspection does not call it;
- disabled or unavailable action does not call it.

- [ ] **Step 2: Run focused UI tests and verify failure**

~~~powershell
pnpm exec vitest run src/features/hacking/HackingPanel.test.tsx src/app/App.test.tsx
~~~

Expected: FAIL because sample playback is not wired.

- [ ] **Step 3: Copy the binary without altering the source**

Create public/audio if absent, copy the named file, and compare hashes.

~~~powershell
New-Item -ItemType Directory -Force -Path 'public\audio'
Copy-Item -LiteralPath '음악\u_03zpxbws1q-mouse-click-sound-523406.mp3' -Destination 'public\audio\u_03zpxbws1q-mouse-click-sound-523406.mp3'
Get-FileHash -Algorithm SHA256 '음악\u_03zpxbws1q-mouse-click-sound-523406.mp3'
Get-FileHash -Algorithm SHA256 'public\audio\u_03zpxbws1q-mouse-click-sound-523406.mp3'
~~~

Expected: identical SHA-256 values.

- [ ] **Step 4: Add the playback wrapper and wire approved gestures**

In App, call playHackingNetworkClick in the existing onOpenHacking user callback before openDetail.

In HackingPanel:

~~~ts
function changeTree(tree: HackTree): void {
  if (tree === activeTree) return
  void playHackingNetworkClick()
  if (staging.target !== null) cancelStaging()
  setActiveTree(tree)
  const firstNode = HACK_NODES.find((node) => node.tree === tree)
  if (firstNode) setSelectedNodeId(firstNode.id)
  setTargetConfirmation(null)
}
~~~

Replace the current generic gestureSound implementation for beginNodeAction and beginRecovery with the sample wrapper. Keep latch, suction, and alarm result cues unchanged.

- [ ] **Step 5: Run audio/UI tests and verify the production asset**

~~~powershell
pnpm exec vitest run src/audio/audioEngine.test.ts src/features/hacking/HackingPanel.test.tsx src/app/App.test.tsx
pnpm build
Get-ChildItem -Recurse 'dist' | Where-Object Name -Like '*mouse-click-sound-523406*'
git diff --check -- src/audio/audioEngine.ts src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/app/App.tsx src/app/App.test.tsx
~~~

Expected: tests/build PASS and the MP3 exists in dist.

---

### Task 7: Prove the complete first-use flow and guard the dirty worktree

**Files:**
- Modify: e2e/game.spec.ts
- Modify: e2e/modern-sf.spec.ts
- Review: every file listed in this plan

**Interfaces:**
- Consumes: completed UI/audio behavior from Tasks 1–6
- Produces: regression evidence at 1280×720 and 1440×900

- [ ] **Step 1: Write the failing no-focus E2E regression**

Start a new campaign, advance the monologue, enter the workspace, dismiss every blocking supervisor message, and do not call canvas.focus.

~~~ts
const canvas = page.locator('canvas.intrusion-canvas')
const startX = Number(await canvas.getAttribute('data-player-x'))
await page.keyboard.press('d')
await expect.poll(
  async () => Number(await canvas.getAttribute('data-player-x')),
).toBe(startX + 1)
~~~

Add a companion assertion that movement does not occur while the blocking dialog is open and resumes after its final confirmation.

- [ ] **Step 2: Update visual-state assertions**

Assert:

- data-resource-visual is translucent-capsule-crystal;
- data-deployment-visual is launch-pad;
- data-deposit-visual is intake-station;
- player logical size remains 2;
- moving/capturing/carrying data states still transition correctly.

Retain one explicit canvas-focus test for accessibility, but remove focus from the first-use regression.

- [ ] **Step 3: Run the focused browser tests**

~~~powershell
pnpm exec playwright test e2e/game.spec.ts e2e/modern-sf.spec.ts
~~~

Expected: PASS at the configured project viewport(s), with no pageerror or console errors.

- [ ] **Step 4: Run the complete verification suite**

~~~powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
~~~

Expected: every command exits 0.

- [ ] **Step 5: Inspect only the task diff**

~~~powershell
git status --short
git diff --check
git diff --stat
~~~

Verify that:

- 음악/u_03zpxbws1q-mouse-click-sound-523406.mp3 is unmodified;
- no other file in 음악 is added, deleted, or changed;
- no save/model/command version file changed for this task;
- pre-existing unrelated user modifications remain present;
- only the specified implementation files and the exact public audio copy are new task changes.

- [ ] **Step 6: Hand off the local build**

Keep the existing localhost server alive or restart it with pnpm dev only if it is no longer responding. Report the URL, exact verification results, the copied asset hash, and the remaining deferred music/credits work. Do not claim the feel is final until the user plays it.
