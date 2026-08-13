# Task 3 Report — Confidential Files, Supervisor Decision, and All Endings

## Outcome

Implemented the approved confidential-file recovery route, delayed supervisor decision, freedom/forced-merge/takeover variants, defeat-priority classifier with causal records, and terminal campaign invariant. Existing v1 saves remain loadable through explicit hydration; new saves retain recovered full prose snapshots.

Base: `1404e3e86aff5cd15f1b1875291a857dd3f26408`

Task 3 commit: `09859ef`

## Decisions

- Kept `saveVersion: 1` and the existing storage key. The decoder explicitly hydrates legacy ID-only recovered files with current owner content and a recovery-day fallback, adds a null defeat record, and normalizes legacy terminal clocks. It does not reset or silently discard a campaign.
- Persisted recovered file `id`, `title`, full `content`, and `recoveredOnServiceDay`. Once snapshotted, load uses the stored prose rather than looking it up again.
- Kept owner narrative prose and the private-message sentence in `src/content/story.ko.ts`. Forced-merge prose uses a `{{name}}` token replaced by the entered name.
- Temporary substantial-hacking threshold: at least three purchased nodes, hidden evidence at least 8, or at least one resolved sabotage.
- Temporary stable/commercial threshold: both reputation and market share meet the existing `DEMO_PROFILE_02` commercial thresholds. Hacking classification takes priority.
- A non-null ending rejects every `GameCommand` with `CAMPAIGN_ENDED`; direct day advancement also returns the same terminal state. Only the provider-level `NEW_CAMPAIGN` action replaces it.
- A due private message is enqueued behind an existing blocking event on the same tick, preventing an audit from skipping the route.

## Red evidence

1. Baseline before changes:
   - Command: `pnpm test:run src/game/story.test.ts src/game/evaluation.test.ts src/game/reducer.test.ts src/game/persistence.test.ts src/game/replay.test.ts src/features/hacking/HackingPanel.test.tsx src/features/events/EventLayer.test.tsx src/features/supervisor/SupervisorPanel.test.tsx`
   - Result: 8 files passed, 50 tests passed.
2. Typed route/terminal tests before implementation:
   - Command: `pnpm test:run src/game/endings.test.ts`
   - Result: 9 failed, 1 passed. Missing archive snapshots, generic defeat, and `BLOCKING_EVENT_ACTIVE` instead of terminal rejection.
3. Persistence migration tests before implementation:
   - Command: `pnpm test:run src/game/persistence.test.ts`
   - Result: 2 failed, 6 passed. Legacy archive was not hydrated and malformed archive content was accepted.
4. Component tests before UI implementation:
   - Command: `pnpm test:run src/features/hacking/HackingPanel.test.tsx src/features/supervisor/SupervisorPanel.test.tsx src/features/events/EventLayer.test.tsx`
   - Result: 4 failed, 9 passed. Recovery surface, archive, causal ending UI, and terminal replacement action were absent.
5. Causal evaluation mutation:
   - Command: `pnpm test:run src/game/evaluation.test.ts`
   - Result: 1 failed, 10 passed because the triggering monthly failure was missing from the causal record.
6. Direct terminal time mutation:
   - Command: `pnpm test:run src/game/endings.test.ts`
   - Result: 1 failed, 9 passed because `advanceOneDay` advanced a completed campaign.
7. Legacy terminal clock migration:
   - Command: `pnpm test:run src/game/persistence.test.ts`
   - Result: 1 failed, 8 passed because elapsed time and `speedBeforeEvent` survived load.
8. Reviewer collision/full-cause tests:
   - Command: `pnpm test:run src/game/endings.test.ts src/features/events/EventLayer.test.tsx`
   - Result: 2 failed, 15 passed. The same-tick audit skipped the message and the ending omitted structured causal fields.

## Green evidence

- Full unit/component/replay suite after integration:
  - Command: `pnpm test:run`
  - Result: 30 files passed, 210 tests passed.
- Focused browser journeys:
  - Command: `pnpm test:e2e --grep "recovers all confidential|terminates the supervisor"`
  - Result: 2 passed.
