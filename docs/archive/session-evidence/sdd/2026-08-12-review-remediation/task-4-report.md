# Task 4 report — separation boundary, bombs, and evidence secrecy

Status: DONE

## Scope delivered

- Added the typed, replayable `BEGIN_BLOCK_SEPARATION` command for divert and audit-disguise intent.
- Enforced an 8 px Euclidean pointer boundary and an equivalent keyboard-confirmation boundary.
- Kept click-only and sub-threshold interactions inert and visually indistinguishable for normal and bomb blocks.
- Prevented separation when reserve capacity/destination validation fails.
- Kept normal separation side-effect free until one valid final move command; invalid drop, cancel, and Escape leave gameplay state unchanged.
- Activated hidden bombs immediately and exactly once on separation, including audit disguise, with +15 suspicion, interrogation/auto-pause, no reserve grant, cleared transfer state, and an ordinary normal company block afterward.
- Added command persistence validation and deterministic replay coverage.
- Removed cumulative `hiddenEvidence` disclosure from production UI and terminal causal summaries while preserving exact public suspicion.
- Added immutable qualitative sabotage-node trace-risk labels (`low`, `medium`, `high`) from node definitions.

## RED evidence

- Engine/reducer/persistence/replay focused run: **13 failed, 63 passed**. Failures demonstrated the missing typed separation command, command validation/replay handling, separation-before-move enforcement, and threshold-time bomb activation.
- ResourceBoard focused run: **9 failed, 8 passed**. Failures demonstrated missing 7.9/8.0 threshold behavior, exactly-once dispatch, click-only/full-reserve guards, keyboard equivalence, post-threshold abort protection, and preview parity.
- Evidence UI focused run: **4 failed, 12 passed**. Failures demonstrated live cumulative evidence disclosure, terminal cumulative evidence disclosure, and missing immutable qualitative node risk.

Production changes were made only after each focused RED run failed for the expected missing behavior.

## GREEN and final verification

- Focused engine/reducer/persistence/replay: **4 files, 76 tests passed**.
- Focused ResourceBoard after implementation: **17 tests passed**; reduced-motion coverage was subsequently added and included in the full suite.
- Focused evidence UI: **2 files, 16 tests passed**.
- Final unit suite: `pnpm test:run` — **31 files, 273 tests passed** in 10.18 s.
- Typecheck: `pnpm typecheck` — exit 0.
- Lint: `pnpm lint` — exit 0, no warnings.
- Production build: `pnpm build` — exit 0; 52 modules transformed.
- Browser journeys: `pnpm test:e2e` — **9 passed** in 30.1 s, including pointer and keyboard bomb activation journeys.
- Patch hygiene: `git diff --check` — exit 0 (repository line-ending notices only).
- Production disclosure scan: remaining `hiddenEvidence` references are internal model/engine/persistence calculations or the terminal-summary removal filter; no production UI renders cumulative evidence.

## Files in commit scope

- `e2e/game.spec.ts`
- `src/features/events/EventLayer.test.tsx`
- `src/features/events/EventLayer.tsx`
- `src/features/hacking/HackingPanel.test.tsx`
- `src/features/hacking/HackingPanel.tsx`
- `src/features/resources/ResourceBoard.test.tsx`
- `src/features/resources/ResourceBoard.tsx`
- `src/game/bombs.test.ts`
- `src/game/bombs.ts`
- `src/game/endings.test.ts`
- `src/game/hacking.ts`
- `src/game/model.ts`
- `src/game/persistence.test.ts`
- `src/game/persistence.ts`
- `src/game/reducer.test.ts`
- `src/game/reducer.ts`
- `src/game/replay.test.ts`
- `src/game/story.ts`

This report is intentionally ignored and is not part of the product commit.

## Self-review

- Normal separation does not alter resource, performance, or suspicion state.
- A final normal move still requires a matching immediately preceding separation command and dispatches once.
- Bomb eligibility is checked before hidden state is inspected, preventing activation without a valid reserve destination.
- Bomb activation clears pending drag/transfer state and cannot be evaded or repeated by pointerup or Escape.
- Audit interruption preserves audit pause ownership and resumes the audit flow after interrogation.
- Qualitative trace risk is definition-owned and immutable; public suspicion remains exact.
- Changes are limited to Task 4 product and test areas; Task 5/6 configuration and presentation work were not modified.

## Concerns

None. The first final unit-test retry hit a Windows sandbox `spawn EPERM` while Vite launched its helper; the identical command was rerun outside the sandbox and passed completely. This was environmental, not a product failure.

---

## Fix round 1/5 — legacy v1 command replay compatibility

Status: DONE

### Reviewer issue reproduced

The v1 save format historically recorded successful `DIVERT_BLOCK` and `MOVE_BLOCK_FOR_AUDIT` transfers as one command. Task 4 made the current reducer require an immediately preceding `BEGIN_BLOCK_SEPARATION`, so replaying those valid v1 logs stopped at `SEPARATION_REQUIRED`.

### Genuine legacy fixture

