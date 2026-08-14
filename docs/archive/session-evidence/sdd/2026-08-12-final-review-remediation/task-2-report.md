# Final Remediation Task 2 Report

## Outcome

Task 2 repairs the three mercy outcomes, adds permanent deletion intelligence,
gives supervisor leak originals a persisted four-real-second presentation, and
routes player-facing enum/ID text through centralized Korean labels. Task 3
trend/review-detail/music scope was not changed.

Local commit: `437e4621026bd485bd87da0020cd45233535438d`
(`fix: repair mercy and supervisor presentation`). It was not pushed.

## Binding behavior implemented

- Mercy resolves in one reducer transition through the canonical current-market
  share calculation. All three choices total 100% immediately. Withdraw/delete
  clear target availability/share and interception route without appending a
  weekly/monthly snapshot; if no competitor remains, the player is 100%.
- Delete snapshots the matching owner-editable Korean intelligence record once,
  with stable ID, competitor identity, acquisition service day, source, title,
  and full prose. Cease/withdraw add none. History exposes pointer/keyboard
  entry and a dismissible focus-trapped/restoring dialog; reload rereads the
  exact saved snapshot.
- Each eligible quiet-point command deterministically appends one original and
  one correction history event and one permanent semantic identity (`id`,
  `stage`, service day, event IDs, and event sequences). An earlier item still
  being presented does not suppress later eligible semantic catalog entries.
  A separate runtime-only `{ itemStage, phase, remainingDwellMs }` checkpoint presents the
  original for 4,000 real milliseconds, then the correction for 4,000 real
  milliseconds. It is independent of 1x/2x/4x, does not pause simulation, does
  not consume hidden or blocking-overlay time, checkpoints partial visible time
  on visibility/pagehide, and resumes the persisted remainder after reload.
- Category, mercy, hack node, disposal, defeat, event, competitor-status, and
  review-sentiment labels are centralized. New stored event prose is Korean.
  Existing snapshot prose is never rewritten; legacy raw IDs are translated
  only at display boundaries.

## RED -> GREEN evidence

| Slice | RED evidence | GREEN evidence |
|---|---|---|
| Mercy market | Story/market focused tests showed withdraw/delete retained an incomplete 60% total when no active competitor remained. | `story.test.ts` + `market.test.ts`: all three choices same-transition 100%, player-only 100%, route removal, same history reference. |
| Delete intelligence | Story/UI/persistence tests initially had no archive grant, round-trip, or reachable dialog. | Exact-once delete grant, cease/withdraw absence, immutable round-trip/default migration, pointer/Enter/Escape/focus tests all pass. |
| Leak dwell | Fake-timer tests initially observed immediate correction/no persisted presentation. | 1x/2x/4x real-time table, persisted remainder, hidden exclusion, pagehide partial checkpoint, blocking-overlay exclusion: hook 7/7 pass. |
| Reload/blocking edge | New tests failed with zero pagehide checkpoint and a 4,000ms callback while a blocking event covered the panel. | Both edges pass; elapsed visible time is flushed once and blocking events start no presentation timer. |
| Replay/save invariants | Forged stage, reversed order, reused or retargeted event references, missing deleted-target intelligence, forged intelligence ID, and intelligence for a live competitor were accepted before new validation. | Persistence rejects each case, including same-day/consecutive/nonblocking pair violations; semantic replay advances all three stages without a wall-clock checkpoint. |
| Legacy owner prose | A v1 fixture whose saved leak/correction prose differed from current content failed migration. | Migration derives completed adjacent supervisor-message pairs structurally, preserves both old strings byte-for-byte, and sets runtime null so nothing redisplays. |
| Same-day legacy supervisor collision | A genuine day-361 command produced `[bomb warning, leak original, correction]`; the first migration scan incorrectly chose warning+original. | Migration groups same-day consecutive nonblocking runs, selects the trailing leak pair after an odd notice prefix, preserves owner-edited prose, and fails closed for ambiguous even runs longer than two. |
| Public labels | EventLayer exposed classifier/node IDs and status/sentiment labels remained local maps; representative tests failed on raw text/missing centralized functions. | Generated-prose token scan plus EventLayer/Supervisor/Market/Review representative UI tests pass; snapshot data remains unchanged. |

## Persistence, migration, and replay boundary

- Save envelope, local manifest, clipboard prefix, and exact progress-file
  output are explicitly version 4 (`PZ4:` / `.pz4`). V4 requires all Task 2
  fields and cross-field invariants. Recomputed integrity cannot make missing
  intelligence/catalog metadata valid.
- V1, v2, and v3 decode only through an explicit legacy migration. The exact
  v3 checkpoint fixture migrates and then round-trips as exact v4. PZ2/PZ3
  imports, v3 local manifests, the historical local root key, journal object
  keys, lock name, and command protocols v1/v2 remain compatible. Future save
  versions are rejected.
