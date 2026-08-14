# Final Remediation Task 3 Report

## Outcome

Task 3 restores one canonical expected-versus-actual performance trend, makes
every review selectable with an immutable topic-relevant public snapshot, moves
the save boundary to explicit format v5, and connects the existing music control
to a real restrained generative Web Audio source. The established dark technical
one-screen hierarchy was preserved; no Art Deco redesign or unrelated art was
added.

Local commit: `a218c99f1e8dfe1396bdd819c07328da69bf8eee`
(`feat: restore trend reviews and ambient music`). It was not pushed.

## Binding behavior implemented

### Canonical trend

- `aggregateCategoryPerformance` is the one canonical arithmetic mean of the
  three category results. Evaluation history and UI trend generation share it;
  there is no UI-only score.
- The plotted series is the most recent persisted monthly evaluations plus one
  current live point, capped at eight. A same-service-day persisted point is
  replaced by the live point rather than producing a duplicate date.
- Expected is dashed with square markers; actual is solid with circular markers,
  so the series remain distinguishable without color. The SVG has a semantic
  title and description, and an off-screen table lists all eight dates and exact
  values.
- The visible axis uses collision-safe sparse Korean service dates (first,
  middle, last), while the accessible table keeps every point. Category headers
  show current actual and expected values.
- The former duplicate current-number strip is replaced inside the same 61px
  central-bottom slot. The compact surface has no continuous animation, and
  reduced motion shows the final state immediately.

### Review history and v5 snapshots

- Visible feed/history rows are semantic buttons. Pointer and keyboard opening,
  initial focus, Tab containment, Escape, background inertness, and trigger or
  fallback focus restoration use the existing dialog/focus-manager conventions.
- Selection lives in the stable feed/history parent, not in a paginated row.
  Adding seven feed entries or fifty-one history entries while a detail is open
  does not destroy the selected immutable review. A late blocking event becomes
  the modal-stack top, leaves the review inert, and restores the review
  deterministically when resolved.
- Explicit layer order is: nonmodal audit 30, review detail 40, blocking event
  and storage recovery 60. Thus an audit presentation cannot cover an open
  review, while a genuinely blocking event always wins visually and semantically.
- `captured-public-v1` stores only topic-relevant public performance and/or
  market data at review generation. It never stores suspicion, hidden evidence,
  bombs, audit probability/rolls, private resources, hacking, or sabotage state.
  Old values do not change when the campaign later changes.
- Market snapshots state whether they are a complete market or a topic subset.
  Every share is finite and within 0..100, shown totals cannot exceed 100,
  complete-market totals must equal 100, and withdrawn/deleted competitors must
  have zero share. Topic/category/competitor cross-references and duplicate sets
  are validated exactly.
- Legacy reviews migrate to `unavailable / legacy-save` without invented values,
  preserving ID, date, text, author, sentiment, and topics. Initial pre-service
  reviews use the distinct `unavailable / prior-service` reason.

### Save v5 boundary

- Current portable/file export is v5 (`PZ5:` / `.pz5`) and requires a valid
  discriminated snapshot on every review.
- PZ2/PZ3/PZ4, local manifests v3/v4, save v1-v4, command protocols v1/v2, and
  the existing local root, lock, and journal identities remain compatible.
- Before migration, every v1-v4 review must have the exact legacy review keys.
  A v5 payload whose top-level version is changed to 4 therefore fails closed
  instead of silently discarding its captured snapshots. A v4 review owning
  either a captured or unavailable snapshot also fails; a genuine v4 review
  without the current-only field migrates.
- V5 rejects missing snapshots, future capture days, malformed/secret-bearing
  top-level or nested fields, duplicate categories, topic mismatches, impossible
  market totals/statuses, and invalid competitor identities.
- Task 1 Web Locks/journal durability and Task 2 mercy/supervisor semantic
  catalog invariants remain covered by the full regression suite.

### Real ambient music

- Three quiet generative layers (base drone, public-state tension texture, and
  sparse visible-event accents) feed only the existing music bus. Effects remain
  on the effects bus; master, music, effects, and mute gains update independently.
- AudioContext and sources are created only after a genuine user gesture.
  Concurrent/repeated gestures deduplicate activation and cannot create duplicate
  contexts, layers, or accents.
- Continuous tension uses only already-visible player reputation and market
  share. Hidden evidence, bombs, audit probability/rolls, and hacking/sabotage
  internals cannot affect parameters or cues. Accents occur only on transitions
  into a visible audit or visible supervisor-memory original phase.
- A visible audit/memory that predates first unlock deliberately produces no
  retroactive accent. This transition-only rule avoids a reload/gesture duplicate;
  the three continuous layers still start normally.
- Background visibility is reconciled to the latest requested state through one
  serialized lifecycle. Rapid hide/show, show/hide, hide during a pending unlock,
  and deferred suspend/resume all settle to the latest intent. Dispose dominates,
  closes/disconnects the graph, and prevents later promise completion from
  reactivating audio.
- The settings status is public Korean UI only: `대기`, `재생`, `일시 정지`, or
  `사용 불가`. Missing/blocked/closed Web Audio remains optional and cannot affect
  gameplay.

## RED -> GREEN evidence

