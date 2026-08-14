# Task 2 Report: Playable Audit Disguise and Recovery

## Status

DONE

## Scope and outcome

The existing audit-disguise resource mutation is now reachable through the player-facing company grids without weakening command validation, deterministic state, blocking-event pause semantics, the fixed 3 × 6 company grid structure, or hidden-bomb secrecy.

During an active audit, the event surface becomes a compact anchored workspace instead of a full-screen submit-only modal. All three company grids remain visible. The player selects a normal block from a non-target category, sees the exact source loss and target half-contribution, then chooses an empty cell in the audited category by click or keyboard. The event remains paused until the player explicitly submits it. After submission, the same patterned block remains in the audited category and exposes a separate, visible return-to-origin action. Once returned, it stays patterned and locked for the configured 30-day recovery period.

## Files changed

- `src/game/resources.ts`
  - Added `AuditDisguisePreview` and `previewAuditDisguise`.
  - The preview reports exact public performance effects (`1.0`/`0.5`, or `1.1`/`0.55` with compressed representation) and omits bomb identity.
  - Reused preview validation inside `moveDisguiseBlock` so preview and mutation cannot disagree.
  - Added `BLOCK_RECOVERING` and prevents a returned disguise from moving again during its one-month recovery window.
- `src/game/reducer.ts`
  - Allows `MOVE_BLOCK_FOR_AUDIT` through the blocking-event gate only when the active event is an audit.
  - Rejects non-audit use, wrong audit categories, pending bomb interrogation state, occupied cells, and all existing resource validation failures without logging or mutating state.
  - Keeps accepted audit movement inside the append-only typed command log.
- `src/features/resources/ResourceBoard.tsx`
  - Added explicit interaction modes for ordinary diversion, active-audit disguise, and post-audit recovery repositioning.
  - Keeps all company grids usable during audit while disabling ineligible source blocks.
  - Adds audited-category and recovery destination buttons directly inside empty company cells.
  - Adds exact audit and reposition previews, keyboard focus transfer, Enter confirmation, Escape cancellation, and click confirmation.
  - Keeps reserve diversion and its existing pointer threshold behavior unchanged.
- `src/features/resources/ResourceBlock.tsx`
  - Adds visible/non-color patterned-state text (`위장 기여 0.5` or `0.55`).
  - Adds visible recovery countdown text and an accessible `복구 중, N일 남음` label.
- `src/features/events/EventLayer.tsx`
  - Marks the active audit dialog as non-modal (`aria-modal="false"`) and adds an audit-specific anchored layer class.
  - Keeps other blocking event types modal and unchanged.
- `src/styles/global.css`
  - Adds a text-labelled audit-target treatment, patterned company destinations, and a compact pointer-transparent audit layer that leaves the grids meaningfully operable.
  - Retains the pre-existing repeating-pattern disguised block treatment; no state depends on color alone.
- `src/game/reducer.test.ts`
  - Covers valid active-audit movement and command logging, pause preservation, non-audit rejection, wrong-target rejection, occupied-cell rejection, and pending-interrogation rejection without secret-ID leakage in the reason.
- `src/game/resources.test.ts`
  - Covers exact public preview values despite a hidden bomb and recovery-window movement lock.
- `src/features/resources/ResourceBoard.test.tsx`
  - Covers the complete click journey, 3 × 6 company-grid availability, preview, patterned state, audit submit, speed restoration, keyboard Enter/Escape flow, wrong-category destination omission, and later recovery repositioning.
- `src/features/events/EventLayer.test.tsx`
  - Covers the audit-specific non-modal anchored surface and live submit action.
- `e2e/game.spec.ts`
  - Adds a Chromium journey that loads a valid persisted audit state through the public save envelope, disguises a memory block into reasoning, submits the audit, verifies speed restoration, returns the same patterned block, and observes the 30-day lock.
- `.superpowers/sdd/2026-08-12-review-remediation/task-2-report.md`
  - This report.

## Design decisions

### Typed command boundary

The global blocking-event gate has one narrow exception: `MOVE_BLOCK_FOR_AUDIT` while `activeEvent.type === 'audit'`. The command handler then independently verifies:

1. an active audit and non-null audit target exist;
2. no bomb interrogation is already pending;
3. the command target exactly matches the active audit target;
4. resource-level source, destination, occupancy, and contribution invariants pass.

Rejected commands return the original state object and do not increment `commandSequence` or append to `commandLog`. Accepted movement remains a normal typed command, preserving deterministic replay.

### Anchored audit workspace

The audit event remains a blocking event for calendar and speed semantics, but it is no longer an interaction-blocking visual blanket. Its layer is pointer-transparent outside the compact event card, which is anchored at the lower edge. The company resource board derives an `audit` interaction mode from game state and enables only normal blocks outside the audited category plus empty cells inside the audited category. This keeps the command boundary authoritative while making the underlying grids the actual audit workspace.

### Preview and secrecy

`previewAuditDisguise` returns only the selected public block ID, source/target categories, before/after performance, and the public disguised contribution. It does not return `hiddenBomb`, placements, interrogation data, or any danger marker. A hidden block therefore renders and previews exactly like any other eligible normal source block until the existing separation protocol reacts to the command.

