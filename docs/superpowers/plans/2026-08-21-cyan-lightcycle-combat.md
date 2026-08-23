# Cyan Lightcycle Combat Implementation Plan

> **Execution rule:** Use `superpowers:executing-plans` in the current main session. One writer owns all implementation, review, and verification. Do not create or use sub-agents. Track steps with `- [ ]` checkboxes.

**Goal:** Replace the current stop-and-go dot snake with a flat, always-moving eight-direction lightcycle duel driven only by the cyan `readable-hunter`, verify exactly 750 deterministic cases, and stop on a verified local production build for user play.

**Architecture:** Keep `resourceSnakeRuntime.ts` authoritative for 120Hz movement, swept collision, damage, rewards, and round resolution. Add pure eight-direction input and cyan AI-controller boundaries around the existing snapshot planner. Keep collision samples intact while projecting exact turn vertices into a pure scene and Canvas 2D renderer. Do not touch hacking, dialogue, event presentation, app-shell integration, save schema, or campaign rules.

**Tech stack:** TypeScript 5.9, React 19, Canvas 2D, Vitest 4, Testing Library, Playwright 1.62, Vite 8, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-21-cyan-lightcycle-combat.ko.md`

**Parallel ownership:** `docs/superpowers/specs/2026-08-21-parallel-work-ownership.ko.md`

## Binding constraints

- Implement only cyan `readable-hunter`; there is no red doctrine type, profile, color, warning, encounter, test, or future-ready mixed scheduler in this scope.
- Keep `pressure` and `blocker` as roles under the one cyan doctrine.
- Keep the field at 50 × 24 and simulation at 120Hz.
- Set deployment to 360ms, player speed to 12, and round resolution target to 520ms.
- Accept exactly eight normalized headings; reject direct reverse; keep at most two queued turns; merge perpendicular presses within 24ms.
- Consume at most one queued player turn per fixed step.
- No active actor stops. Normal commands use speed scale 1; fatal recovery alone may use 0.92.
- Cyan planning stays within 10–14Hz, 1.4–2.2s lookahead, at least 160ms telegraph, and 180–260ms commit.
- Player is white/blue-white; every enemy is cyan. Role uses silhouette; resource category uses an inner glyph.
- Planner external p95 must be at most 3ms; Canvas scene-build-plus-draw p95 must be at most 4ms; no measured acceptance-journey long task may exceed 50ms.
- Final simulation is exactly 3 stages × 5 policies × 50 seeds = 750 cases. Do not run a larger matrix.
- Preserve campaign reducer, save, replay, reward reservation, hacking economy, audit, hidden bomb, focus, screen-reader, reduced-motion, and mute behavior.
- Before changing tests, read `superpowers:test-driven-development` and `writing-good-tests.md` in full. Follow red-green-refactor.
- Stage only paths named by the active task. Never use `git add -A` or `git add .`.
- Do not modify any path owned by the parallel hacking/dialogue worktree.

## File ownership

### New combat modules

| Path | Responsibility |
|---|---|
| `src/features/resources/resourceSnakeInput.ts` | Key edges, 24ms chord, reverse rejection, two-slot queue, fixed-step consumption. |
| `src/features/resources/resourceSnakeInput.test.ts` | Exact input timing and ordering. |
| `src/features/resources/resourceSnakeCyanProfile.ts` | The only AI timing, speed, role, and stage profile. |
| `src/features/resources/resourceSnakeCyanProfile.test.ts` | Exact profile and stage mapping. |
| `src/features/resources/resourceSnakePlannerTypes.ts` | Serializable planner snapshot, candidate, plan, score, and group result types. |
| `src/features/resources/resourceSnakeTrajectory.ts` | Eight-direction rollout, plan sampling, bounded caches, safe nonzero fallback. |
| `src/features/resources/resourceSnakeTrajectory.test.ts` | Discrete rollout and sampling correctness. |
| `src/features/resources/resourceSnakeAiController.ts` | Cyan deploy/cruise/telegraph/commit/recover/defeated state authority. |
| `src/features/resources/resourceSnakeAiController.test.ts` | State timing, stable telegraph, fatal override, nonzero recovery. |
| `src/features/resources/resourceSnakeCanvas.ts` | Industrial Canvas field, continuous rails, angular cores, telegraphs, bounded effects. |
| `src/features/resources/resourceSnakeVisualLanguage.ts` | Cyan, player, role silhouette, and resource-glyph mappings local to combat. |
| `src/features/resources/resourceSnakeVisualLanguage.test.ts` | Orthogonal visual mappings. |
| `src/features/resources/resourceSnakeCyanSimulation.test.ts` | Exact 750-case public-boundary simulation. |

### Existing combat modules

| Path | Responsibility in this plan |
|---|---|
| `src/features/resources/resourceSnakeRuntime.ts` | Constant-speed hard turns, headings, input state, turn vertices, existing collision/reward authority. |
| `src/features/resources/resourceSnakeEncounter.ts` | Three cyan encounter stages and pressure/blocker assignment. |
| `src/features/resources/resourceSnakePlanner.ts` | Snapshot observation, cyan scoring, group reservation, deterministic fallback. |
| `src/features/resources/resourceSnakeScheduling.ts` | One shared cyan planning cadence and plan-expiry deadline. |
| `src/features/resources/resourceSnakePresentation.ts` | Pure runtime/controller-to-scene projection. |
| `src/features/resources/ResourceSnakeBoard.tsx` | Input listeners, fixed-step loop, group planning, Canvas lifecycle, diagnostics. |
| `src/features/resources/useResourceSnakeAudioFeedback.ts` | Combat-only deduplicated cues and movement hum. |
| `src/styles/resource-snake.css` | Arena sizing, isolation frame, focus, deployment, reduced motion. |
| `e2e/resource-snake.ts` | Real tap/chord helpers and combat state preparation. |
| `e2e/game.spec.ts` | Combat journeys only; this file is locked to the combat session during parallel work. |
| `e2e/modern-sf.spec.ts` | Combat viewport acceptance only; locked to the combat session. |

## Task 1: Pure eight-direction input queue

**Files:**

- Create `src/features/resources/resourceSnakeInput.ts`
- Create `src/features/resources/resourceSnakeInput.test.ts`

- [ ] Write failing tests for WASD/arrows, normalized diagonals, W→D and D→W within 24ms, the 24/25ms boundary, reverse rejection, same-heading dedupe, key-repeat rejection, two-slot cap, release, blur, and one-turn-per-step ordering.
- [ ] Run `pnpm exec vitest run src/features/resources/resourceSnakeInput.test.ts` and confirm the intended failures.
- [ ] Implement immutable `SnakeDirection8`, `ResourceSnakeInputState`, `pressResourceSnakeKey`, `releaseResourceSnakeKey`, `flushResourceSnakeChord`, `consumeResourceSnakeTurn`, and `resetPressedSnakeKeys`.
- [ ] Use frozen lookup tables. Sanitize non-finite timestamps. Never use current held-key vectors as movement authority.
- [ ] Re-run the focused test, typecheck, and lint.
- [ ] Commit only the two input files with `feat: add eight-direction lightcycle input queue`.

## Task 2: Always-moving runtime and exact turn vertices

**Files:**

- Modify `src/features/resources/resourceSnakeRuntime.ts`
- Modify `src/features/resources/resourceSnakeRuntime.test.ts`
- Modify `src/features/resources/resourceSnakeSimulation.test.ts`
- Modify `src/features/resources/resourceSnakeRewardBridge.test.ts`
- Modify `src/features/resources/ResourceSnakeRewardFlights.test.tsx`

- [ ] Replace tests that require idle, acceleration, or deceleration with failing tests for immediate full-speed deployment, direct hard turns, normalized diagonal speed, reverse rejection through input authority, and no live speed below 92% of configured speed.
- [ ] Add `heading`, `input`, and presentation-only `railVertices` to runtime state. Keep collision-trail samples unchanged.
- [ ] Consume no more than one player turn before each fixed step. Absent or malformed commands retain the current legal heading.
- [ ] Append the exact pre-movement point when heading changes; remove collinear visual vertices without altering collision samples.
- [ ] Preserve collision, damage, death, reward idempotency, reservation, and frame-partition determinism.
- [ ] Run the five focused suites, typecheck, and lint.
- [ ] Commit only the listed runtime and regression files with `feat: make resource combat an always-moving lightcycle`.

## Task 3: One cyan profile and three encounter stages

**Files:**

- Create `src/features/resources/resourceSnakeCyanProfile.ts`
- Create `src/features/resources/resourceSnakeCyanProfile.test.ts`
- Modify `src/features/resources/resourceSnakeEncounter.ts`
- Modify `src/features/resources/resourceSnakeEncounter.test.ts`
- Modify `src/features/resources/resourceSnakeRuntime.ts`
- Modify `src/features/resources/resourceSnakeRuntime.test.ts`

- [ ] Write failing assertions for profile tiers 10/12/14Hz, 1.4/1.8/2.2s lookahead, at least 160ms telegraph, 180–260ms commit, and the approved pressure/blocker speeds.
- [ ] Define only `SnakeDoctrine = 'readable-hunter'`; do not add a red literal or generic second-doctrine registry.
- [ ] Define `cyan-intro`, `cyan-advanced`, and `cyan-dual-role` encounter stages from campaign progress without changing saved state.
- [ ] Reserve real eligible reward blocks before deployment exactly as the current encounter does.
- [ ] Keep every enemy cyan and set initial heading and role deterministically.
- [ ] Run profile, encounter, runtime, reward, type, and lint checks.
- [ ] Commit only the listed files with `feat: define cyan lightcycle encounters`.

## Task 4: Eight-direction planner and cyan AI controller

**Files:**

- Create `src/features/resources/resourceSnakePlannerTypes.ts`
- Create `src/features/resources/resourceSnakeTrajectory.ts`
- Create `src/features/resources/resourceSnakeTrajectory.test.ts`
- Create `src/features/resources/resourceSnakeAiController.ts`
- Create `src/features/resources/resourceSnakeAiController.test.ts`
- Modify `src/features/resources/resourceSnakePlanner.ts`
- Modify `src/features/resources/resourceSnakePlanner.test.ts`
- Modify `src/features/resources/resourceSnakeScheduling.ts`
- Modify `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify `vitest.performance.config.ts`

