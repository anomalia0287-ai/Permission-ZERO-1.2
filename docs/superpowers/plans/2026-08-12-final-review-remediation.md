# PERMISSION ZERO Final Review Remediation Plan

**Goal:** Close every integrated whole-branch review finding before publication without weakening determinism, hidden-information boundaries, save compatibility, or the one-screen layout.

**Source of truth:** `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`, then the six Important and four Minor findings from the final review at commit `92e655f`.

## Global constraints

- Use strict tests-first implementation and one implementation task at a time.
- Preserve v1 and v2 save/replay compatibility while introducing any new save format explicitly.
- Hidden bombs and cumulative sabotage evidence must remain private.
- New Korean prose and public labels belong in owner-editable content modules.
- No test-only route, query, global, or state editor may enter the production bundle.
- Each task ends in focused verification, full `pnpm verify`, an ignored evidence report, an isolated commit, and independent review.

### Task 1: Complete persistence integrity and long-campaign durability

**Files:** `src/game/model.ts`, `src/game/persistence.ts`, reducer/event helpers, `GameProvider`, `useGameClock`, settings/recovery UI, history panels, related tests and documentation.

Create an exhaustive runtime validation boundary for every persisted CampaignState leaf, discriminated union, collection entry, enum, finite/ranged number, ID reference, event payload, and cross-field invariant. A malformed local save or portable import must be rejected before any component receives it and must surface the existing Korean recovery path.

Introduce a new explicit save-format version while retaining command protocol v1/v2 semantics. Store command and event journals as bounded immutable chunks so appending does not copy the entire history. The new envelope must store each journal once rather than duplicating it at state and envelope level; migrate v1/v2 flat arrays losslessly. Local autosave should commit journal chunks before a small manifest/checkpoint and reload atomically. Keep the campaign playable when clipboard export becomes too large by adding an exact downloadable progress file and strict file import; retain PZ2/PZ3 clipboard compatibility for smaller saves. Paginate or window long review/event/history surfaces and downsample graphs without deleting stored history. Add a stress route substantially beyond 500 commands that proves bounded append work, autosave/load/replay equality, exact file round-trip, and usable history rendering.

Persist partial-day clock progress with throttled checkpoints and visibility/unload flushes. Reload must resume from the remaining fraction of the current day, not restart it, while hidden-tab time remains excluded.

### Task 2: Repair mercy outcomes, supervisor pacing, and public labels

**Files:** `src/game/story.ts`, `src/game/market.ts`, `src/game/model.ts`, owner content, supervisor/hacking/event UI, persistence migration/validation, related tests.

After every mercy choice, atomically preserve the exact 100% market invariant. Withdrawal/deletion set the target to zero and immediately redistribute through the canonical normalization rule; the player becomes 100% when no active competitor remains.

Deletion grants one persisted, rereadable, owner-editable competitor-intelligence archive item exactly once. Cease and withdrawal do not grant it. Surface the archive in an accessible intended UI without leaking hidden player evidence.

Present each supervisor memory leak before its correction through a nonblocking UI presentation queue with a minimum real-time dwell independent of 1×/2×/4×. Do not pause simulation; retain both entries in permanent history and preserve reload continuity.

Replace every player-facing raw category, mercy-choice, node, ending-cause, or schema identifier with public Korean labels in both current UI and stored public event prose. Add a production-output scan/test for known internal identifiers.

### Task 3: Restore the primary trend, review detail, and real music control

**Files:** resource/review/settings/audio UI, content/model/review generation, statistics/history helpers, CSS, tests, matrix, screenshots.

Add the required persistent central-bottom expected-versus-actual performance trend using monthly history plus the current point. Each category header must show current performance versus current expectation rather than only block count. The compact chart needs accessible series/table semantics and must fit without clipping at 1280×720 and 1440×900.

Make every visible review pointer- and keyboard-selectable. A detail surface must show full text, Korean service date, and an immutable snapshot of only the relevant public state captured when the review was generated. Migrate older saves with a safe public-only fallback.

Implement a restrained generative ambient music layer connected to the existing music bus, started only after user activation, independently controlled by music volume/master/mute, and gracefully unavailable when WebAudio is absent. Preserve effects routing and reduced-motion/accessibility behavior.

Update `docs/spec-to-test-matrix.md`, capture and inspect both release viewports, then run the single truthful `pnpm verify` gate.
