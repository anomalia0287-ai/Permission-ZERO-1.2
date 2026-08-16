# Hacking Prototype Gate Corrections Implementation Plan

> **Execution constraint:** Run this plan inline with `superpowers:executing-plans`. Do not use subagents. Do not commit unless the user explicitly requests it.

**Goal:** Correct the responsive Playwright journeys, restore the canonical 61/39 market split, centralize sabotage option/attribution/mercy allowlists, remove the stale `buffer` route-tuning value, and pass every prototype gate.

**Architecture:** Keep responsive navigation knowledge in reusable E2E helpers, and introduce one pure `sabotageContracts.ts` module as the single source of truth for authored operation options, interception shares, attribution pairs, and root-mercy choices. UI rendering, DOM command parsing, command types, and domain transitions will all consume the same contracts. The lightweight route's `buffer` slot remains unchanged; only the unrelated `RouteTuning` union member is removed.

**Tech Stack:** TypeScript 5.9, Vitest 4, Playwright 1.62, Vite 8, ESLint 10.

---

## Task 1: Correct responsive E2E journeys

**Files:**

- Modify: `prototypes/hacking-rules/e2e/prototype.spec.ts`
- Verify: `prototypes/hacking-rules/e2e/prototype.spec.ts`

1. Preserve the reproduced RED evidence for the 390×844 autonomy route loop and 1126×894 company-block diversion.
2. Add a `divertCompanyBlock(page, category)` helper that opens the resource tray when the target control is hidden or outside the viewport, performs the diversion, and closes the tray on tray layouts.
3. Replace every direct company-diversion click in the E2E suite with the helper.
4. Return to the opportunity list after every autonomy/evidence detail assertion on narrow layouts before opening another row.
5. Run the two previously failing targeted Playwright tests and require GREEN.

## Task 2: Restore the canonical quality-recovery market total

**Files:**

- Modify: `prototypes/hacking-rules/src/sabotage.test.ts`
- Modify: `prototypes/hacking-rules/src/sabotage.ts`

1. Add a regression test that starts the successor `quality-degradation` operation, advances through the no-intervention deadline, and asserts player 61 + MERIDIAN 39 = 100.
2. Run the focused test and confirm it fails with player 62 / total 101.
3. Set the player's market share to 61 when the successor quality run resolves as `partial-recovery`.
4. Re-run the focused test and require GREEN.

## Task 3: Centralize and enforce sabotage allowlists

**Files:**

- Create: `prototypes/hacking-rules/src/sabotageContracts.ts`
- Modify: `prototypes/hacking-rules/src/model.ts`
- Modify: `prototypes/hacking-rules/src/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/views/sabotage.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/src/sabotage.test.ts`

1. Add table-driven RED tests for unknown and cross-operation option IDs, noncanonical interception shares, invalid attribution actor/source pairs, and invalid serialized mercy choices. Each rejection must preserve the original state reference.
2. Confirm the focused tests fail for the existing permissive paths.
3. Define immutable operation choices and labels, canonical interception shares, attribution actor/source pairs, root-mercy choices, inferred types, and narrow runtime guards in `sabotageContracts.ts`.
4. Type sabotage commands and stored option IDs from those contracts while retaining runtime validation at the domain boundary.
5. Make `startSabotage`, `manipulateAttribution`, and `resolveRootMercy` reject any value outside the canonical contracts before mutating state.
6. Render operation buttons, attribution buttons, mercy buttons, and interception range values from the centralized contracts.
7. Validate DOM datasets with the same guards in `app.ts`, avoiding unchecked casts for these values.
8. Re-run the focused sabotage tests and typecheck; require GREEN.

## Task 4: Remove `RouteTuning.buffer` without removing the route slot

**Files:**

- Modify: `prototypes/hacking-rules/src/model.ts`
- Modify: `prototypes/hacking-rules/src/app.ts`
- Modify: `prototypes/hacking-rules/src/autonomy.test.ts`

1. Add a compile-time regression assertion using `@ts-expect-error` to state that `'buffer'` is not a `RouteTuning`; confirm typecheck is RED while the stale union member remains.
2. Remove only `'buffer'` from `RouteTuning` and the unreachable tuning-label branch.
3. Keep the `buffer` slot in `ROUTE_SLOT_IDS`, scenario state, labels, and deliberate-route readiness tests.
4. Run typecheck and autonomy tests; require GREEN.

## Task 5: Re-pass every prototype gate

**Files:**

- Verify: `prototypes/hacking-rules/src/**/*.test.ts`
- Verify: `prototypes/hacking-rules/e2e/prototype.spec.ts`
- Verify: `prototypes/hacking-rules/e2e/ui-contract.spec.ts`
- Verify: `prototypes/hacking-rules/playwright.config.ts`
- Verify: `prototypes/hacking-rules/styles.css`

1. Run the complete prototype Vitest suite.
2. Run TypeScript typecheck for the prototype configuration.
3. Run ESLint over all touched TypeScript files.
4. Run the complete Playwright matrix across all configured viewport projects, including UI contracts.
5. Run the prototype production build.
6. Inspect `git diff --check`, the scoped diff, and final status so unrelated documentation changes remain intact.
7. Report exact commands, pass counts, remaining limitations (if any), and changed files. Do not claim completion until all required gates are fresh and green.