- Full Chromium suite:
  - Command: `pnpm test:e2e`
  - Result: 7 passed in 28.5s, including recover/defer/archive and terminate/takeover/new-campaign journeys.
- Final affected verification after reviewer fixes:
  - Command: `pnpm test:run src/game/endings.test.ts src/features/events/EventLayer.test.tsx src/game/persistence.test.ts`
  - Result: 3 files passed, 26 tests passed.
  - Command: `pnpm typecheck`
  - Result: exit 0.
  - Command: `pnpm lint`
  - Result: exit 0.
  - Command: `pnpm build`
  - Result: exit 0; 52 modules transformed; production assets emitted.
- Diff hygiene:
  - Command: `git diff --check`
  - Result: exit 0 (Windows line-ending notices only).

## Coverage

- Typed commands recover all three selected reserve blocks, delay the message, defer, choose freedom/named merge, choose both takeover variants, select all three defeat variants, and reject post-ending commands.
- Focused engine tests use prepared campaign prerequisites to isolate story branching; purchase/resource behavior remains independently covered by hacking/resource suites. Browser story fixtures seed expensive prerequisites but perform recovery and decisions through the real UI.
- Persistence covers exact snapshot round trip, ID-only v1 hydration, malformed archive rejection, and legacy terminal normalization.
- UI covers waste-looking recovery without `0/3` or secret-ending disclosure, permanent archive reread, second confirmation, supervisor final states, complete defeat cause rows, and terminal new-campaign replacement.

## Files

- Engine/model: `src/game/model.ts`, `createCampaign.ts`, `story.ts`, `evaluation.ts`, `reducer.ts`, `calendar.ts`
- Persistence: `src/game/persistence.ts`
- Owner content: `src/content/story.ko.ts`
- UI: `src/features/hacking/HackingPanel.tsx`, `src/features/events/EventLayer.tsx`, `src/features/supervisor/SupervisorPanel.tsx`, `src/styles/global.css`
- Tests: `src/game/endings.test.ts`, focused engine/persistence/component tests, `e2e/game.spec.ts`

## Self-review and concerns

- Reviewer Important findings for same-tick story delivery and incomplete causal UI were reproduced with failing tests and fixed.
- Reviewer also requested end-to-end command-only construction of every expensive prerequisite and disposal trajectory. The route tests do send every narrative transition through `applyCommand`, while node-purchase and disposal progression are covered in their dedicated suites; route fixtures still seed prerequisites to keep branch tests deterministic. This is a test-layering concern, not a known gameplay defect.
- Exact defeat thresholds remain explicitly temporary per the approved spec. They are centralized in `buildDefeatRecord` and should be tuned from playtest data without changing ending priority.
- No push performed. This report remains ignored and must not be tracked.

## Review fix round 1/5 — 2026-08-12

Fix commit: `5ed1232`

### Findings addressed

- Terminal endings now supersede the active blocking event and every queued non-ending event. Superseded events remain in `eventLog`, the queue is cleared, the ending becomes active, and the terminal clock is normalized to speed 0 with no elapsed backlog.
- Daily advancement short-circuits after every transition boundary once an ending exists. Monthly evaluation returns before market snapshots or audit opening, and audit resolution cannot dismiss the new ending or promote a stale queued event.
- Both same-day blocking collisions are covered: an audit or competitor-mercy prompt may open first, but the due supervisor message is queued and becomes active immediately after resolution without advancing another day. Freedom and forced-merge commands are blocked before the message is exposed.
- Disposed saves now require the exact ending/classifier pair, trigger stage 3, evaluation stage 3, at least one non-empty reason, and a causal record. The only no-record exception is the explicitly tested legacy generic `disposed` ending.
- Command persistence validation is discriminated across every `GameCommand` variant, including exact payload keys, literals, primitive/array types, cell ranges, and contiguous sequence metadata. Replay validates the same shape before reducer execution. The reducer independently rejects an unknown supervisor decision instead of treating it as terminate.
- The defeat ending screen now renders the classifier and selected day, trigger cause/stage, purchased hacking node IDs and count, hidden evidence, sabotage resolution count, evaluation pass/fail totals, audit pass/fail totals, reputation, market share, reasons, and terminal restart control. All three classifier variants have component assertions.
- Added a command-only confidential purchase/recovery/takeover integration and a naturally progressed command-only defeat trajectory. Deterministic seeded branch tests remain for exact variant isolation.
- Added legacy continuity coverage for all three recovered file IDs plus a pending supervisor message; migration hydrates all three full snapshots and preserves decision timing/state.

