### Task 2: Repair mercy outcomes, supervisor pacing, and public labels

**Base:** `d24bb2c56cb371a953fdf101e4029c542a2d64f8`

**Primary files:** `src/game/story.ts`, `src/game/market.ts`, `src/game/model.ts`, `src/game/persistence.ts`, owner-editable Korean content modules, supervisor/event/archive UI, related unit/component/browser tests, and `docs/spec-to-test-matrix.md`.

Work only in Task 2 scope. Do not implement Task 3's primary trend chart, selectable review detail/public snapshots, or ambient music.

#### 1. Mercy outcomes preserve the market invariant immediately

- Write RED tests for `cease`, `withdraw`, and `delete` before production edits.
- Every resolved choice must leave the stored player share plus every competitor share at exactly 100% within the canonical floating tolerance in the same reducer transition; the UI must never render a transient 60% (or otherwise incomplete) donut.
- `withdraw` and `delete` set the target availability/share to zero, remove its interception route where already specified, and immediately redistribute through the canonical market normalization rule without fabricating a scheduled weekly/monthly history snapshot.
- If no competitor remains active/available, the player becomes 100% immediately.
- Preserve distinct statuses and all current mercy/event/clock semantics.

#### 2. Delete grants one permanent, rereadable intelligence item

- Define a persisted immutable competitor-intelligence archive entry containing stable ID, competitor ID/name, Korean service date source, title, and full owner-editable Korean prose. Keep prose in an owner-editable content module rather than inline reducer text.
- `delete` grants the matching intelligence item exactly once. Replaying/retrying/importing must not duplicate it. `cease` and `withdraw` grant none.
- Surface the archive through an accessible player-facing UI using existing detail/modal conventions: pointer and keyboard entry, semantic heading/description, initial focus, focus trap/restore, Escape behavior consistent with safe nonblocking detail surfaces, and permanent rereadability.
- The archive may show public competitor information and the defined deletion intelligence, but must not leak numeric hidden evidence or internal state/schema identifiers.
- Extend save migration, v3 validation, exact file/local round-trip, and legacy defaults losslessly. Old saves receive an empty archive.

#### 3. Memory leak originals receive real-time dwell before correction

- Replace same-reducer-tick live presentation with a persisted, deterministic nonblocking presentation queue/state. Both original and correction still append exactly once to permanent history in the intended order.
- The original must be visibly current for a minimum real-time dwell that does not shrink at 1×/2×/4×. Use one documented duration long enough to read (target 4 seconds unless existing UX evidence supports a nearby value).
- Do not pause or alter simulation speed and do not add numeric effects.
- After the dwell, show the correction. Preserve reload continuity: reloading during an original's dwell must not skip it or duplicate either history entry. Define whether the remaining real-time dwell restarts or resumes; persist enough state so behavior is deterministic and bounded. Hidden tabs must not silently consume the readable interval.
- Event collision rules remain intact; memory leaks must not replace blocking audit/bomb/story surfaces. The right panel should present the queued leak/correction when eligible, while permanent history remains fully accessible.
- Add fake-timer component tests at 1× and 4× and a real browser journey proving original-visible → correction-visible without simulation pause, plus reload-during-dwell coverage.

#### 4. No raw internal identifiers reach player-facing output

- Centralize Korean public labels for resource categories, mercy choices, sabotage/hacking node IDs, ending/defeat causes, event/schema identifiers, and any other enum interpolated into UI or stored public prose.
- Replace raw values such as `reasoning`, `memory`, `fluency`, `cease`, `withdraw`, `delete`, and node IDs such as `sabotage.root-cutoff` wherever the player can see them. Do not replace internal typed IDs in persisted machine fields; only public strings/prose/UI.
- Stored public event prose created after this change must already contain public Korean wording, so history/export rereads remain clean.
- Add a production-output scan/table test across generated event prose and representative UI surfaces that rejects known internal identifiers as tokens while avoiding false positives in test-only/debug structures.

#### Required process and evidence

- Follow TDD for each slice: show focused RED, implement minimal GREEN, then refactor.
- Preserve command replay determinism, save compatibility, event ordering, terminal behavior, pause ownership, and Task 1's Web Locks/storage guarantees.
- Add one browser journey that covers immediate 100% mercy market state and delete-intelligence reread, and one that covers leak dwell at accelerated simulation speed.
- Run focused tests, typecheck/lint/build, then fresh full `pnpm verify` once after independent review PASS.
- Write ignored report `.superpowers/sdd/2026-08-12-final-review-remediation/task-2-report.md` with RED/GREEN evidence, migration details, exact full verification results, concerns, and changed-file scope.
- Commit only Task 2 files; do not push.