- A legacy deleted competitor missing the new field receives exactly one
  owner-content snapshot for that target. Other old saves receive an empty
  archive. Existing archive snapshots and event prose are never rewritten.
- Old completed leak pairs derive only semantic identity from adjacent,
  same-day, consecutive `supervisor-message` events. Their original event IDs,
  sequences, service day, and prose remain unchanged; absent legacy runtime is
  `null`, so completed messages are not replayed on load.
- V4 validates exact keys, stable intelligence ID-to-deleted-competitor mapping,
  exactly one archive per deleted target with no orphan, semantic catalog
  length/stage/order, unique event references, exact referenced service
  day/sequence, original-then-correction adjacency, nonblocking type, and runtime
  identity/phase/range.
- Pure command replay reproduces leak stage, semantic catalog, event IDs,
  sequences, and order exactly without any dwell checkpoint. The whole
  `supervisorPresentationRuntime` cursor is the documented non-command
  wall-clock presentation state normalized for replay comparison; runtime
  checkpoints never enter the command log or create events.
- Reload uses a tiny tab-scoped, versioned, checksummed session marker containing
  only campaign seed, semantic item identity/stage, phase, and remaining dwell.
  It can only reduce the exact persisted matching phase, is ignored and cleared
  when malformed/stale/cross-campaign, and is cleared only after a normal Web
  Locks save covers it. Session-storage failure falls back to the bounded normal
  500ms checkpoint cadence.
- Task 1 validation, linked journal, terminal normalization, atomic local save,
  and Web Locks tests are included in the focused persistence/Provider suites
  and remain passing.

## Verification evidence

- Final affected set before full verification: 14 files, 305/305 passing.
- Independent static review initially found the same-day warning/leak legacy
  pairing defect. Its RED reproduced the wrong event references; focused GREEN
  was 3/3 and persistence+story was 200/200. The same reviewer then returned
  PASS with no Critical/Important findings.
- Targeted Playwright production build: 4/4 passing across Chromium 1280x720
  and 1440x900, covering both required Task 2 journeys. The first attempt
  correctly exposed a stale pre-v4 `dist`; rebuilding produced the recorded
  green run.
- The first post-review `pnpm verify` passed typecheck/lint and reached 517/518
  unit tests. One pre-existing v1 replay assertion compared the migrated
  completed `runtime: null` with pure replay's `original / 4000ms` cursor.
  The test was narrowed to normalize only `supervisorPresentationRuntime` while
  separately retaining exact catalog, full event-log, command-log, sequence,
  and whole remaining-state equality. Focused replay was 17/17 and the same
  reviewer returned PASS on that exact allowed-difference boundary.
- Final fresh `pnpm verify`: **PASS**.
  - TypeScript: PASS.
  - ESLint: PASS.
  - Vitest: **38 files / 518 tests PASS** in 15.69s.
  - Production build: **61 modules PASS** in 223ms; JS 394.44 kB
    (117.31 kB gzip), CSS 47.02 kB (9.39 kB gzip).
  - Playwright: **54/54 PASS** in 1.5m across Chromium 1280x720 and
    1440x900, including the two Task 2 journeys.

## Browser acceptance journeys

1. `deletes a mercy target at a canonical 100 percent market and rereads its saved intelligence`
   confirms the visible 100% donut, deleted status, removed route, unchanged
   scheduled-history count, archive count one, accessible detail/focus restore,
   and exact reread after reload.
2. `keeps an accelerated supervisor leak on real time and resumes its saved dwell after reload`
   confirms original visibility at 4x, a real page reload without fixture
   reinjection, tab-scoped resume plus normal persisted checkpoint,
   persisted remaining dwell after reload, correction visibility, unchanged 4x,
   and both permanent history entries.

## Changed-file scope

- Engine/state/save: `src/game/{story,market,model,createCampaign,persistence,publicLabels,config,bombs,evaluation}.ts`
- Runtime presentation: `src/app/{GameContext,GameProvider,useSupervisorMessagePresentation}.ts(x)`
- Owner content: `src/content/competitorIntelligence.ko.ts`
- UI/style: supervisor/event/market/review components and `src/styles/global.css`
- Evidence: related unit/component tests, `e2e/game.spec.ts`, and
  `docs/spec-to-test-matrix.md`

## Concerns / deliberate limits

- The 4,000ms original and correction dwell is a readability contract, not a
  claim that final prose pacing is playtest-complete.
- Legacy structural derivation intentionally recognizes only adjacent,
  same-day, consecutive supervisor-message pairs and never guesses an active
  pending phase. A malformed/non-pair legacy history is rejected instead of
  silently restarting or rewriting it.
- Public label scanning targets generated player prose and representative DOM
  output; internal typed machine fields remain raw by design.