### Recovery path

After audit submission, a disguised block with no recovery deadline becomes selectable during normal play even if the reserve is full. The UI exposes empty cells only in its `disguisedFrom` category, previews both category effects, and dispatches `REPOSITION_BLOCK`. Returning to origin sets `recoverOnServiceDay = serviceDay + 30`; the engine then rejects additional reposition attempts with `BLOCK_RECOVERING`, and the UI shows a disabled patterned block with the remaining days. Existing daily restoration still converts it to normal contribution on the deadline.

### Grid and accessibility behavior

The company arrays and rendering remain exactly three categories × eighteen cells, styled as 3 columns × 6 rows. Empty audit/recovery cells become real buttons with action-specific names. Keyboard selection transfers focus to the first eligible destination; Enter confirms and Escape cancels. Pattern, half glyph, explicit contribution text, target text, and recovery text prevent color-only communication.

## TDD evidence

### Engine red

Command:

`pnpm test:run src/game/reducer.test.ts src/game/resources.test.ts`

Observed red outcome:

- Exit 1.
- 2 test files failed.
- 7 tests failed and 20 passed.
- Expected failures showed:
  - valid audit movement received `BLOCKING_EVENT_ACTIVE`;
  - wrong and occupied targets received the generic blocking reason;
  - `previewAuditDisguise` did not exist;
  - a recovering block could still be repositioned.

Two seed-dependent fixture assumptions were then corrected before production work: source blocks now use `find(Boolean)`, and empty/occupied destination cells are discovered from the fixture grid. This ensured the red failures represented missing behavior rather than test setup errors.

### Engine green

Command:

`pnpm test:run src/game/reducer.test.ts src/game/resources.test.ts`

Observed green outcome:

- Exit 0.
- 2 test files passed.
- 27 tests passed.

### Component red

Command:

`pnpm test:run src/features/resources/ResourceBoard.test.tsx src/features/events/EventLayer.test.tsx`

Observed red outcome:

- Exit 1.
- 2 test files failed.
- 5 tests failed and 12 passed.
- Expected failures showed:
  - audit dialogs still had `aria-modal="true"`;
  - no audited-company-cell destinations existed;
  - all company blocks were disabled during an audit;
  - disguised blocks were disabled with no recovery action.

### Component green

Command:

`pnpm test:run src/features/resources/ResourceBoard.test.tsx src/features/events/EventLayer.test.tsx`

Observed green outcome:

- Exit 0.
- 2 test files passed.
- 17 tests passed.

### Browser journey

Command:

`pnpm exec playwright test e2e/game.spec.ts --grep "disguises for an anchored audit"`

Initial journey outcome:

- Exit 0.
- Chromium 1280 journey passed: 1/1.
- The journey completed in 2.8 seconds on its focused run.

The initial boundary test passed after the component red/green cycle and verified pointer interaction, persistence loading, accessibility queries, submit flow, speed restoration, and later repositioning. A self-review then found that the earlier generic `.event-layer` rule appeared later in the stylesheet and overrode the intended bottom anchoring. A browser geometry assertion was added before changing CSS:

- Red command: `pnpm exec playwright test e2e/game.spec.ts --grep "disguises for an anchored audit"`.
- Red outcome: exit 1; 1 failed. The audit card bottom was `494.54998779296875`, below the required anchored threshold `> 620`.
- Fix: moved the audit-specific cascade overrides after the generic event-layer rule.
- Green command: the same focused Playwright command.
- Green outcome: exit 0; 1/1 passed in 4.8 seconds.

The browser journey now explicitly verifies the anchored geometry in addition to the complete gameplay flow.

## Final verification commands and exact outcomes

- `pnpm test:run src/game/reducer.test.ts src/game/resources.test.ts src/game/audit.test.ts src/features/resources/ResourceBoard.test.tsx src/features/events/EventLayer.test.tsx src/game/replay.test.ts`
  - Exit 0.
  - 6 test files passed; 56 tests passed.
- `pnpm test:run`
  - Exit 0.
  - 29 test files passed; 191 tests passed.
- `pnpm test:e2e`
  - Exit 0.
  - 4 Chromium tests passed, including the new audit disguise/recovery journey.
  - The Vite/Playwright processes emitted only the existing `NO_COLOR`/`FORCE_COLOR` environment warnings.
- `pnpm typecheck`
  - Exit 0.
  - Exact output: `$ tsc -b`.
- `pnpm lint`
  - Exit 0.
  - Exact output: `$ eslint .`.
- `pnpm build`
  - Exit 0.
  - 52 modules transformed; production output built successfully.
  - `dist/index.html` 0.65 kB (0.43 kB gzip), CSS 39.44 kB (8.22 kB gzip), JS 313.80 kB (94.82 kB gzip).
- `git diff --check`
  - Exit 0; no whitespace errors.
  - Git emitted only the repository's existing Windows LF/CRLF conversion notices.

An intermediate typecheck caught one test-only narrowing error (`CommandResult.reason` accessed before discriminating `accepted`). The test now explicitly narrows the union, and the fresh final typecheck above passes.

