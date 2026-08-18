# Main Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `4f2a437`의 게임 경험·규칙·콘텐츠·저장 의미를 그대로 보존하면서 React 실행 경계와 검증 누락을 정리하고, 검증된 단일 결과를 `main`으로 승격한다.

**Architecture:** 브라우저 설정은 외부 저장소 구독으로 읽고, 해킹 준비는 이벤트 시점의 최신 입력을 사용한다. 중앙 절도 필드의 시간·감시·절도·운반·상자 투입은 순수 런타임 전이와 얇은 React 연결부로 분리한다. 구 감사 자원 모션은 기존 물리 컨트롤러를 유지하되 React 커밋 이후에만 입력과 콜백 ref를 갱신한다. 다른 브랜치는 병합하지 않고 주석 태그로 고정한다.

**Tech Stack:** React 19.2, TypeScript 5.9, Canvas 2D, Vitest 4.1, Testing Library 16.3, Playwright 1.62 Chromium, ESLint 10 + React Hooks 7.1, Vite 8.2, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-18-main-stabilization-design.md`

## Global Constraints

- 기준 커밋은 `4f2a43762ffd65ed2c1b0ea97122df35c1b2180a`이며 작업 브랜치는 `codex/main-stabilization`이다.
- 다른 브랜치의 커밋을 merge, rebase, cherry-pick 하지 않는다.
- 게임 수치, 경제, 대사, 스토리, 화면 구성, 저장·명령 버전을 바꾸지 않는다.
- `src/game/model.ts`, `src/game/persistence.ts`, `src/game/commandProtocol.ts`의 버전 의미를 바꾸지 않는다.
- 린트 억제 주석이나 규칙 비활성화로 오류를 숨기지 않는다.
- 새 기능을 추가하지 않는다. 구조 변경은 기존 플레이 행위를 더 명확하게 증명하는 데 필요한 만큼만 한다.
- 사용자 루트 작업 트리의 미추적 문서와 산출물을 stage, move, delete 하지 않는다.
- 모든 의도적 파일 편집은 `apply_patch`로 수행한다.
- 각 생산 코드 변경 전에 실패하는 행위 테스트 또는 이미 재현된 정적 검증 실패를 확인하고, 변경 뒤 대상 테스트와 대상 린트를 다시 실행한다.
- 현재 개발 결과를 가리키는 새 이름에는 `prototype`을 사용하지 않는다. 과거 이력의 원문은 그대로 보존한다.
- 전체 검증과 브라우저 검증 전에는 `main`과 원격 참조를 변경하지 않는다.

---

## Task 1: Fix the stale app-level review trigger contract

**Files:**

- Modify: `src/app/App.test.tsx`

- [ ] Reproduce the one failing app test and record that the accessible tree contains `전체 유저 리뷰 열기` but not `전체 리뷰 기록`.
- [ ] Confirm with commit history that `4f2a437` intentionally changed the whole review stream into the trigger and updated the focused review tests.
- [ ] Update only the stale app-level query to the current accessible name; keep the dialog name and exact focus-restoration assertion.
- [ ] Run the single app test, then the whole `App.test.tsx` file.
- [ ] Commit the contract repair independently.

## Task 2: Replace reduced-motion mirroring with an external-store subscription

**Files:**

- Modify: `src/app/useReducedMotionPreference.ts`
- Modify: `src/app/useReducedMotionPreference.test.tsx`

- [ ] Preserve tests for explicit-setting OR, live OS changes, unavailable `matchMedia`, exact listener cleanup.
- [ ] Add a failing assertion only if an uncovered behavior is found; otherwise use the existing `react-hooks/set-state-in-effect` failure as the red gate for this structural correction.
- [ ] Implement the preference with `useSyncExternalStore`, a browser snapshot, a false server snapshot, and one change subscription.
- [ ] Replace test-harness render-time capture mutation with a layout-effect callback so the test itself obeys the same React boundary.
- [ ] Run the preference tests, all resource-motion tests contained in the file, target ESLint, and typecheck.
- [ ] Commit the external-store and test-harness correction independently.

## Task 3: Remove render-time input ref writes from hacking staging

**Files:**

- Modify: `src/features/hacking/useHackResourceStaging.ts`
- Modify: `src/features/hacking/useHackResourceStaging.test.tsx`

- [ ] Confirm the existing tests cover duplicate blocking, capacity, target replacement, reserve pruning, cancel, and readiness.
- [ ] Add a failing test for any uncovered current-input boundary needed by the chosen implementation, especially an origin-vector change across rerender.
- [ ] Memoize the current reserve set and let callbacks capture the committed reserve/origin inputs through dependencies; retain refs only for synchronous target and staged-list ownership.
- [ ] Keep pruning behavior and all boolean return values unchanged.
- [ ] Run the hook test file, target ESLint, and typecheck.
- [ ] Commit the hacking staging correction independently.

## Task 4: Extract and test the central intrusion runtime

**Files:**

- Add: `src/features/resources/resourceIntrusionRuntime.ts`
- Add: `src/features/resources/resourceIntrusionRuntime.test.ts`
- Add: `src/features/resources/useResourceIntrusionRuntime.ts`
- Add: `src/features/resources/useResourceIntrusionRuntime.test.tsx`
- Modify: `src/features/resources/ResourceIntrusionBoard.tsx`

- [ ] Write failing pure-runtime tests against the new module before creating it.
- [ ] Cover deterministic placement retention, movement bounds/walls, theft begin/cancel, all surveillance phase boundaries, signal safety, active collision, completion-to-carry, carry collision/reset, deposit intent, and success/interrogation/rejection resolution.
- [ ] Add explicit simultaneous-boundary tests proving active collision wins over theft completion and carry collision wins over deposit.
- [ ] Move constants, geometry helpers, lane selection, resource reconciliation, runtime state, and transition rules into the pure module without changing values.
- [ ] Implement a hook that owns the interval, document visibility, runtime suspension, external resource synchronization, one-shot command dispatch, and external result reconciliation.
- [ ] Key runtime sessions by campaign seed while keeping a session mounted and paused across the official-audit view.
- [ ] Reduce `ResourceIntrusionBoard.tsx` to context selection, Canvas drawing, input wiring, telemetry, legend, and the official-audit presentation switch.
- [ ] Run new pure and hook tests, the app tests, target ESLint, typecheck, and the relevant Playwright scenario.
- [ ] Commit the runtime extraction independently.

## Task 5: Move resource-motion synchronization to the React commit boundary

**Files:**

- Modify: `src/features/resources/useResourceMotion.ts`
- Modify: `src/app/useReducedMotionPreference.test.tsx`

- [ ] Use the existing motion suite as the behavior lock for fixed-step timing, frame caps, transforms without per-frame rerenders, resize reconciliation, drag cancellation, hidden/inactive behavior, replacement elements, reduced motion, isolation, StrictMode, impossible geometry, recovery, and focus.
- [ ] Move option-ref synchronization into an ordered layout effect.
- [ ] Move frame, measurement, and target-reconciliation callback-ref synchronization into layout effects declared before consumers can schedule work.
- [ ] Ensure ResizeObserver and requestAnimationFrame read only committed inputs and cleanup still invalidates stale generations.
- [ ] Run the full motion suite repeatedly, target ESLint, typecheck, and legacy `ResourceBoard` tests.
- [ ] Commit the commit-boundary correction independently.

## Task 6: Run full automated and visual verification

**Files:**

- Modify only if a verified regression requires a correction; do not broaden scope.
- Expected evidence: `test-results/`, Playwright screenshots, and command output. Do not commit transient reports unless already tracked by project policy.

- [ ] Run `git diff --check` and inspect every changed file.
- [ ] Run fresh `pnpm typecheck`.
- [ ] Run fresh `pnpm lint` and require zero warnings and zero errors.
- [ ] Run fresh `pnpm test:run` and record total files and tests.
- [ ] Run fresh `pnpm build`.
- [ ] Run fresh `pnpm test:e2e` in Chromium.
- [ ] Run fresh `pnpm verify` as the single final automated gate even though its constituent commands already passed.
- [ ] Start the stabilization build locally and verify HTTP 200.
- [ ] Inspect 1280×720 and 1440×900 screenshots against the `4f2a437` reference: three-column layout, full 500×300 field, review/market rail, dock, telemetry, footer.
- [ ] Manually or through Playwright verify movement, theft cancel, theft completion, carrying, deposit, review dialog, tool dialogs, exact focus restoration, and official-audit legacy field.
- [ ] Confirm no console errors, page errors, clipped critical controls, duplicate frame loops, or changed game text.
- [ ] Commit any final evidence-only test correction separately, then rerun the full gate.

## Task 7: Freeze historical lines and promote the verified result

**Files:**

- Git refs only. Do not modify source during this task.

- [ ] Fetch and list every local and remote branch with full commit IDs.
- [ ] Verify the stabilization result is a linear descendant of `4f2a437` and both prior main tips.
- [ ] Create one annotated preservation tag for every unique non-main branch tip, retaining the original branch name in the tag message.
- [ ] Do not delete, merge, or force-update any historical branch.
- [ ] Push preservation tags and verify their remote object IDs.
- [ ] Fast-forward local `main` to the fully verified stabilization commit.
- [ ] Push `main` without force and verify local `main`, `origin/main`, and the stabilization commit are identical.
- [ ] Confirm no unintended source or user artifact was included in the promoted history.

## Task 8: Serve and verify the new main

**Files:**

- No source changes expected.

- [ ] Stop only the old detached-worktree development server after the new server is ready.
- [ ] Start Vite from the new `main` worktree on `127.0.0.1:5173`.
- [ ] Verify HTTP 200, title/root mount, and the selected central intrusion screen.
- [ ] Capture the final URL, exact main commit, verification totals, preservation tags, and any residual non-blocking environment warning.
- [ ] Report the outcome with links to the design, plan, and authoritative extracted game documents; do not call historical branches current development lines.
