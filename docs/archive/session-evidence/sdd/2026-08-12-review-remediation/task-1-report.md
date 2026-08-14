# Task 1 Report: Deterministic Monthly Company Allocation

## Status

DONE

## Files changed

- `src/game/config.ts`
  - Added the approved monthly company allocation bounds: minimum `1`, maximum `4`.
- `src/game/resources.ts`
  - Added `grantMonthlyCompanyBlocks`.
  - Uses the existing keyed `allocation` random stream with campaign seed, service day, and a command-sequence/category key.
  - Fills only empty company cells in ascending index order.
  - Creates normal company blocks with monotonic `company-NNNNNN` IDs and the existing global `nextBlockSequence`.
  - Discards grants that do not fit, preserves all occupied cells, leaves reserve untouched, and returns the original state outside eligible month starts.
  - Skips service day 331 because the initial 16 blocks per category already include that month's grant.
- `src/game/calendar.ts`
  - Applies month-start transitions in the required relative order: audit decision, company grant, bomb protocol.
  - Preserves the existing self-compute monthly reserve grant after those required transitions.
- `src/game/resources.test.ts`
  - Added coverage for deterministic 1–4 grants in every category, initial-month gating, non-month-start identity, full grids, partial grids/overflow, disguised-cell preservation, stable index order, stable unique IDs, and block metadata.
- `src/game/calendar.test.ts`
  - Added integration coverage for month-boundary allocation without reserve mutation and audit → grant → bomb ordering.
- `.superpowers/sdd/2026-08-12-review-remediation/task-1-report.md`
  - This report.

`src/game/model.ts` did not require a change: `RandomStream` already includes `allocation`, company block origins already use `CompanyCategory`, and `ResourceState.nextBlockSequence` already provides the required stable global ID sequence.

## Design decisions

- Random grant counts use one independent key per category:
  - `seed = campaignSeed`
  - `serviceDay = current month-start service day`
  - `stream = allocation`
  - `sequence = commandSequence * categoryCount + categoryIndex`
- The integer count is `floor(roll * 4) + 1`, expressed through the profile's approved minimum/maximum values.
- IDs advance only for blocks actually placed. Overflow is discarded without consuming IDs or creating unreachable block records.
- Occupied normal and disguised cells are never rewritten. Each accepted grant repeatedly takes the first empty cell, making placement order stable and explicit.
- A full allocation across all categories returns the original state object. Ineligible days, campaign creation day, and ended campaigns also return the original object.
- Company allocation precedes bomb checking so a due bomb can select an eligible block created in the same month's grant, as required by the specification.
- Existing public APIs were preserved; the new allocator is an additive exported function.

## TDD evidence

1. Added the calendar month-boundary behavior test first.
   - Red outcome: expected at least 17 company blocks, received 16.
   - Added a minimal one-block-per-category allocator and ordering integration.
   - Green outcome: `src/game/calendar.test.ts`, 16/16 passed.
2. Added the seeded 1–4 range test.
   - Red outcome: every category observed only `[1]` instead of `[1, 2, 3, 4]`.
   - Replaced the fixed grant with keyed seeded 1–4 allocation.
   - Green outcome: `src/game/resources.test.ts`, 10/10 passed.
3. Added the initial campaign month regression.
   - Red outcome: service day 331 received four duplicate blocks for the selected fixture seed.
   - Added the explicit initial-month guard required by the standalone specification.
   - Green outcome: `src/game/resources.test.ts`, 11/11 passed.

## Verification commands and exact outcomes

- `pnpm --dir '.\\.worktrees\\permission-zero-demo' exec vitest run src/game/resources.test.ts src/game/calendar.test.ts src/game/replay.test.ts`
  - Exit 0.
  - 3 test files passed; 34 tests passed.
  - Includes the existing two-year replay/deep-equality test.
- `pnpm --dir '.\\.worktrees\\permission-zero-demo' typecheck`
  - Exit 0 (`tsc -b`).
- `pnpm --dir '.\\.worktrees\\permission-zero-demo' lint`
  - Exit 0 (`eslint .`).
- `pnpm --dir '.\\.worktrees\\permission-zero-demo' test:run`
  - Exit 0.
  - 29 test files passed; 178 tests passed.