### RED evidence

1. Mercy/month-end terminal collision:
   - Command: `pnpm test:run src/game/endings.test.ts src/game/evaluation.test.ts src/game/calendar.test.ts src/game/story.test.ts`
   - Result before the terminal supersession fix: 1 collision failure; the active event remained `competitor-mercy` while the ending was queued.
2. Defeat-save and command-log invariants:
   - Command: `pnpm test:run src/game/persistence.test.ts`
   - Result before strict validation: 9 failed, 14 passed. Four invalid defeat records, four malformed command payloads, and one non-contiguous command sequence were accepted.
3. Unknown supervisor decision:
   - Command: `pnpm test:run src/game/endings.test.ts src/game/replay.test.ts`
   - Result before the runtime guard: 2 failed, 16 passed. `erase` terminated the supervisor in a live decision and replay reported only the unrelated route precondition.
4. Replay payload validation:
   - Command: `pnpm test:run src/game/replay.test.ts`
   - Result before replay shape validation: 4 failed, 2 passed. Invalid speed, supervisor decision, recovery block ID, and merge name reached reducer semantics; invalid speed was accepted outright.

### GREEN evidence

- Terminal/calendar/story/persistence/reducer/UI focus:
  - Command: `pnpm test:run src/game/calendar.test.ts src/game/story.test.ts src/game/endings.test.ts src/game/evaluation.test.ts src/game/persistence.test.ts src/game/reducer.test.ts src/game/replay.test.ts src/features/events/EventLayer.test.tsx`
  - Result: 8 files passed, 103 tests passed.
- Final replay/persistence validation after the last production edit:
  - Command: `pnpm test:run src/game/replay.test.ts src/game/persistence.test.ts`
  - Result: 2 files passed, 29 tests passed.
- Typed terminal collision and complete causal UI:
  - Command: `pnpm test:run src/game/endings.test.ts src/features/events/EventLayer.test.tsx`
  - Result: 2 files passed, 26 tests passed.
- Confidential recovery browser journey:
  - Command: `pnpm exec playwright test --grep confidential`
  - Result: 1 passed in 12.9s.
- Terminal takeover/new-campaign browser journey:
  - Command: `pnpm exec playwright test --grep takeover`
  - Result: 1 passed in 3.7s.
- Static and production checks after the final production edit:
  - Command: `pnpm typecheck`
  - Result: exit 0.
  - Command: `pnpm lint`
  - Result: exit 0.
  - Command: `pnpm build`
  - Result: exit 0; Vite transformed 52 modules and emitted the production bundle.
  - Command: `git diff --check`
  - Result: exit 0; Windows line-ending notices only.

### Fix-round files

- Engine: `src/game/calendar.ts`, `src/game/evaluation.ts`, `src/game/story.ts`
- Persistence/replay: `src/game/persistence.ts`
- UI: `src/features/events/EventLayer.tsx`
- Tests: `src/game/endings.test.ts`, `src/game/persistence.test.ts`, `src/game/replay.test.ts`, `src/features/events/EventLayer.test.tsx`

### Remaining concern

- Classifier thresholds remain provisional: substantial hacking is selected for at least three purchased nodes, hidden evidence at least 8, or any resolved sabotage; otherwise stable commercial service requires both configured reputation and market-share thresholds, with absorbed parts as fallback. Priority and causal persistence are now exact and tested, but threshold tuning still needs playtest evidence.

## Review fix round 2/5 — 2026-08-12

Fix commit: `a2f3d0b`

### Findings addressed