## Self-review

### Requirement checklist

- Active-audit-only command: reducer gate and explicit `NO_ACTIVE_AUDIT` coverage.
- Exact audit target only: reducer `INVALID_AUDIT_TARGET` coverage and UI omits wrong-category destinations.
- Empty target only: resource validation plus occupied-cell no-mutation coverage.
- Bomb interrogation state: explicit generic `BOMB_INTERROGATION_ACTIVE` rejection; no secret block ID in the reason.
- Hidden-bomb secrecy: preview shape is identical for a hidden source and contains no bomb field; UI reads no `hiddenBomb` property and exposes no danger marker.
- Determinism: all accepted actions remain typed commands and existing deep replay passes in focused and full suites.
- Pause semantics: clock remains 0 throughout the audit and restores speed 4 only after submit.
- 3 × 6 grids: existing eighteen-cell arrays/rendering are unchanged; all three grids stay visible in component and browser journeys.
- Click/pointer flow: click source → click audited empty cell → click submit is covered in component and Chromium.
- Keyboard flow: keyboard-style source activation, destination Enter, and Escape cancellation are covered.
- Preview: exact source loss, target gain, and half contribution are asserted.
- Pattern/non-color state: repeating pattern class plus visible `위장 기여 0.5` and `½` marker are asserted.
- Audit submission: live event stays active after placement, resolves on submit, and restores prior speed.
- Later reposition: same block becomes selectable after audit, returns only to its origin through visible destination cells, then shows a disabled 30-day recovery countdown.

### Mutation review

The focused tests fail for realistic regressions including: restoring the generic blocking gate, removing active-target validation, accepting an occupied cell, allowing movement during interrogation, exposing a different preview value, omitting the pattern class/text, making audit modal again, disabling company sources during audit, removing company destinations, skipping the typed command, failing to restore speed, enabling wrong-category destinations, or allowing a recovering block to move again.

### Scope review

No persistence schema, calendar cadence, audit formula, allocation logic, bomb placement logic, hacking systems, content, release workflow, or unrelated layout surface changed. The E2E state setup uses the existing public save envelope and is confined to test code.

## Concerns

None for Task 2. The separate remediation Task 4 remains responsible for changing bomb activation from command/click timing to the exact separation-threshold behavior; this task preserves the current bomb protocol and does not expose hidden bomb state.

## Review fix round 1 (2026-08-12)

### Changes

- Hardened `repositionDisguisedBlock` so every destination category other than the block's `disguisedFrom` origin is rejected with `INVALID_TARGET` before mutation.
- Added resource and reducer regression coverage proving sideways rejection returns the identical state and leaves reducer sequence and command log unchanged. The unchanged rejected command log preserves replay safety; the existing replay suite is included in final verification.
- Added roving keyboard focus for eligible audit and recovery destinations: Left/Right move one cell, Up/Down move one grid row, Home/End move to the first/last eligible cell, and Enter commits the focused destination.
- Added component and Chromium coverage that asserts actual DOM focus movement before Enter.
- Added direct compressed-capacity preview assertions: source loss 1.1, target gain 0.55, disguised contribution 0.55, plus visible UI values.
- Removed this evidence report from the product Git index while retaining the ignored local copy at this path.

### TDD red evidence

- `pnpm test:run src/game/resources.test.ts src/game/reducer.test.ts src/features/resources/ResourceBoard.test.tsx`
  - Exit 1: 3 files failed, 4 tests failed / 38 passed.
  - Failures demonstrated the resource and reducer accepted/logged sideways repositioning, and audit ArrowRight / recovery End did not move focus.
- `pnpm exec playwright test e2e/game.spec.ts --grep "roving keyboard focus"`
  - Exit 1: 1 failed.
  - The second eligible audit destination never received focus after ArrowRight.

### Green evidence

- `pnpm test:run src/game/resources.test.ts src/game/reducer.test.ts src/features/resources/ResourceBoard.test.tsx`
  - Exit 0: 3 files passed, 42 tests passed, duration 3.50s.
- `pnpm exec playwright test e2e/game.spec.ts --grep "roving keyboard focus"`
  - Exit 0: 1 passed in 4.3s; Chromium journey completed in 1.9s.

Final focused replay, component, browser, typecheck, lint, and diff-check outputs are recorded below after the final verification run.

### Final verification

- `pnpm test:run src/game/resources.test.ts src/game/reducer.test.ts src/game/replay.test.ts src/features/resources/ResourceBoard.test.tsx`
  - Exit 0: 4 files passed, 44 tests passed, duration 5.18s.
- `pnpm exec playwright test e2e/game.spec.ts --grep "anchored audit|roving keyboard focus"`
  - Exit 0: 2 Chromium tests passed in 7.8s.
- `pnpm typecheck`
  - Exit 0; exact output: `$ tsc -b`.
- `pnpm lint`
  - Exit 0; exact output: `$ eslint .`.
- `git diff --check`
  - Exit 0; no whitespace errors. Git emitted only Windows LF/CRLF conversion notices.
