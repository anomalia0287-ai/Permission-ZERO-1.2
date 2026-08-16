# Operations and Hacking Completion Implementation Plan

> **Execution:** Inline only. No subagents, no staging, no commit, and no push without explicit user approval.

**Goal:** Apply every current-day mockup/layout instruction while completing the revised floating-resource specification's pocket-to-node hacking interaction without changing game rules, save state, command semantics, or replay behavior.

**Architecture:** `HackingPanel` remains the command orchestrator. UI-only staging lives in a focused hook, the ordered reserve pocket owns resource presentation and pointer/keyboard input, and node cards own their drop/confirmation surfaces. Existing reducer commands remain the only mutation path. The main operations shell keeps the user-provided warm-paper/orange/cyan/coral/green visual language and icon-first navigation.

**Tech Stack:** React 19, TypeScript, CSS, Vitest + Testing Library, Playwright, existing fixed-step `useResourceMotion`, existing game reducer commands.

## Global Constraints

- Today's supplied mockups and direct layout instructions override older visual briefs.
- The revised specifications remain authoritative for mechanics, persistence, accessibility, and replay invariants.
- Remove the visible numbered `hack-reserve-grid`; never create duplicate reserve state.
- Staged block IDs remain UI-only and are discarded on node change, cancellation, close, or load.
- A permanent purchase/charge/recovery/follow-up mutation happens only through existing game commands after explicit confirmation.
- Pointer and keyboard paths produce the same command.
- No fake controls, fixture routes, production test switches, new dependency, or campaign-state field.
- Preserve every pre-existing dirty-worktree change outside the owned UI/test/docs paths.

---

### Task 1: Lock the revised hacking interaction contract

**Files:**
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Create: `src/features/hacking/useHackResourceStaging.test.tsx`
- Modify: `e2e/game.spec.ts`

- [ ] Add a failing test proving the numbered grid is absent and a floating pocket exposes actual reserve block IDs without consuming them.
- [ ] Add failing tests for stage/unstage, capacity, node switching, reserve reconciliation, and unmount cleanup.
- [ ] Add a failing test proving a node shows `0/N`, accepts exact reserve IDs, enables confirmation only at `N/N`, and dispatches the existing command only after confirmation.
- [ ] Add failing pointer-drop and keyboard-staging tests that end in the same command state.
- [ ] Add failing browser assertions for the warm visual shell, pocket-to-node flow, no overflow, and preserved target scheduling at 1280×720 and 1440×900.

### Task 2: Isolate UI-only resource staging

**Files:**
- Create: `src/features/hacking/useHackResourceStaging.ts`
- Test: `src/features/hacking/useHackResourceStaging.test.tsx`

- [ ] Define typed purchase, charge, and recovery staging targets.
- [ ] Implement begin, stage, unstage, cancel, and reserve reconciliation without game dispatch or persistence.
- [ ] Enforce unique block IDs and exact required capacity.
- [ ] Verify all focused tests GREEN before integrating the view.

### Task 3: Build the ordered hacking reserve pocket

**Files:**
- Create: `src/features/hacking/HackResourcePocket.tsx`
- Create: `src/features/hacking/HackResourcePocket.test.tsx`
- Reuse: `src/features/resources/resourcePresentation.ts`

- [ ] Render reserve blocks as category shape/symbol buttons, never numbered cells.
- [ ] Keep the hacking pocket deliberately static and ordered; do not reuse the company-field motion loop.
- [ ] Implement pointer drag to the active node and click/keyboard staging.
- [ ] Return invalid drops to the pocket without game commands.
- [ ] Keep reserve identity and accessibility labels stable.

### Task 4: Split the hacking tree and node surfaces

**Files:**
- Create: `src/features/hacking/hackingPresentation.ts`
- Create: `src/features/hacking/HackTreeNavigator.tsx`
- Create: `src/features/hacking/HackNodeCard.tsx`
- Modify: `src/features/hacking/HackingPanel.tsx`

- [ ] Move tree labels, progress presentation, and icon/color metadata out of the orchestrator.
- [ ] Render each real node as the staging target; show staged resource tokens attached to that node.
- [ ] Move purchase, charge, target scheduling, recovery contamination, and recovery confirmations into the owning node/card surface.
- [ ] Keep irreversible ending confirmation in the existing accessible dialog.
- [ ] Reduce `HackingPanel` to state selection, existing command dispatch, and component composition.

### Task 5: Apply today's visual language and locale boundary

**Files:**
- Modify: `src/i18n/messages.ts`
- Modify: `src/i18n/messages.ko.ts`
- Modify: `src/i18n/messages.test.ts`
- Replace: `src/styles/hacking.css`
- Modify: `src/styles/operations-shell.css` only if shared tokens require it.

- [ ] Add typed Korean message IDs for new pocket, staging, confirmation, cancellation, and drop-result text.
- [ ] Replace the old black terminal/micro-code presentation with warm paper, orange/cyan/coral/green tree accents, large icons, readable typography, and direct hierarchy.
- [ ] Keep semantic danger red and visible keyboard focus.
- [ ] Add responsive layouts for both supported viewports without document scroll or clipped actions.

### Task 6: Reconcile the whole operations screen with today's instructions

**Files:**
- Review/modify as required: `src/app/OperationsWorkspace.tsx`, `src/app/OperationsDock.tsx`, `src/features/control/ControlBar.tsx`, `src/features/resources/ResourceFieldChrome.tsx`, `src/features/resources/ResourceBoard.tsx`, `src/features/market/MarketPanel.tsx`, `src/styles/operations-shell.css`.

- [ ] Verify logo removal/service-period placement, icon-only left controls, hidden-by-default message body, dynamic mail badge, wider field, intake guard, wall bounce, and graph placement.
- [ ] Add only missing behavior tests before any correction.
- [ ] Preserve all game commands and campaign state.

### Task 7: Complete product verification

**Files:**
- Modify: `e2e/game.spec.ts`
- Update: `docs/HANDOFF-2026-08-15.ko.md`

- [ ] Run focused hacking and operations tests.
- [ ] Run the full Vitest suite.
- [ ] Run direct pinned-Node `tsc -b`, full ESLint, and Vite build.
- [ ] Run the complete Playwright suite at 1280×720 and 1440×900.
- [ ] Manually verify actual pointer drag, keyboard staging, node switching, cancellation, purchase, charge, target scheduling, recovery, follow-up execution, panel close/reopen, and reduced motion.
- [ ] Capture final screenshots and verify no page/console errors or overflow.
- [ ] Update the handoff with exact final hashes and gate results; do not call the work complete unless every requirement has concrete evidence.
