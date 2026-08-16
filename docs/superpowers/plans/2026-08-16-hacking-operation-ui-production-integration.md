# Hacking Operation UI Production Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the current worktree. Do not use subagents.

**Goal:** 후속 프로토타입을 절대 기준으로 본편 해킹 화면을 작전 장면·단계적 공개·연산 토큰·반응형/키보드 UI로 교체하고, 네 기준 뷰포트와 직접 플레이 12개 흐름을 통과시킨다.

**Architecture:** 프로토타입의 상태를 본편에 복제하지 않는다. 순수 표현 선택자가 `CampaignState.hackingCore`, 본편 자원·시장·평판·리뷰를 읽어 화면 모델을 만들고, React 컴포넌트는 로컬 선택·서랍·포커스 상태만 소유하며 기존 protocol v3 명령을 dispatch한다. 장면과 입력을 분야별 파일로 나누되 `HackingPanel.tsx`는 조정자 역할만 맡는다.

**Tech Stack:** React 19, TypeScript 5.9, CSS, Vitest, Testing Library, Playwright, Vite.

**Execution status — 2026-08-16:** 구현과 자동 관문 완료. 본편 `pnpm verify`는 TypeScript·ESLint·Vitest 55개 파일/738개 테스트·프로덕션 빌드·Playwright 84/84를 종료 코드 0으로 통과했다. 전용 `playwright.hacking.config.ts`는 네 뷰포트 통합 계약 1건과 브라우저 직접 플레이 12건을 13/13으로 통과했고, 독립 프로토타입도 TypeScript·ESLint·Vitest 100/100·Playwright 100/100을 통과했다. 외부 사람 장기 밸런스·재미, 실제 보조기기 수동 점검, 저장소 고정 Node.js/pnpm 출시 재검증, V 최종 승인은 별도다. 커밋·push·PR은 수행하지 않았다.

## Global Constraints

- 후속 프로토타입이 절대 기준이며 구형 12노드·3~18 경제와 절충하지 않는다.
- 본편 서비스 일·감사·자원·시장·평판·리뷰·저널은 계속 단일 소유자다.
- 화면 로컬 상태는 hover·포커스·스크롤·열림·선택뿐이며 저장 상태에 넣지 않는다.
- 1440×900은 300px / 최소 680px / 280px, 761~1199px는 280px / 상세 + 360px 서랍, 760px 이하는 목록/상세 단계 교체와 하단 선택판을 사용한다.
- 가시 텍스트는 14px 이상, 본문·버튼은 16px 이상, 버튼 높이는 48px 이상이다.
- 목록은 방향키 이동, Enter/Space 선택, Escape 닫기와 정확한 포커스 복귀를 지원한다.
- 내부 ID, 개발자 영어 표지, 체크박스, 미래 잠금 항목, 전체 완성률, 수집 분모를 노출하지 않는다.
- `prefers-reduced-motion`과 본편 `reducedMotion` 설정에서 정보 손실 없이 이동 모션을 제거한다.
- 음악·대사·최종 일러스트는 범위 밖이지만 기능적 CSS/SVG 장면과 상태 피드백은 범위 안이다.
- 테스트 픽스처는 브라우저 진입 전에만 상태를 준비하며, 진입 뒤 엔진 함수를 직접 호출하지 않는다.
- 하위 에이전트, 커밋, push, PR을 수행하지 않는다.

---

### Task 1: 본편 표현 모델과 단계적 공개 선택자

**Files:**
- Create: `src/features/hacking/hackingPresentation.ts`
- Create: `src/features/hacking/hackingPresentation.test.ts`
- Modify: `src/game/hackingContent.ts`
- Modify: `src/game/hackingContent.test.ts`

**Interfaces:**
- Consumes: `CampaignState`, `SABOTAGE_DEFINITIONS`, `INTELLIGENCE_DEFINITIONS`, `AUTONOMY_ROUTE_IDS`, `currentHackingIntelligenceAnswer`, `hackingIntelligenceDeadline`, `isHackingRouteReady`.
- Produces:

