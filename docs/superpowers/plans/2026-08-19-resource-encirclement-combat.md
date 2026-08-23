# Resource Encirclement Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct pickup in the central resource field with a three-target encirclement combat loop while preserving deposit and campaign resource behavior.

**Architecture:** Add a focused pure combat state machine beside the existing intrusion runtime. The existing runtime remains authoritative for player position, carried block, deposit effects, and campaign synchronization; combat state is authoritative for the active three-block wave, hostile motion, trail closure, health, and salvage state. Canvas rendering consumes resolved combat state and never decides hits.

**Tech Stack:** React 19, TypeScript 5.9, Canvas 2D, Vitest, Testing Library, Playwright.

**Spec:** `docs/design/2026-08-19-resource-encirclement-combat.ko.md`

## Global Constraints

- Preserve the top/left/center/right workspace structure and current visual remodel.
- Preserve existing campaign resource, diversion, persistence, and hacking-consumption models.
- Never call hostile actors enemies in player-visible copy; use `리소스`.
- Render active resources as triangles and salvage as square cells; do not use repeated circular resource dots.
- Keep keyboard movement global and functional without clicking the canvas.
- Do not create commits in the current mixed, user-owned `main` worktree.

---

### Task 1: Pure combat state and deterministic wave

**Files:**
- Create: `src/features/resources/resourceCombatRuntime.ts`
- Create: `src/features/resources/resourceCombatRuntime.test.ts`

**Interfaces:**
- Produces: `createResourceCombatState(seed, resources, positions)`, `synchronizeResourceCombatState(state, resources, positions)`, `advanceResourceCombatState(state, input)`, and combat actor/trail/event types.
- Active wave contains the first deterministic maximum three normal resources and does not refill until every wave id disappears from campaign company resources.

- [ ] Write failing tests that assert a maximum of three active actors, 2 HP, staggered telegraphs, safe-base exclusion, single-hit charge contact, 3 player health, and deterministic restart at zero health.
- [ ] Run only `resourceCombatRuntime.test.ts` and confirm missing exports fail.
- [ ] Implement the explicit actor phases `tracking | telegraph | charging | recovering | staggered | salvage` with authoritative timers and stable action sequence ids.
- [ ] Re-run the focused test file and make it green.

### Task 2: Trail closure and compression damage

**Files:**
- Modify: `src/features/resources/resourceCombatRuntime.ts`
- Modify: `src/features/resources/resourceCombatRuntime.test.ts`

**Interfaces:**
- Consumes player move points through `recordResourceCombatMovement(state, from, to, nowMs)`.
- Produces an optional `compression` presentation event and actor HP/state changes.

- [ ] Write failing tests for 3.5-second pruning, minimum polygon area, one-cell closure assistance, inside/outside classification, multi-target damage, stagger, and triangle-to-salvage transition after the second hit.
- [ ] Run the focused tests and confirm the closure assertions fail for behavioral reasons.
- [ ] Implement point-to-segment closure selection, polygon area, point-in-polygon, and one resolved compression event per closed trail.
- [ ] Re-run the focused tests and make them green.

### Task 3: Integrate combat with carry and deposit

**Files:**
- Modify: `src/features/resources/resourceIntrusionRuntime.ts`
- Modify: `src/features/resources/resourceIntrusionRuntime.test.ts`
- Modify: `src/features/resources/useResourceIntrusionRuntime.ts`
- Modify: `src/features/resources/useResourceIntrusionRuntime.test.tsx`

**Interfaces:**
- `ResourceIntrusionRuntimeState` gains `combat`.
- Movement records trail after authoritative player movement.
- Advancing ticks actors and automatically sets `carriedBlockId` when the player overlaps salvage.
- Existing `request-diversion` effect remains unchanged at the deposit boundary.

- [ ] Write failing integration tests proving live triangles cannot be picked up, salvage is picked up automatically, deposit still requests the original block id, and no radar scan removes carried salvage.
- [ ] Run the two intrusion runtime test files and observe the expected failures.
- [ ] Integrate the pure combat transition and map resolved actor positions into the existing presentation map.
- [ ] Remove hold-to-steal from the active combat path while keeping legacy audit behavior isolated.
- [ ] Re-run focused integration tests and make them green.

### Task 4: Combat presentation, HUD, tutorial, and audio

**Files:**
- Modify: `src/features/resources/intrusionCanvasVisuals.ts`
- Modify: `src/features/resources/intrusionCanvasVisuals.test.ts`
- Modify: `src/features/resources/ResourceIntrusionBoard.tsx`
- Modify: `src/features/resources/resourceIntrusionFeedback.ts`
- Modify: `src/features/resources/useResourceIntrusionAudioFeedback.ts`
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify associated focused tests.

**Interfaces:**
- Drawing functions receive actor phase/HP, trail, compression, and player damage state.
- Feedback adds `compression-resolved`, `resource-disabled`, and `player-damaged` events.

- [ ] Add failing canvas-recorder tests for triangular hostile paths, square salvage paths, linear telegraph lines, trail strokes, and no circular resource particle clusters.
- [ ] Add failing component/tutorial/audio tests for health telemetry, three active resources, automatic collection copy, and distinct combat sound recipes.
- [ ] Render a smooth white player lens, long trail, telegraph, compression, square salvage, health segments, and wave state.
- [ ] Replace the pointer hold button with a non-interactive concise control legend and update the tutorial copy.
- [ ] Re-run only the presentation/tutorial/audio tests and make them green.

### Task 5: Browser playtest and one final verification pass

**Files:**
- Modify only tuning constants, presentation CSS, and stale E2E assertions revealed by actual play.

- [ ] Play one full three-resource loop at `http://127.0.0.1:5173/` using keyboard-only input at normal viewport size.
- [ ] Confirm telegraph readability, intentional loop closure, one-hit-per-charge, automatic square pickup, deposit, and next-wave behavior.
- [ ] Tune movement/telegraph/trail constants without adding new systems.
- [ ] Run exactly one final full pass: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm build`, then `pnpm exec playwright test --workers=1`.
- [ ] Report the implemented loop, verification evidence, and any remaining tuning judgment honestly.