| Slice | RED evidence | GREEN evidence |
|---|---|---|
| Trend data/UI | Component tests initially found no canonical chart, live header comparison, sparse visible dates, or complete accessible table. A later browser RED showed the inner grid growing beyond the 61px slot. | ResourceBoard 20/20 and the final two-viewport trend journey pass. The live duplicate-date attack is filtered, paths stay finite, three visible dates do not collide, and all eight points remain in the table. |
| Review snapshot/detail | Tests initially had inert text rows, no stable selection, and no captured public context. | ReviewFeed 9/9 passes pointer/keyboard/focus behavior, immutable relevant display, feed/history window churn, and late blocking-event modal stacking. |
| V5 validation | Three impossible market snapshots and three downgrade/current-field impersonations initially decoded. | Persistence 194/194 passes; complete/subset totals and withdrawn share fail closed, v5-to-v4 downgrade rejects, genuine v4 migrates, v4 current fields reject, and v5 missing snapshot rejects. |
| Audio | Strict fake-context tests initially found no music graph, no gesture gate, and no state-safe lifecycle. A self-attack then exposed a same-tick visibility no-op/hidden race. | Audio 17/17 passes graph routing, independent gains/mute, public-only tension, transition dedupe, non-retroactive initial accents, concurrent unlock, latest visibility intent, dispose dominance, and unavailable fallback. |
| Existing event legacy fixture | The v5 downgrade guard correctly rejected two tests that only changed `version: 5` to `3` while retaining v5 snapshots. | The fixtures now construct the exact snapshot-free v3 review shape; ResourceBoard + EventLayer 32/32 pass. Production migration was not weakened. |
| Existing browser date assertions | The first post-review full verify reached 50/58 Playwright because four older page-wide `getByText(service date)` assertions now matched both the header and the new visible chart date. | Assertions were narrowed to the exact header `time` element. The affected four journeys pass 8/8 across both viewports; the same independent reviewer returned PASS before the final fresh verify. |

## Independent review closure

The fresh independent static reviewer initially found five Important issues and
no Critical issues:

1. visible Korean trend dates were present only in the off-screen table;
2. asynchronous visibility operations could settle opposite to the latest audio
   intent;
3. market snapshot cross-invariants were incomplete;
4. paginated review selection and equal review/event layers could lose or cover
   an open detail;
5. a v5 review could impersonate v4 and be silently replaced by legacy fallback.

All five were reproduced with focused RED tests, fixed, and re-read by the same
reviewer. Follow-up self-review also closed duplicate live dates, same-tick audio
visibility loss, explicit nonmodal-audit layering, exact legacy event fixtures,
and the redundant clipped aggregate line in the 61px trend summary. The reviewer
returned **PASS** with no Critical/Important findings, then returned **PASS**
again for the final test-only header-date selector correction.

## Final verification evidence

Final fresh `pnpm verify`: **PASS**.

- TypeScript: PASS.
- ESLint: PASS.
- Vitest: **38 files / 558 tests PASS** in 14.08s.
- Production build: **63 modules PASS** in 149ms.
- Bundle: JS 411.72 kB (121.92 kB gzip), CSS 52.47 kB
  (10.22 kB gzip), HTML 0.65 kB (0.44 kB gzip).
- Playwright: **58/58 PASS** in 1.4m across Chromium 1280x720 and
  Chromium 1440x900.
- `git diff --check`: PASS (only Git's informational LF-to-CRLF warnings).

## Browser journeys and screenshot inspection

- Trend/review journey: 2/2 at 1280x720 and 1440x900. It checks all plotted
  table rows, visually distinct series, finite paths, exactly three Korean date
  labels with non-overlapping boxes inside the trend, actual/expected headers,
  no document overflow, keyboard-only review opening/closing, public snapshot
  content, and focus restoration under reduced motion.
- Real-audio journey: 2/2 at both viewports. It proves no pre-gesture playback,
  one ordinary UI gesture unlock, visible Korean status, independent music
  control, stable mute/unmute, and no console/page errors without a production
  test hook.
- Fresh ignored screenshots:
  - `artifacts/task-3/workspace-1280x720.png` — 1280x720, 231,530 bytes.
  - `artifacts/task-3/workspace-1440x900.png` — 1440x900, 266,963 bytes.
  - `artifacts/task-3/review-detail-1280x720.png` — 1280x720, 142,261 bytes.
  - `artifacts/task-3/review-detail-1440x900.png` — 1440x900, 166,707 bytes.
- Manual visual inspection confirmed exact viewport dimensions, no page scroll,
  clipping, overlap, or date collision; the compact chart and category comparison
  remain legible; review modal content and close focus are unobscured; and the
  primary left/center/right game hierarchy is preserved.

## Changed-file scope

- Trend/evaluation: `src/game/evaluation.ts`, resource UI/tests, new
  `PerformanceTrend.tsx`, CSS, and E2E.
- Review/snapshot/save: model, review generation/content/labels, feed/history UI,
  persistence v5/migration/validation, event legacy fixture, and related tests.
- Audio/settings: `src/audio/audioEngine.ts`, new `publicAudioState.ts`, App
  lifecycle wiring, settings UI/status, strict fake-context tests, and E2E.
- Documentation: spec-to-test matrix and Korean writer guidance.

## Concerns / deliberate limits

- Automated graph/routing tests cannot judge musical taste, fatigue, speaker
  distortion, or the final balance against every effect. Human listening on
  headphones and ordinary laptop speakers remains required before release.
- The ambience is intentionally very quiet and restrained. Its public-state
  mapping is mechanically bounded but still needs long-session playtesting for
  pacing and whether sparse accents feel too rare or too noticeable.
- Trend density is verified at the two binding desktop release viewports. A
  future mobile layout would need a separate design contract rather than making
  this one-screen desktop surface denser.
- Snapshot prose/context is intentionally public and topic-limited. Future review
  topic families must explicitly extend generation and validation together;
  unknown topics must not be used as a reason to serialize private state.