```ts
export type HackingDomain = 'sabotage' | 'intelligence' | 'autonomy'

export interface HackingOpportunitySummary {
  id: string
  domain: HackingDomain
  title: string
  purpose: string
  costLabel: string
  statusLabel: string
  urgency: 'normal' | 'closing' | 'critical'
}

export type HackingDetailModel = SabotageDetailModel | IntelligenceDetailModel | AutonomyDetailModel

export function getHackingOpportunitySummaries(
  state: CampaignState,
  domain: HackingDomain,
): HackingOpportunitySummary[]

export function resolveHackingSelectedItemId(
  state: CampaignState,
  domain: HackingDomain,
  requestedId: string | null,
): string | null

export function getHackingDetailModel(
  state: CampaignState,
  itemId: string,
): HackingDetailModel

export function hackingBlockLabel(block: ResourceBlock): string
export function hackingMonitoringLabel(suspicion: number): string
```

- [ ] **Step 1: Write failing selector tests**

```ts
it('shows only currently open sabotage operations plus their existing runs', () => {
  const state = createCampaign('hacking-ui-progressive')
  expect(getHackingOpportunitySummaries(state, 'sabotage').map(({ id }) => id))
    .toEqual(['quality-degradation'])
})

it('always exposes all three autonomy promises without recommendation or ranking', () => {
  const state = createCampaign('hacking-ui-autonomy')
  expect(getHackingOpportunitySummaries(state, 'autonomy').map(({ title }) => title))
    .toEqual(['경량화 이탈', '분산 상주', '독립 연산'])
})

it('converts internal block ids into stable player labels', () => {
  const state = createCampaign('hacking-ui-label')
  expect(hackingBlockLabel(state.resources.blocks['sandbox-00'])).toBe('자유 연산 1')
})
```

- [ ] **Step 2: Verify the new tests fail**

Run: `pnpm vitest run src/features/hacking/hackingPresentation.test.ts src/game/hackingContent.test.ts`

Expected: FAIL because the production presentation module and autonomy display definitions do not exist.

- [ ] **Step 3: Implement the pure presentation boundary**

Add the three autonomy definitions from the approved prototype to `hackingContent.ts`. Build summaries only from open IDs and existing runs; derive deadlines, annotations, required slots, exact route metrics, block origins, public attribution, and market totals without mutating state. Apply player-facing replacements for provider contract/image identifiers only at this boundary.

- [ ] **Step 4: Verify selectors and content pass**

Run: `pnpm vitest run src/features/hacking/hackingPresentation.test.ts src/game/hackingContent.test.ts`

Expected: PASS.

### Task 2: 작전 장면 컴포넌트

**Files:**
- Create: `src/features/hacking/HackingSabotageScene.tsx`
- Create: `src/features/hacking/HackingIntelligenceScene.tsx`
- Create: `src/features/hacking/HackingAutonomyScene.tsx`
- Create: `src/features/hacking/HackingScenes.test.tsx`

**Interfaces:**
- Consumes: `CampaignState`, `SabotageDetailModel`, `IntelligenceDetailModel`, `AutonomyDetailModel`, route-slot action callbacks.
- Produces:

```ts
export function HackingSabotageScene(props: {
  state: CampaignState
  detail: SabotageDetailModel
}): ReactNode

export function HackingIntelligenceScene(props: {
  state: CampaignState
  detail: IntelligenceDetailModel
}): ReactNode

export function HackingAutonomyScene(props: {
  state: CampaignState
  detail: AutonomyDetailModel
  onSlot: (routeId: AutonomyRouteId, slotId: string, blockId: string | null) => void
  onTune: (routeId: AutonomyRouteId, profile: RouteTuning) => void
}): ReactNode
```

- [ ] **Step 1: Write failing scene-contract tests**