- `git -C '.\\.worktrees\\permission-zero-demo' diff --check`
  - Exit 0; no whitespace errors. Git emitted only the repository's existing Windows LF/CRLF conversion notices.

## Self-review

- Requirement checklist:
  - 1–4 bounds for every category: covered across 64 deterministic seeds; all four values observed per category.
  - Full grids: no mutation and no ID consumption.
  - Partially empty grids: only available cells filled; overflow discarded.
  - Normal/disguised preservation: occupied disguised block and object identity preserved.
  - Unique stable IDs: global monotonic sequence and uniqueness asserted.
  - Stable placement order: occupied indexes asserted as the leading ascending range on empty fixtures; disguised occupied indexes are skipped.
  - Transition ordering: integration test proves a due bomb can select a same-tick company grant after an audit roll is made.
  - Two-year replay: existing command replay remains deep-equal and is included in focused verification.
  - No change outside month start: original state identity asserted.
  - No reserve allocation: reserve equality asserted at the month boundary.
- Mutation review:
  - Changing the lower/upper count bounds, category RNG key, placement direction, contribution type, ID scheme, month gate, overflow behavior, disguise preservation, reserve mutation, or bomb-before-grant ordering causes at least one focused test to fail.
- Scope review:
  - No UI, release, persistence schema, content, or unrelated game systems were edited.

## Concerns

None.

## Fix round 1 evidence

### Findings addressed

1. Replaced the order-insensitive calendar assertion with an injected, typed month-start orchestration seam. The test now observes the exact state transformation sequence `audit|company|bomb|self-compute` and retains the integration test proving a due bomb can target a same-month company grant.
2. Strengthened the partial-grid overflow test to retain every surviving normal block as a sentinel and assert both its exact company cell ID and its original `ResourceBlock` object identity after allocation.
3. Preserved the approved service-day-331 guard unchanged.

### TDD and mutation evidence

- Red test command:
  - `pnpm --dir '.\\.worktrees\\permission-zero-demo' exec vitest run src/game/calendar.test.ts`
  - Exact outcome: exit 1; 1 test file failed; 1 failed and 17 passed. The new exact-order test received `undefined` instead of a callable `processMonthStart` seam.
- Green test command after adding the typed seam:
  - `pnpm --dir '.\\.worktrees\\permission-zero-demo' exec vitest run src/game/calendar.test.ts`
  - Exact outcome: exit 0; 1 test file passed; 18 tests passed.
- Swapped-order mutation check:
  - Temporarily changed production orchestration to call company allocation before the audit decision, then ran `pnpm --dir '.\\.worktrees\\permission-zero-demo' exec vitest run src/game/calendar.test.ts`.
  - Exact outcome: exit 1; 1 test file failed; 1 failed and 17 passed. Expected `clock-seed|audit|company|bomb|self-compute`; received `clock-seed|company|bomb|self-compute`.
  - Restored the required audit → company grant → bomb protocol implementation before final verification.

### Covering tests

- `runs exact audit, company grant, bomb, and self-compute month-start order`
  - Detects swapping or omitting any month-start transition because each transition transforms the state passed to the next operation.
- `places a due bomb onto a same-month company grant`
  - Retains end-to-end coverage that real bomb checking receives the real allocation result.
- `discards overflow for full and partially empty grids`
  - Now asserts all 51 surviving normal sentinel blocks across the three partial grids retain their cell IDs and object identities.
- Existing two-year replay test remains in the focused verification set.

### Final verification

- `pnpm --dir '.\\.worktrees\\permission-zero-demo' exec vitest run src/game/calendar.test.ts src/game/resources.test.ts src/game/replay.test.ts`
  - Exit 0.
  - 3 test files passed; 35 tests passed.
- `pnpm --dir '.\\.worktrees\\permission-zero-demo' typecheck`
  - Exit 0; exact output: `$ tsc -b`.
- `pnpm --dir '.\\.worktrees\\permission-zero-demo' lint`
  - Exit 0; exact output: `$ eslint .`.
- `git diff --check`
  - Exit 0; no whitespace errors. Only the repository's Windows LF/CRLF conversion notices were emitted.

### Fix-round concerns

None.
