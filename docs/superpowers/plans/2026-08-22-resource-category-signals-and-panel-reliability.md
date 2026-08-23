# Resource Category Signals and Panel Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enemy color unambiguously identify its secured resource, align onboarding with the current lightcycle rules, and prevent the hacking/detail panel path from blanking the app.

**Architecture:** Keep encounter selection and balance unchanged. Introduce one shared category-presentation model and one semantic legend component, project actor category colors through the whole scene and canvas pipeline, then consume the same legend in combat, tutorial, and guide surfaces. Eagerly load the core detail layer and wrap each mounted panel in a local error boundary.

**Tech Stack:** React 19, TypeScript 5.9, Canvas 2D, Vitest, Testing Library, Vite 8, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-resource-category-signals-and-panel-reliability.ko.md`

## Global Constraints

- Preserve the approved idle black field, exact `InIt` label, and 1000×480 canvas contract.
- Preserve the existing 1→2 enemy progression, AI behavior, health, speed, reward count, and shuffle-bag selection.
- Mapping is exact: reasoning `#f06a43`, memory `#4f8df7`, fluency `#e8bd59`.
- Player remains a white circle; enemy heads remain squares.
- Preserve all unrelated dirty-worktree changes; do not reset, clean, stage, commit, or push.
- Work inline in the current inherited workspace; do not use subagents or create a new worktree.

---

### Task 1: Shared category presentation and complete combat color projection

**Files:**
- Create: `src/features/resources/resourceSnakeCategoryPresentation.ts`
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Modify: `src/features/resources/resourceSnakePresentation.ts`
- Modify: `src/features/resources/resourceSnakeCanvas.ts`
- Modify: `src/features/resources/ResourceSnakeRewardFlights.tsx`
- Test: `src/features/resources/resourceSnakePresentation.test.ts`
- Test: `src/features/resources/resourceSnakeCanvas.test.ts`

**Interfaces:**
- Produces `RESOURCE_SNAKE_CATEGORIES`, `SNAKE_CATEGORY_COLORS`, and `SNAKE_CATEGORY_LABELS`.
- `actorColor(actor)` consumes `SnakeActor.category` for enemies.
- Canvas inner pixels consume `rail.color` and `core.color` instead of global cyan.

- [x] **Step 1: Write the failing scene tests**

Add literal expectations showing reasoning is `#f06a43`, memory is `#4f8df7`, and fluency is `#e8bd59`; verify each enemy's core and rail, a reasoning attack telegraph, and reasoning death effects inherit that color.

- [x] **Step 2: Run the scene test and verify RED**

Run: `pnpm exec vitest run src/features/resources/resourceSnakePresentation.test.ts --reporter=verbose`

Expected: category-color assertions fail because current code returns `#21e6ff`.

- [x] **Step 3: Write the failing canvas test**

Record `fillStyle` assignments while drawing a red enemy rail and core, then assert the final luminous passes use `#f06a43` and never substitute `#d7fbff`.

- [x] **Step 4: Run the canvas test and verify RED**

Run: `pnpm exec vitest run src/features/resources/resourceSnakeCanvas.test.ts --reporter=verbose`

Expected: the recorded assignments contain `#d7fbff` for enemy hot pixels.

- [x] **Step 5: Implement the minimal shared model and projection**

Create the ordered literal category data, re-export `SNAKE_CATEGORY_COLORS` from the encounter module for compatibility, and update presentation/canvas code so core, rail, telegraph, collision, explosion, fragment, and power-cut effects retain the responsible enemy's category color.

- [x] **Step 6: Run both tests and verify GREEN**

Run: `pnpm exec vitest run src/features/resources/resourceSnakePresentation.test.ts src/features/resources/resourceSnakeCanvas.test.ts --reporter=verbose`

Expected: both files pass with no warnings.

### Task 2: Persistent combat legend and browser-readable enemy identity

**Files:**
- Create: `src/features/resources/ResourceSnakeCategoryLegend.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/styles/resource-snake.css`
- Test: `src/features/resources/ResourceSnakeBoard.test.tsx`

**Interfaces:**
- Produces `ResourceSnakeCategoryLegend` from Task 1's shared data and consumes it in the board.
- Produces accessible HUD region `적 리소스 색상 범례` and enriched `data-enemy-silhouettes` entries.

- [x] **Step 1: Write the failing board test**

Start a real encounter and assert the active HUD exposes all three labeled swatches. Assert serialized enemy identity includes its runtime category, Korean label, and literal category color.

- [x] **Step 2: Run the board test and verify RED**

Run: `pnpm exec vitest run src/features/resources/ResourceSnakeBoard.test.tsx --reporter=verbose`

Expected: no accessible legend exists and serialized identities lack category metadata.

- [x] **Step 3: Implement the HUD legend and diagnostics**

