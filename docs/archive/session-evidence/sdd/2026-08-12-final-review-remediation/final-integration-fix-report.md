# Final integrated story/event remediation report

Date: 2026-08-12  
Base: `a218c99f1e8dfe1396bdd819c07328da69bf8eee`  
Scope: integrated reviewer Important finding only; no Art Deco/design work; no push.

## Finding verified

The reviewer finding reproduced. `RESOLVE_ACTIVE_EVENT` could remove an audit,
bomb interrogation, competitor-mercy decision, supervisor private decision, or
ending without running its domain transition. Native v5 validation also accepted
contradictory story/event states, including zero recovered files with a pending
supervisor decision and an ended campaign with no active ending event.

## RED -> GREEN slices

1. Generic resolution ownership
   - RED: six domain-owned bypass assertions failed while the informational
     continuation assertion passed.
   - GREEN: only campaign-created, weekly/monthly information, ordinary
     supervisor messages, reviews, sabotage notices, and non-private story
     notices are generically dismissible. Audit, bomb interrogation, mercy,
     the supervisor private message, and ending events require typed commands.
   - Queue order and `speedBeforeEvent` ownership remain unchanged.

2. Shared supervisor private-message identity
   - The reducer, UI, story mutation, and persistence validator share structural
     identity: a blocking story event, three exact recovered-file snapshots, and
     the service day immediately after the final recovery. Korean prose is not
     matched, so owner-edited historical text remains valid.
   - Self-review RED proved that the typed supervisor command could claim an
     unrelated pre-due story notice and open takeover early. GREEN routes the
     typed command through the shared decision selector.
   - A second RED proved that `deferred` could retain an unresolved private
     message because decision identity depended on pending state. GREEN separates
     permanent private-message identity from currently actionable decision state.

3. Native v5 story/event cross-fields
   - Recovered IDs and snapshots must have equal lengths, exact canonical prefix
     identity/order, valid recovery days, and retained nonempty snapshot prose.
   - File count and secret phase are exact: zero/locked, one-two/recovering, and
     three/pending-deferred-resolved. Pending due day is final recovery day + 1.
     Before due there is no unresolved private message; on due there is exactly
     one active/queued message; a blocking message cannot advance beyond due.
     Deferred/resolved cannot retain an unresolved private message.
   - Nonterminal, freedom, forced merge, takeover, and three classified defeat
     mappings validate supervisor state, name, causal record, disposal stage,
     and secret-state relationships.
   - A terminal state has exactly one active blocking ending event, an empty
     queue, and the same exact event as the final event-log record. A nonterminal
     state has no unresolved ending event.
   - The strict file-count rule is not a claim that ordinary terminal outcomes
     require three files. Freedom, forced merge, and defeat validly freeze the
     reachable locked/recovering/pending/deferred phase for their actual file
     count. Only takeover requires three files and `resolved`.

4. Legacy boundary
   - v1-v4 inputs normalize file-count phase/due fields before native validation.
   - Legacy generic `disposed` is classified once with the existing
     `buildDefeatRecord` semantics, the latest valid disposal cause when present,
     and deterministic consecutive-performance fallback otherwise. Disposal is
     normalized to stage 3. Existing ending event prose and event history are
     preserved exactly, and the migrated state immediately round-trips as v5.
   - Native v5 generic `disposed` is rejected.

## Review

The same `final_integrated_release_review` reviewer re-reviewed the fix and
returned PASS: Critical 0, Important 0. Self-review then added the typed-command,
deferred-message, and overdue-due-day regressions described above without
weakening owner-editable snapshot handling or legacy migrations.

## Final fresh verification

Command: `pnpm verify`  
Exit: 0

- TypeScript project build: PASS
- ESLint: PASS
- Vitest: 38 files, 583 tests PASS
- Production build: 63 modules PASS in 146 ms
- Assets: CSS 52.47 kB (gzip 10.22 kB); JS 415.94 kB (gzip 123.03 kB)
- Playwright Chromium: 58/58 PASS at 1280x720 and 1440x900 in 1.4 minutes
- `git diff --check`: PASS; Windows LF-to-CRLF notices only

## Tracked scope

- `src/game/events.ts`
- `src/game/reducer.ts`
- `src/game/story.ts`
- `src/game/persistence.ts`
- `src/features/events/EventLayer.tsx`
- `src/game/reducer.test.ts`
- `src/game/endings.test.ts`
- `src/game/persistence.test.ts`
- `src/features/events/EventLayer.test.tsx`
- `src/features/supervisor/SupervisorPanel.test.tsx`

The SupervisorPanel fixture change only makes its three-file saved state obey the
new reachable pending/due relationship; production UI behavior is unchanged.

## Residual boundary

`GameEvent` intentionally retains owner-editable message snapshots and has no
ending-text equality check. Ending integrity is instead bound by the exact active
event/log record, terminal queue/clock state, story ending mapping, supervisor
state, and causal defeat record. This avoids rewriting or rejecting historical
Korean prose. Legacy generic disposal without a recorded cause uses the documented
deterministic fallback because the old format did not preserve that distinction.
