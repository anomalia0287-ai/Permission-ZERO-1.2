# PERMISSION ZERO Review Remediation Plan

**Goal:** Close every Critical and Important finding from the whole-branch review, make every approved story/economy path reachable through the UI, and make the release gate truthful.

**Source of truth:** `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`, followed by the concrete review findings recorded in this plan. Preserve deterministic state transitions, stable block IDs, hidden-information boundaries, and owner-editable Korean prose.

## Global Constraints

- Start from commit `e144fc6`; preserve all existing green behavior.
- Use tests first for every engine or UI behavior change.
- One day remains 24 real seconds at 1× and each month remains 30 days.
- Every random result must remain keyed by seed, service day, stream, and stable sequence; no mutable RNG.
- Company grids remain 3×6 per category and reserve remains 9×2.
- Hidden bombs and cumulative sabotage evidence are never numerically or visually disclosed before public consequences.
- Blocking events render one at a time, final endings are terminal, and a new campaign is the only way to resume after an ending.
- Korean story/review prose remains in `src/content`.
- Every task ends with focused tests, typecheck/lint where relevant, and a commit.

### Task 1: Deterministic Monthly Company Allocation

**Files:** `src/game/model.ts`, `src/game/config.ts`, `src/game/resources.ts`, `src/game/calendar.ts`, relevant tests.

Implement the approved seeded monthly company allocation of 1–4 normal blocks per category. At month start, preserve existing normal and disguised cells, fill only empty company cells in stable index order, generate stable unique block IDs, discard overflow when a grid is full, and never place directly into reserve. The exact transition order is audit decision, company grant, bomb protocol. Replay of the same seed and commands must remain deep-equal.

Tests must cover 1–4 bounds for every category, full grids, partially empty grids, disguised cells, unique IDs, ordering, two-year replay, and no state change outside month start.

### Task 2: Playable Audit Disguise and Recovery

**Files:** `src/game/reducer.ts`, `src/game/resources.ts`, `src/features/resources/ResourceBoard.tsx`, `src/features/events/EventLayer.tsx`, related CSS and tests.

Permit `MOVE_BLOCK_FOR_AUDIT` only while an active audit targets the destination category. The player must be able to select a company source block from another category, choose an empty cell in the audited category, preview the 0.5 disguised contribution, place it, and then submit the audit. Company grids remain visible and operable behind/inside the audit workspace. Reject wrong targets, occupied cells, bomb interrogation states, and non-audit use without mutation. Expose `REPOSITION_BLOCK` for eligible one-month recovery after return, with an understandable visible path.

Tests must cover the complete component and browser journey, keyboard flow, wrong-target rejection, patterned/non-color disguise state, audit submission, and later reposition.

### Task 3: Confidential Files, Supervisor Decision, and All Endings

**Files:** `src/game/model.ts`, `src/game/story.ts`, `src/game/evaluation.ts`, `src/game/reducer.ts`, `src/content/story.ko.ts`, `src/features/hacking/HackingPanel.tsx`, `src/features/events/EventLayer.tsx`, supervisor/history UI, CSS and tests.

After supervisor-access is purchased, expose a deliberately wasteful-looking file recovery surface. Each of exactly three files consumes one selected reserve block through `RECOVER_FILE`. Persist the recovered file ID and full content in a permanent rereadable archive. After all three files, deliver the delayed supervisor message and allow defer, liberate, or terminate. Liberation/termination immediately closes freedom/forced-merge and ultimately selects the matching company-takeover ending; deferral preserves freedom and named forced merge.

At disposal stage 3, choose and store exactly one defeat ending by priority: substantial hacking → rebuilt attacker; otherwise stable/commercially valuable service → reserve supervisor asset; otherwise absorbed parts. Render the matching owner-editable prose and causal record.

Any ending is terminal: speed stays zero; advancing time and all simulation-changing commands are rejected until `NEW_CAMPAIGN`. Tests must reach all freedom/merge/takeover and three defeat variants through typed commands, and browser journeys must cover file recovery, archive reread, deferral, one takeover path, and terminal behavior.

### Task 4: Separation-Threshold Bomb Activation and Evidence Secrecy

**Files:** `src/game/model.ts`, `src/game/reducer.ts`, `src/game/bombs.ts`, `src/features/resources/ResourceBoard.tsx`, `src/features/hacking/HackingPanel.tsx`, related tests.

Add a typed intentional-separation command emitted exactly once when pointer movement crosses 8 px, and by the equivalent keyboard confirmation boundary. For normal blocks it authorizes the pending move without changing resources; for a bomb it immediately consumes/activates the block, cancels drag, gives no reserve resource, changes suspicion as specified, and opens interrogation even if the pointer later releases outside reserve. Filled reserve prevents separation and therefore prevents bomb activation. Avoid double dispatch on valid drop and keep click-only selection non-activating.

Remove exact `hiddenEvidence` from all UI. Show only qualitative per-node risk copied from immutable hack definitions. Tests must prove bomb and normal blocks remain identical before threshold and that abort-after-threshold cannot evade a bomb.

### Task 5: Pause Ownership, Save Failure Recovery, and Accessible Overlays

**Files:** `src/app/GameContext.ts`, `src/app/GameProvider.tsx`, `src/app/App.tsx`, settings/events components, shared overlay utilities, CSS and tests.

Opening settings, guide, credits, or any irreversible final-choice surface pauses time exactly once and restores the prior player-selected speed only when the owning surface closes. Blocking events retain their existing pause ownership. Nested settings→guide/credits transitions must not accidentally resume. Endings never restore speed.

If autosave or final flush fails, keep the campaign dirty, expose a persistent Korean save warning with retry and seed/export guidance, and never claim success. Validate/clamp stored settings and strengthen nested save/command payload validation enough to reject malformed required structures without crashing.

All detail and blocking overlays use labelled dialog/workspace semantics, initial focus, Tab containment, Escape rules where safe, background inertness, and trigger focus restoration. Add unit and browser keyboard tests.

### Task 6: Truthful Release Gate and Remaining Presentation Gaps

**Files:** `package.json`, `playwright.config.ts`, `.github/workflows/deploy-pages.yml`, `e2e/*`, market/review/supervisor/startup UI/content, documentation.

Make the release contract run typecheck, lint, all unit/component tests, production build, and Playwright against the built `dist`. Add Chromium installation in CI and projects for 1280×720 and 1440×900. Add browser journeys for audit disguise, bomb interrogation, file recovery/decision/ending terminal state, defeat classification, save/reload, keyboard-only core play, reduced motion, deterministic replay, and console health. Use a test-only acceleration/state fixture that cannot enter the production UI and document the boundary.

Replace the market bar with the required labelled donut plus exact non-color legend, format review/supervisor history as service-period dates instead of raw `DAY`, make review performance eligibility category/topic-specific, and restore the opening supervisor warning about the predecessor. Create a spec-to-test matrix for all minimum completion conditions.

The deploy workflow must upload only the exact build whose unit and production E2E checks passed. `pnpm verify` must be the single truthful local and CI contract.