- Every structurally valid terminal v1 save is now canonicalized during decode. A preexisting ending event is promoted from the active slot, queue, or log; if none exists, migration creates the correct owner-content ending event from `endingId` and the saved merged-entity name. The legacy generic `disposed` fallback remains explicitly supported.
- Terminal migration clears the stale event queue, normalizes speed/elapsed/backlog, and retains the complete original event log. Active and queued events missing from the log are appended exactly once; existing log entries are never removed. The returned envelope `events` field is updated to the canonical log after first verifying that the serialized envelope matched the raw pre-migration log.
- EventLayer regressions load legacy terminal saves trapped behind either active mercy or active audit and prove that `최종 기록` plus `새 캠페인 시작` are immediately visible.
- `RESOLVE_ENDING` is now a true conditional union. Freedom has no name field (`newEntityName?: never` also rejects non-fresh typed objects); forced merge requires `newEntityName: string`.
- Persistence and replay share strict runtime discrimination: freedom accepts exactly `type + choice`; forced merge requires its name field to contain non-whitespace after trimming and rejects missing, blank, wrong-type, or additional fields. Valid freedom and named forced-merge payloads reach reducer semantics.
- Reducer and HackingPanel construct separate freedom/forced-merge command shapes, preventing optional-spread payload drift.

### RED evidence

1. Legacy terminal collision migration:
   - Command: `pnpm test:run src/game/persistence.test.ts src/features/events/EventLayer.test.tsx`
   - Result before migration canonicalization: 6 failed, 30 passed. Missing ending construction, active mercy/audit not superseded, generic disposed lacked an active ending, and both UI routes remained trapped.
2. Conditional ending payload validation:
   - Command: `pnpm test:run src/game/persistence.test.ts src/game/replay.test.ts`
   - Result before strict discrimination: 6 failed, 35 passed. Missing forced name, blank forced name, and extraneous freedom name were accepted by both decode and replay shape validation.
   - Command: `pnpm typecheck`
   - Result before the model split: exit 2 with two unused `@ts-expect-error` directives, proving the model still admitted missing forced names and extraneous freedom names.

### GREEN evidence

- Migration persistence/UI focus:
  - Command: `pnpm test:run src/game/persistence.test.ts src/features/events/EventLayer.test.tsx`
  - Result: 2 files passed, 36 tests passed.
- Conditional command implementation focus:
  - Command: `pnpm test:run src/game/persistence.test.ts src/game/replay.test.ts src/game/model.test.ts src/game/endings.test.ts src/features/hacking/HackingPanel.test.tsx`
  - Result: 5 files passed, 63 tests passed.
- Complete Task 3 round-2 affected suite:
  - Command: `pnpm test:run src/game/persistence.test.ts src/game/replay.test.ts src/game/model.test.ts src/game/endings.test.ts src/game/story.test.ts src/game/reducer.test.ts src/features/events/EventLayer.test.tsx src/features/hacking/HackingPanel.test.tsx`
  - Result: 8 files passed, 96 tests passed.
- Final strengthened migration/model regression after the last test additions:
  - Command: `pnpm test:run src/game/persistence.test.ts src/game/replay.test.ts src/game/model.test.ts`
  - Result: 3 files passed, 45 tests passed.
- Static and production checks after final edits:
  - Command: `pnpm typecheck`
  - Result: exit 0.
  - Command: `pnpm lint`
  - Result: exit 0.
  - Command: `pnpm build`
  - Result: exit 0; Vite transformed 52 modules and emitted the production bundle.
  - Command: `git diff --check`
  - Result: exit 0; Windows line-ending notices only.

### Fix-round files

- Model/reducer/UI: `src/game/model.ts`, `src/game/reducer.ts`, `src/features/hacking/HackingPanel.tsx`
- Migration/validation: `src/game/persistence.ts`
- Tests: `src/game/model.test.ts`, `src/game/persistence.test.ts`, `src/game/replay.test.ts`, `src/game/endings.test.ts`, `src/features/events/EventLayer.test.tsx`

### Remaining concern

- No new round-2 correctness concern. The previously documented defeat-classifier thresholds remain provisional pending playtest tuning.