- Created a temporary detached worktree at `a2f3d0b`, the exact pre-Task-4 commit.
- Ran that historical engine to produce `src/test/legacy-v1-transfer-save.json` via its v1 `encodeSave` implementation.
- The immutable 23,237-byte fixture contains 31 accepted historical commands: sequence 1 is a successful normal `DIVERT_BLOCK`, sequence 31 is a successful normal `MOVE_BLOCK_FOR_AUDIT`, and there are no synthetic separation commands.
- Removed the temporary worktree after capturing and validating the fixture.

### RED evidence

Focused command: `pnpm exec vitest run src/game/persistence.test.ts src/game/replay.test.ts src/game/reducer.test.ts`

- **3 files failed; 5 tests failed, 65 passed.**
- Expected failures showed new saves still emitted v1, the future-version response still advertised v1, legacy reducer transfers were rejected, and the genuine v1 replay stopped on the first transfer.

### Protocol design and GREEN behavior

- Added explicit typed command protocol versions `1 | 2`.
- New campaigns, serialized saves, and the current storage key use protocol/save version 2.
- Loading checks the v2 key first and falls back to the historical v1 key without rewriting or deleting it.
- `decodeSave` validates each envelope against its declared protocol and continues applying the Task 3 story/terminal normalization to v1 states.
- `replayCommands` now requires the caller to pass the decoded envelope protocol explicitly; malformed or unseparated v2 logs are never treated as v1.
- v2 keeps the strict matching `BEGIN_BLOCK_SEPARATION` precondition.
- v1 replay runs the historical separation validation and bomb-trigger semantics but logs only the original transfer command. It never inserts a synthetic BEGIN, preserving command count, sequence, service days, and RNG behavior.
- v1 validation rejects malformed transfer payloads and v2-only BEGIN payloads.

Focused GREEN:

- Persistence/replay/reducer: **3 files, 70 tests passed**.
- Persistence/replay/reducer/GameProvider autosave boundary: **4 files, 77 tests passed**.

### Final verification

- `pnpm test:run` — **31 files, 280 tests passed** in 12.00 s.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0, no warnings.
- `pnpm build` — exit 0; 52 modules transformed.
- `pnpm test:e2e` — **9 passed** in 30.4 s.
- `git diff --check` — exit 0 (repository line-ending notices only).

### Fix-round commit scope

- `src/game/createCampaign.ts`
- `src/game/model.ts`
- `src/game/persistence.test.ts`
- `src/game/persistence.ts`
- `src/game/reducer.test.ts`
- `src/game/reducer.ts`
- `src/game/replay.test.ts`
- `src/test/legacy-v1-transfer-save.json`

### Concerns

None. Removing the temporary Windows worktree junction caused pnpm to restore the current worktree dependencies before the full unit run; lockfile and tracked source were unchanged, and all verification then completed successfully.

---

## Fix round 2/5 — persisted v1-to-v2 command boundary

Status: DONE

### Reviewer issue reproduced

Loading the genuine v1 fixture and accepting current commands worked in memory, but `encodeSave` changed the whole state/envelope to v2 without preserving that the first 31 commands used v1 transfer semantics. Replaying the resulting save as all-v2 stopped on the unchanged sequence-1 `DIVERT_BLOCK`.

### RED evidence

Focused command: `pnpm exec vitest run src/game/persistence.test.ts`

- **1 file failed; 7 tests failed, 37 passed.**
- Expected failures covered missing v1 boundary derivation, missing v2 boundary persistence, negative/out-of-range/mismatched boundary acceptance, forged v2 BEGIN inside a legacy prefix, and native-v2 boundary metadata omission.

### GREEN design

- Added typed `CommandProtocolMetadata { version, legacyCommandCount }`.
- Native v2 campaigns start with immutable boundary `0`.
- Genuine v1 decode derives a boundary equal to the original command-log length without changing or inserting commands.
- v2 saves persist the boundary in the envelope and state; decode requires exact agreement.
- Every command index below the boundary is validated and replayed with v1 semantics. Every suffix command is validated and replayed with strict v2 semantics.
- Live dispatch remains strict v2 after load, so the continued fixture suffix contains `RESOLVE_AUDIT`, `BEGIN_BLOCK_SEPARATION`, and `DIVERT_BLOCK`.
- The end-to-end continued save remains at 34 commands, keeps the original 31-command prefix byte-for-command, contains no synthetic BEGIN in that prefix, and replays to deep-equal state/log/sequence/service day.
- Validation rejects negative/range-invalid boundaries, state/envelope mismatch, a forged legacy prefix containing v2-only BEGIN, and lowering 31 to 30 so the historical audit move becomes an unseparated v2 suffix command.
- Task 3 terminal v1 normalization remains covered with the real v1 envelope shape.

### Verification

- Initial persistence GREEN: **44/44 passed**.
- Focused persistence/replay/reducer/GameProvider: **4 files, 83 tests passed**.
- `pnpm test:run` — **31 files, 286 tests passed** in 10.08 s.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0, no warnings.
- `pnpm build` — exit 0; 52 modules transformed.
- `pnpm test:e2e` — **9 passed** in 30.2 s.
- `git diff --check` — exit 0 (repository line-ending notices only).

### Fix-round commit scope

- `src/game/createCampaign.ts`
- `src/game/model.ts`
- `src/game/persistence.test.ts`
- `src/game/persistence.ts`
- `src/game/replay.test.ts`

### Concerns

None.