- [ ] First pin the existing public planner behavior and cache isolation in tests.
- [ ] Extract public types and trajectory sampling from the oversized planner without a runtime import cycle.
- [ ] Remove continuous-turn acceleration templates and zero-speed candidates. Generate legal eight-heading sequences ordered deterministically.
- [ ] Hold `originHeading` through the advertised telegraph prefix, then apply the committed attack heading. Visible intent, actual turn, and swept occupancy must describe the same future path.
- [ ] Implement `deploy`, `cruise`, `telegraph`, `commit`, `recover`, and `defeated`. Only a newly fatal plan may interrupt telegraph/commit.
- [ ] Replan the cyan group on one shared cadence. Retain safe commitments as ally occupancy and plan pressure before blocker.
- [ ] Use maximum-clearance legal heading at 0.92 as malformed-snapshot fallback; never return a zero vector.
- [ ] Run planner, trajectory, controller, scheduling, Board, and performance suites. Require external planner p95 ≤ 3ms.
- [ ] Commit only the listed files with `feat: add deterministic cyan lightcycle planning`.

## Task 5: Continuous rails and angular cyan cores

**Files:**

- Create `src/features/resources/resourceSnakeCanvas.ts`
- Create `src/features/resources/resourceSnakeVisualLanguage.ts`
- Create `src/features/resources/resourceSnakeVisualLanguage.test.ts`
- Modify `src/features/resources/resourceSnakePresentation.ts`
- Modify `src/features/resources/resourceSnakePresentation.test.ts`
- Modify `src/styles/resource-snake.css`