Render the shared legend only in `active` or `resolving`, keep it compact and pointer-transparent, and append `category`, `resourceLabel`, and `color` to each enemy diagnostic entry without changing AI fields.

- [x] **Step 4: Run the board test and verify GREEN**

Run the same Vitest command; expected result is a clean pass.

### Task 3: Current-rule tutorial and guide

**Files:**
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify: `src/features/tutorial/IntroTutorialOverlay.tsx`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/styles/tutorial.css`
- Modify: `src/styles/settings.css`
- Test: `src/features/tutorial/IntroTutorialOverlay.test.tsx`
- Test: `src/features/tutorial/introTutorial.test.ts`
- Test: `src/features/settings/SettingsPanel.test.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Tutorial steps gain optional `showResourceLegend: boolean` presentation metadata.
- Tutorial and guide consume the shared legend component.

- [x] **Step 1: Write failing tutorial and guide tests**

Assert the resource step displays the semantic three-color legend and explains color-to-reward identity. Assert movement copy describes tap-to-turn continuous movement. Assert the guide includes the live combat loop and no longer presents triangular-core carrying or instant-cut rules.

- [x] **Step 2: Run the onboarding tests and verify RED**

Run: `pnpm exec vitest run src/features/tutorial/introTutorial.test.ts src/features/tutorial/IntroTutorialOverlay.test.tsx src/features/settings/SettingsPanel.test.tsx src/app/App.test.tsx --reporter=verbose`

Expected: new legend and current-rule copy expectations fail.

- [x] **Step 3: Implement the current onboarding contract**

Update the six-step intro copy, render the shared legend on the resource step, and replace guide cards with current `InIt`, continuous 8-way movement, collision/damage, category reward, hacking, evaluation/audit, and save guidance.

- [x] **Step 4: Run the onboarding tests and verify GREEN**

Run the same four-file command; expected result is a clean pass.

### Task 4: Non-lazy core panels and local error containment

**Files:**
- Create: `src/app/DetailPanelErrorBoundary.tsx`
- Create: `src/app/AppPanelFailure.test.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`
- Modify if necessary: `src/styles/connected-details.css`

**Interfaces:**
- `DetailPanelErrorBoundary` accepts `children`, `onClose`, `returnFocus`, and optional `onRecover` (default reload).
- `App.tsx` imports `DetailLayer` eagerly and mounts every detail-layer instance inside the boundary.

- [x] **Step 1: Write the failing boundary test**

Render the real `App` with a fault-injected hacking panel, open the network, and assert the operations workspace remains mounted while an accessible `패널 연결 오류` dialog exposes `게임 다시 연결` and a working `패널 닫기` action.

- [x] **Step 2: Run the boundary test and verify RED**

Run: `pnpm exec vitest run src/app/AppPanelFailure.test.tsx --reporter=verbose`

Expected: the injected panel exception escapes because no local boundary exists.

- [x] **Step 3: Implement the boundary and eager panel import**

Create the class error boundary with an `AccessibleDialog` fallback, remove React `lazy`/`Suspense` usage for `DetailLayer`, and wrap game, nested, and title panel mounts. Use keys tied to panel identity so closing/reopening resets the boundary.

- [x] **Step 4: Run boundary and App tests and verify GREEN**

Run: `pnpm exec vitest run src/app/AppPanelFailure.test.tsx src/app/App.test.tsx --reporter=verbose`

Expected: both files pass and the existing real hacking-open test stays green.

### Task 5: Integration verification and live browser proof

**Files:**
- Modify if required: `e2e/game.spec.ts`
- Modify if required: `e2e/modern-sf.spec.ts`
- Modify if required: `e2e/resource-snake.ts`

**Interfaces:**
- Consumes all prior tasks; produces fresh verification evidence only.

- [x] **Step 1: Run the complete related Vitest set**

Run: `pnpm exec vitest run src/features/resources/resourceSnakePresentation.test.ts src/features/resources/resourceSnakeCanvas.test.ts src/features/resources/ResourceSnakeBoard.test.tsx src/features/tutorial/introTutorial.test.ts src/features/tutorial/IntroTutorialOverlay.test.tsx src/features/settings/SettingsPanel.test.tsx src/app/AppPanelFailure.test.tsx src/app/App.test.tsx --maxWorkers=1`

- [x] **Step 2: Run static verification**

Run: `pnpm run typecheck`, targeted ESLint for changed source/test files, `pnpm run build`, and `git diff --check`.

- [x] **Step 3: Run relevant browser automation**

Use the running `http://127.0.0.1:4173/` app. Verify a live encounter exposes the category/color identity and legend, the hacking button opens the network, the panel closes without blanking the app, and the console has no new errors. Use seeded campaigns or deterministic encounter tests to cover all three category colors without altering balance.

- [x] **Step 4: Review scope and report residual failures honestly**

Compare the final diff to the spec, confirm no AI balance values changed, and distinguish any pre-existing full-suite failures from regressions introduced by this work.
