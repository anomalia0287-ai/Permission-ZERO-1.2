### Task 3: Restore the primary trend, review detail, and real music control

**Base:** `437e4621026bd485bd87da0020cd45233535438d`

**Primary files:** resource/review/settings/audio UI and CSS, audio engine/hooks, review generation/content/model, evaluation/history helpers, persistence migration/validation, related tests, release screenshots, and `docs/spec-to-test-matrix.md`.

Work only in Task 3 scope. Preserve Task 1 storage/Web Locks guarantees and Task 2 mercy, semantic supervisor catalog, public labels, and save-v4 migration. Do not redesign the established one-screen visual language or add unrelated artwork/features.

#### Design and motion contract

- Keep the current restrained dark technical interface, existing typography/color/material language, and fixed one-screen hierarchy. The supplied early mockup was structural only; do not copy its visual styling.
- The central lower slot becomes one compact, legible performance-trend surface rather than a second set of current-number tiles. Preserve its spatial role and fit at exact 1280×720 and 1440×900 with no page scroll, clipping, overlap, or unreadable labels.
- Motion exists only to explain state/continuity: subtle opacity/path update or focus transition is acceptable; no decorative bounce, large layout motion, or continuous chart animation. Animate transform/opacity only when practical. Under `prefers-reduced-motion`, show the final state immediately and retain all information.

#### 1. Persistent expected-versus-actual performance trend

- Write RED component/data tests before production edits.
- Build a canonical series from persisted monthly evaluation history plus one live current point. Use the same expectation and category-performance calculations as evaluation; do not invent a UI-only scoring formula. Define and test the exact aggregate used for “actual” (normally the canonical mean/aggregate of the three category results).
- Show a useful recent window (enough points to reveal direction without crowding) with Korean service-date labels. Do not delete or mutate the full stored history.
- Render a real accessible chart, not decorative bars: expected and actual series must be distinguishable without color alone; provide semantic title/description and an accessible table/list containing every plotted date and exact value. Empty/one-point/flat/equal/min/max cases must remain finite and legible.
- Each `추론 / 기억 / 유창성` category header must show the live actual value compared with the live expected value. Allocation count may remain as secondary metadata, but may not replace the comparison.
- Remove the redundant central-bottom current-number strip once the trend replaces it. The same current values should not be duplicated as the primary content of both header and footer.
- Preserve resource drag/drop, separation gestures, bombs, audit disguise, keyboard grid navigation, focus visibility, accepted/rejected VFX, sound cues, and reduced-motion behavior.

#### 2. Selectable review detail with immutable public snapshot

- Every visible review row/card becomes pointer- and keyboard-selectable without breaking history pagination. Use a semantic button/list pattern and visible focus.
- Open a safe nonblocking detail surface using the existing accessible dialog/focus-manager conventions: full review text, author, Korean service date, sentiment/public topic labels, and relevant immutable public state captured at generation time. Initial focus, Tab containment, Escape, outside-background inertness, and exact trigger/fallback focus restoration must match existing detail surfaces.
- Add a discriminated public-only review snapshot. New reviews capture only public fields needed to explain the reaction, such as public expectation/category performance and, when relevant, public player/competitor market/status values. Never include suspicion, hidden evidence, bomb state, audit rolls, private resources, hacking state, or other secret causes. UI should show only the relevant subset for that review's topics rather than dumping a schema object.
- Snapshot values are immutable prose/context history: later performance or market changes must not change an older review detail.
- Introduce an explicit save-format v5 boundary so current snapshots cannot impersonate legacy data by deleting a field. v1–v4 migrate losslessly to a safe discriminated fallback such as “이전 버전 기록 — 당시 공개 상태가 저장되지 않았습니다,” retaining date/text/author exactly and inventing no hidden/public numbers. v5 requires a valid snapshot for every review and rejects malformed, secret-bearing, duplicate, future-date, or cross-reference-inconsistent snapshot data.
- Preserve command protocol v1/v2, stable local root/lock/journal identities, v4 linked-journal compatibility, PZ2/PZ3/PZ4 imports, and produce current PZ5/`.pz5` exports. Add exact v4→v5 local/file/portable migration and v5 missing-field rejection tests.

#### 3. Real restrained ambient music on the existing music bus

- The current music volume control must affect an actual music source independently of effects volume. Do not use copyrighted/external audio assets; implement a lightweight generative Web Audio ambience through the existing engine/music bus.
- Start or unlock audio only after a genuine user gesture. Never autoplay before activation. Repeated gestures/renders must not create duplicate layers, timers, oscillators, or AudioContexts.
- Use restrained layers rather than a looping “song”: a quiet base/drone, an optional tension texture tied only to player-visible game state, and sparse audit/memory accents. Keep critical effects audible through the effects bus and cap/release all voices. Avoid constant harsh high-frequency sound and excessive modulation.
- Master volume, music volume, effects volume, and mute must route independently and update live. Music volume 0 or mute must silence music; effects-only changes must not change the music gain. Existing effects behavior must remain exact.
- Suspend or safely quiet on hidden/background state and resume only when allowed; dispose nodes/listeners/timers on teardown/new engine. Gracefully return an unavailable status when AudioContext/WebAudio is absent, blocked, or closed. No console/page errors and no gameplay dependence on audio availability.
- Provide visual equivalents for meaningful audit/memory state; audio remains optional. Reduced motion need not disable sound, but no audio behavior may depend on animation frames.
- Unit-test with a strict fake AudioContext/node graph: gesture gating, one-time start, correct music-bus routing, independent gain/mute changes, state-layer changes, visibility suspend/resume, disposal, and unavailable fallback. Add a browser journey proving first gesture does not error, settings change the actual reported music engine state through ordinary UI (without production-only test hooks), mute/unmute remains stable, and console/pageerror stay clean. Human listening quality remains an explicit post-automation check.

#### Required release evidence

- Follow TDD per slice: focused RED, minimal GREEN, refactor, affected regression suite.
- Run exact 1280×720 and 1440×900 browser journeys for the new trend and review detail, including keyboard-only review open/close/focus restoration and reduced-motion chart behavior.
- Capture fresh final screenshots at both viewports after the final build. Inspect them visually for page scroll, clipping, overlap, chart legibility, category comparisons, review focus/detail, and preservation of the primary game hierarchy. Store screenshots/report under ignored `artifacts/task-3/`.
- Update `docs/spec-to-test-matrix.md` and writer guidance for review public snapshots/content editing without exposing internal schema to the writer.
- Perform self-review, then request a fresh independent static reviewer over the Task 3 diff and this brief. Fix every Critical/Important finding with RED→GREEN and re-review until PASS.
- Only after review PASS, run one fresh full `pnpm verify`. Record exact type/lint/unit/build/Playwright results, screenshot dimensions/inspection, RED/GREEN evidence, migration boundaries, and honest remaining human-listening/playtest concerns in ignored `.superpowers/sdd/2026-08-12-final-review-remediation/task-3-report.md`.
- Commit only Task 3 files; do not push.