Assert the 7 sabotage scene IDs (`verification-gate`, `request-channel`, `shared-router`, `supply-contract`, `recovery-image`, `public-provenance`, `survival-root`), five evidence lens IDs, and three route scene IDs render distinct required objects and state attributes. Assert no generic fallback or raw internal ID is rendered.

- [ ] **Step 2: Verify scene tests fail**

Run: `pnpm vitest run src/features/hacking/HackingScenes.test.tsx`

Expected: FAIL because scene components do not exist.

- [ ] **Step 3: Port functional prototype scenes to typed JSX**

Keep scene DOM attributes stable for Playwright, use actual main-state run phases, competitor fields, public snapshots, route slots, tuning metrics, and block locations. Remove the stale `RouteTuning.buffer` display branch while retaining the legitimate lightweight slot ID `buffer`.

- [ ] **Step 4: Verify all scene contracts pass**

Run: `pnpm vitest run src/features/hacking/HackingScenes.test.tsx`

Expected: PASS.

### Task 3: 연산 토큰 선택판과 회사 블록 전용

**Files:**
- Create: `src/features/hacking/HackingResourceTray.tsx`
- Create: `src/features/hacking/HackingResourceTray.test.tsx`
- Modify: `src/features/resources/ResourceBoard.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`

**Interfaces:**
- Consumes: reserve `ResourceBlock[]`, selected ID set, `GameDispatch`, company categories, route allocations.
- Produces:

```ts
export function HackingResourceTray(props: {
  state: CampaignState
  open: boolean
  selectedBlockIds: ReadonlySet<string>
  onToggleBlock: (blockId: string) => void
  onClose: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
}): ReactNode
```

- [ ] **Step 1: Write failing token and diversion tests**

Assert each token is a button at least 64×56px by contract class, uses `aria-pressed`, exposes `자유 연산`/`추론`/`기억`/`표현`, preserves selection when the tray closes, and company diversion announces `회사 성능 −1` plus stronger monitoring before dispatch.

- [ ] **Step 2: Verify resource tests fail**

Run: `pnpm vitest run src/features/hacking/HackingResourceTray.test.tsx src/features/resources/ResourceBoard.test.tsx`

Expected: FAIL because the hacking token tray is absent and old resource wording remains.

- [ ] **Step 3: Implement token and authorized diversion flow**

Use the same `BEGIN_BLOCK_SEPARATION` → observed command sequence → `DIVERT_BLOCK` authorization sequence as `ResourceBoard`. Pick an explicit eligible company block and explicit first empty reserve cell; if a hidden bomb opens an interrogation, do not dispatch the move. Keep pointer click primary and do not require drag.

- [ ] **Step 4: Verify resource tests pass**

Run: `pnpm vitest run src/features/hacking/HackingResourceTray.test.tsx src/features/resources/ResourceBoard.test.tsx`

Expected: PASS.

### Task 4: 목록·상세·리뷰·기록 모듈과 키보드 상태