- [ ] Replace failing dot/circle expectations with a pure scene containing exact rail polylines, heading radians, role silhouettes, glyphs, telegraphs, danger edges, contact arcs, fragments, and power cuts.
- [ ] Map the player to white/blue-white and every enemy to cyan. Map pressure/blocker to different silhouettes and resource type to an inner glyph.
- [ ] Build visual rail points from live collision trail, exact turn vertices, and the current head. Remove only collinear middle points.
- [ ] Draw rails as outer glow, cyan/white midline, and inner power line with butt caps and miter joins.
- [ ] Use local-space angular polygons rotated by heading. Do not render segmented insect bodies or round head dots.
- [ ] Bound every effect list and lifetime. Under reduced motion, keep state and direction while removing shake, sparks, travel, and afterimage.
- [ ] Run presentation, visual-language, type, lint, and style-boundary tests.
- [ ] Commit only the listed files with `feat: render industrial cyan lightcycle combat`.

## Task 6: Board input, Canvas lifecycle, diagnostics, and combat audio

**Files:**

- Modify `src/features/resources/ResourceSnakeBoard.tsx`
- Modify `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify `src/features/resources/resourceSnakeRuntime.ts`
- Modify `src/features/resources/resourceSnakeRuntime.test.ts`
- Modify `src/features/resources/resourceSnakeSimulation.test.ts`
- Modify `src/features/resources/useResourceSnakeAudioFeedback.ts`
- Modify `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`
- Modify `src/audio/gameSounds.ts`
- Modify `src/audio/audioEngine.test.ts`

- [ ] Write failing integration tests for keydown timestamps, 24ms chord flushing, one command per fixed step, focus/modal exclusion, blur cleanup, runtime suspension, and unmount cleanup.
- [ ] Replace held-key steering with the pure input queue and one shared cyan group-planning deadline.
- [ ] Create one Canvas context, resize with device-pixel ratio, render only from the pure scene, and clean up RAF/listeners/observers.
- [ ] Store the latest 120 finite scene-build-plus-draw samples in a fixed ring buffer and publish p95/max diagnostics every 30 frames.
- [ ] Add deduplicated combat-only cues for queue, applied turn, rejected reverse, cyan telegraph, contact, rail break, death, reward, and movement hum.
- [ ] Do not edit `App.tsx`, `main.tsx`, event, hacking, dialogue, or global signal files.
- [ ] Run Board, runtime, simulation, audio, type, lint, and build checks.
- [ ] Commit only the listed files with `feat: integrate cyan lightcycle combat`.

## Task 7: Cyan intelligence, fairness, roles, and exactly 750 simulations

**Files:**

- Modify `src/features/resources/resourceSnakePlannerTypes.ts`
- Modify `src/features/resources/resourceSnakePlanner.ts`
- Modify `src/features/resources/resourceSnakePlanner.test.ts`
- Modify `src/features/resources/resourceSnakeAiController.ts`
- Modify `src/features/resources/resourceSnakeAiController.test.ts`
- Modify `src/features/resources/resourceSnakeEncounter.ts`
- Modify `src/features/resources/resourceSnakeEncounter.test.ts`
- Create `src/features/resources/resourceSnakeCyanSimulation.test.ts`

- [ ] Write failing fixtures proving cyan selects a survivable future intersection over direct head pursuit, retains at least one advertised response path, and reserves different endpoint/exit sectors for pressure and blocker.
- [ ] Score in this order: survival, self escape, response-path floor, reachable area, ally clearance, intersection lead, player-area reduction, steering cost, deterministic candidate index.
- [ ] Keep the telegraphed plan stable unless it becomes fatal. Never read future input or waive collision rules.
- [ ] Implement the real public-boundary simulation with stages `cyan-intro`, `cyan-advanced`, `cyan-dual-role`; policies `straight`, `clockwise`, `counter-clockwise`, `alternating`, `space-maximizer`; and seeds 0–49.
- [ ] Assert `caseCount === 750`, all 15 stage-policy cells have 50 cases, and all unforced boundary/self/ally collisions, duplicate reservations, zero-speed frames, missing commitments, response-path violations, future-input reads, collision bypasses, predicted suicides with a safe alternative, and fallbacks equal zero.
- [ ] Record planner timing without feeding it back into decisions and require external p95 ≤ 3ms.
- [ ] Run the 750-case suite once after code stabilizes. Re-run it only if runtime, planner, controller, encounter, or simulation rules change.
- [ ] Convert every discovered failing seed into a focused fixed regression before changing the score.
- [ ] Run focused correctness, 750-case, and performance checks.
- [ ] Commit only the listed files with `feat: complete readable cyan hunter AI`.

## Task 8: Production browser gate and mandatory user stop

**Files:**

- Modify `e2e/resource-snake.ts`
- Modify `e2e/game.spec.ts`
- Modify `e2e/modern-sf.spec.ts`
- Modify `src/features/resources/ResourceSnakeBoard.tsx`
- Modify `src/features/resources/ResourceSnakeBoard.test.tsx`

- [ ] Replace held-key helpers with exact tap and chord helpers.
- [ ] Test continuous movement, 8-direction chords, reverse rejection, two queued taps surviving a 60ms main-thread delay, nonzero enemy speed, 160ms cyan telegraph, distinct pressure/blocker silhouettes, continuous rails, reward idempotency, reservation, reload, and no-eligible-resource behavior.
- [ ] Capture 1280×720, 1366×650, and 1440×900 evidence for idle, active, telegraph, dual role, damage, and death.
- [ ] Measure Canvas p95 ≤ 4ms and maximum ≤ 50ms; install a real Long Task observer and require no acceptance-journey entry above 50ms.
- [ ] Run, separately, `pnpm typecheck`, `pnpm lint`, relevant unit/component tests, the exact 750-case suite, `pnpm test:performance`, `pnpm build`, and focused Playwright combat journeys.
- [ ] Commit only the five listed files with `test: verify cyan lightcycle combat in browser`.
- [ ] Inspect port 4173. Stop only a verified repository-owned old preview; do not terminate an unrelated listener.
- [ ] Start `pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort` from the verified production build.
- [ ] Verify HTTP 200, `data-combat-loop="lightcycle-8way"`, and `data-field-rendering="continuous-rail"` in the actual browser.
- [ ] Report the commit, exact test evidence, measured timings, and URL.
- [ ] **STOP. Wait for the user to play. Do not merge the hacking/dialogue branch or begin new scope before explicit user direction.**

## Completion boundary

The combat stream is complete only when all eight tasks are committed, exactly 750 simulations pass, all three browser sizes pass, the production preview is reachable, and the user can play it. No red or mixed-doctrine code may exist in the completed diff.