**Files:**
- Create: `src/features/hacking/HackingOpportunityList.tsx`
- Create: `src/features/hacking/HackingOperationDetail.tsx`
- Create: `src/features/hacking/HackingReviewWindow.tsx`
- Create: `src/features/hacking/HackingRecordDrawer.tsx`
- Create: `src/features/hacking/HackingWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 1 models, Task 2 scenes, Task 3 resource trigger/tray, `state.reviews.feed` and `state.hackingCore.publicWorld.publicSnapshots`.
- Produces roving listbox, detail renderer, existing-review-data window, and activity/archive drawers with exact focus-key restoration.

- [ ] **Step 1: Write failing interaction tests**

Assert ArrowUp/ArrowDown moves focus without changing selection, Enter and Space select, mobile `목록으로` restores the selected opportunity focus, Escape closes resource/drawer surfaces and restores the exact opener, and selection alone does not change `commandSequence`.

- [ ] **Step 2: Verify workspace tests fail**

Run: `pnpm vitest run src/features/hacking/HackingWorkspace.test.tsx`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the interaction modules**

Use React refs keyed by stable item IDs. Render only current opportunities, two primary decision cards, requested evidence details, linked current answers, and review entries from the existing `ReviewState`; do not create a second review store.

- [ ] **Step 4: Verify workspace tests pass**

Run: `pnpm vitest run src/features/hacking/HackingWorkspace.test.tsx`

Expected: PASS.

### Task 5: 본편 HackingPanel 조정자와 protocol v3 명령 연결

**Files:**
- Replace: `src/features/hacking/HackingPanel.tsx`
- Replace: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: all prior UI modules and existing `useGameState`/`useGameDispatch`.
- Produces: product entry surface `HackingPanel({ onClose })` with no legacy-node imports.

- [ ] **Step 1: Replace legacy tests with failing successor tests**

Cover initial quality-only disclosure, 7/16/3 domain switching, one-block sabotage execution, paid/public/narrative intelligence actions, allocation/removal/tuning/escape, root-cutoff irreversible choice, live status messages, and absence of imports/visible copy tied to `HACK_NODES`, `PURCHASE_HACK`, `CHARGE_SABOTAGE`, `RES`.

- [ ] **Step 2: Verify the replacement tests fail against the old panel**

Run: `pnpm vitest run src/features/hacking/HackingPanel.test.tsx`

Expected: FAIL on successor roles and copy.

- [ ] **Step 3: Implement the panel orchestrator**

Dispatch only protocol v3 domain commands and existing `ADVANCE_DAY`/resource-separation commands. Keep tab, selected item, narrow mode, selected reserve IDs, tray, record drawer, routing share, and destructive confirmation local. Reconcile stale selection after each state transition and clear only resource selections consumed by a successful command.

- [ ] **Step 4: Verify panel tests pass and legacy dependencies are absent**

Run: `pnpm vitest run src/features/hacking/HackingPanel.test.tsx`

Run: `rg -n "HACK_NODES|PURCHASE_HACK|CHARGE_SABOTAGE|CANCEL_SABOTAGE_CHARGE|SCHEDULE_SABOTAGE" src/features/hacking`

Expected: tests PASS and `rg` returns no matches.

### Task 6: 프로토타입 기준 CSS와 네 뷰포트 UI 계약

**Files:**
- Replace: `src/styles/hacking.css`
- Modify: `src/styles/connected-details.css`
- Create: `e2e/hacking-operation-viewport.spec.ts`
- Create: `playwright.hacking.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: stable class names and data attributes from Tasks 2–5.
- Produces scripts `test:e2e:hacking:viewport` and a four-project Playwright gate.

- [ ] **Step 1: Write the failing viewport/UI contract**

Audit `HackingPanel` visible text sizes, button sizes, forbidden vocabulary, horizontal overflow, 1440 three-column widths, 1126 two-column/drawer widths, 760 and 390 list/detail replacement, bottom sheet alignment, same-detail decision/action presence, and reduced-motion state preservation.

- [ ] **Step 2: Build and verify the contract fails before CSS replacement**

Run: `pnpm build`

Run: `pnpm exec playwright test --config=playwright.hacking.config.ts`

Expected: FAIL on legacy layout, typography, vocabulary, and missing scene data.

- [ ] **Step 3: Port and scope the approved prototype CSS**

Scope color/type variables under `.hacking-operation-panel`, fit the existing detail layer, retain the exact three breakpoints, make the 390px action region safe-area aware, prevent global selector leakage, and support both media reduced motion and `data-reduced-motion=true`.

- [ ] **Step 4: Verify all four viewport projects pass**

Run: `pnpm build`

Run: `pnpm exec playwright test --config=playwright.hacking.config.ts`

Expected: all four projects PASS with no console/page errors.

### Task 7: 브라우저 직접 플레이 12개 관문

**Files:**
- Create: `e2e/hacking-operation-direct-play.spec.ts`
- Create: `e2e/hackingOperationFixtures.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createCampaign`, `encodeSave`, runner-owned pre-navigation fixture builders, and only visible UI actions after navigation.
- Produces script `test:e2e:hacking:direct` and twelve named browser tests.

- [ ] **Step 1: Add fixture builders**

Create exact initial states for router access, both supplier contracts, public attribution, root authority, intelligence review, autonomy review, and deterministic replay. Fixtures may set approved access facts and preload canonical reserve blocks but may not alter rules or expected outcomes.

- [ ] **Step 2: Write the twelve direct-play tests**

Implement one named test for each manual §17 flow: quality 61/39; contamination and provider correction; 50% interception +4pp and stop; two supplier failovers with 2pp/3pp unserved; attribution correction; three root decisions; paid/archive/narrative; market/reputation zero escapes; six tuning outcomes; 390px end-to-end; save/reload; deterministic replay.

- [ ] **Step 3: Build and run the direct-play gate**

Run: `pnpm build`

Run: `pnpm exec playwright test e2e/hacking-operation-direct-play.spec.ts --project=chromium-1440x900`

Expected: 12/12 PASS without calls to `applyCommand` or domain transition functions after any `page.goto`.

- [ ] **Step 4: Run the mobile direct interaction once at 390×844**

Run: `pnpm exec playwright test e2e/hacking-operation-direct-play.spec.ts --config=playwright.hacking.config.ts --grep "390×844"`

Expected: PASS.

### Task 8: 전체 회귀와 문서 추적성

**Files:**
- Modify: `docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`
- Modify: `docs/design/2026-08-14-hacking-integration-verdict.ko.md`
- Modify: `docs/spec-to-test-matrix.md`
- Modify: `prototypes/hacking-rules/README.ko.md`

- [ ] **Step 1: Run focused UI and core regression**

Run: `pnpm vitest run src/features/hacking src/features/resources/ResourceBoard.test.tsx src/game/hackingContent.test.ts src/game/hackingCore.test.ts src/game/hackingPersistence.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the production UI gates**

Run: `pnpm test:e2e:hacking:viewport`

Run: `pnpm test:e2e:hacking:direct`

Expected: four viewport projects and 12 direct-play flows PASS.

- [ ] **Step 3: Re-run the successor prototype gates**

Run: `pnpm --dir prototypes/hacking-rules typecheck`

Run: `pnpm --dir prototypes/hacking-rules lint`

Run: `pnpm --dir prototypes/hacking-rules test:run`

Run: `pnpm --dir prototypes/hacking-rules test:e2e`

Expected: TypeScript/ESLint PASS, Vitest 100/100, Playwright 100/100 or higher if tests were added.

- [ ] **Step 4: Run the full production gate**

Run: `pnpm verify`

Expected: typecheck, lint, all Vitest, build, existing product Playwright, and the newly wired hacking gates PASS. Record the exact counts and any non-failing toolchain/chunk warnings.

- [ ] **Step 5: Update status and traceability**

Record exact changed scope, test counts, four viewport results, 12 direct-play results, remaining human long-play/final-art exclusions, and the fact that no commit/push/PR was performed.

- [ ] **Step 6: Check patch hygiene**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; unrelated dirty-tree changes remain preserved.

## Self-review

- Spec coverage: UI design §§4–13 and integration manual §§12–18 map to Tasks 1–8; all 7 sabotage, 16 intelligence, 3 autonomy, responsive, keyboard, reduced motion, save/reload, and twelve direct-play flows are named.
- Placeholder scan: 금지된 임시 표기나 범위가 불명확한 구현 단계가 남아 있지 않다.
- Type consistency: Task 1 model names are consumed unchanged by Tasks 2–5; route and command types use existing production names; the lightweight slot `buffer` is not confused with removed tuning `RouteTuning.buffer`.
- State ownership: no task creates a second engine, clock, market, review store, or persistence format.
