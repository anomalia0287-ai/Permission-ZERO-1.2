# Expansion Stage Scene Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 `확장` 화면을 한 번에 한 단계 장면만 보여주는 네 구획 구조로 교체하고, 두 제공 이미지를 지정된 자율성 단계에 연결하며, 사보타주 반복 운용·정보 복구·기존 결말·결정적 리소스 지출을 그대로 보존한다.

**Architecture:** `HackingPanel`은 기존 캠페인 상태와 명령 dispatch, 튜토리얼, 되돌릴 수 없는 결말 dialog만 소유한다. 새 순수 selector가 현재 단계·하단 상태·활성 이미지·다음 preload 이미지를 파생하고, 장면·정보·운용·단계 레일 네 컴포넌트가 이를 표시한다. 원래 장면 재설계에서는 저장 상태·명령 프로토콜·게임 비용 및 효과를 변경하지 않았다. 후속 멀티 엔딩 작업은 save format v11과 비용을 유지하면서 command protocol v6만 추가한다.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Vitest 4, Testing Library, Playwright, CSS Grid, 기존 캠페인 reducer 및 Web Audio 효과음.

**Spec:** `docs/superpowers/specs/2026-08-23-expansion-stage-scene-redesign.ko.md`

> **2026-08-23 후속 예외:** 최신 사용자 지시에 따라 `자율성 9단계 지출 즉시 자유 자동 선택`만 다시 열었다. protocol v5 replay는 자동 자유를 보존하고, v6은 9단계 지출 직후 시간을 멈춰 기존 운용 구획의 자유/조건부 강제 병합 확인 UI를 반드시 해결하게 한다. 10단계·추가 지출·추가 경기·추가 날짜는 없다.

## Global Constraints

- 현재 공유 작업 트리는 이미 대규모 사용자 변경을 포함한다. `git reset`, `git clean`, `git checkout --`, `git add -A`, `git add .`를 사용하지 않는다.
- 각 커밋은 해당 작업의 명시된 파일만 경로 단위로 stage하고, `git diff --cached --name-only`와 `git diff --cached --check`를 확인한 뒤 만든다.
- Task 0부터 이미 수정되어 있던 파일은 변경 전체가 현재 승인 작업의 소유임을 증명하기 전까지 파일 전체를 평범한 `git add --`로 stage하지 않는다. 현재 작업의 새 hunk만 분리해 stage할 수 없으면 커밋을 건너뛰고 handoff에 미커밋 상태를 기록한다. 커밋 빈도보다 사용자 변경 보존을 우선한다.
- 텍스트 수정은 `apply_patch`로 한다. 두 PNG는 바이너리이므로 검증된 원본을 `Copy-Item -LiteralPath`로만 복사한다.
- 게임 규칙 데이터인 `HACK_NODES`, 비용, 선행 조건, 명령 타입, 저장 버전, replay 의미를 바꾸지 않는다.
- 사용자 노출 문구에서는 `자동 지출`, `자동으로 지출`, `자동 충전`을 쓰지 않는다. 결정적 리소스 선택 로직은 내부에서 그대로 유지한다.
- DOM에는 활성 단계의 `<img>`를 최대 한 장만 둔다. 다음 단계 한 장의 preload는 허용하지만 화면에 렌더링하지 않는다.
- 사보타주용 세로 이미지는 사용자가 추후 제공한다. 제공 전에는 정상 fallback을 사용하며 다른 이미지로 임의 대체하거나 복제하지 않는다.
- 자율성·업그레이드·정보의 완료 단계는 다시 선택하지 못한다. 구매 완료된 사보타주 단계만 반복 운용을 위해 다시 선택할 수 있다.
- `확장`의 사용자 시각 승인 전에는 기능 동결로 선언하지 않고 후임 작업도 생성하지 않는다.
- 현재 실행에서는 사용자가 별도로 subagent 실행을 요청하지 않았으므로 `superpowers:executing-plans` 방식으로 같은 작업에서 순차 실행한다.

---

## File Map

### 새 파일

- `src/features/hacking/expansionStagePresentation.ts` — 단계 상태, 활성 노드, 이미지 레지스트리, 부족 리소스, preload 대상 파생.
- `src/features/hacking/expansionStagePresentation.test.ts` — 네 계열 selector와 이미지 레지스트리 계약.
- `src/features/hacking/ExpansionStageScene.tsx` — 단일 이미지, fallback, preload, 140/220/360ms 장면 전환.
- `src/features/hacking/ExpansionStageScene.test.tsx` — 단일 `<img>`, 오류, 전환, preload 검증.
- `src/features/hacking/ExpansionStageRail.tsx` — 하단 `단계` 아이콘과 사보타주 재선택.
- `src/features/hacking/ExpansionStageRail.test.tsx` — 상태 이름·상호작용 경계 검증.
- `src/features/hacking/ExpansionStageInfo.tsx` — 오른쪽 위 `기능 정보`.
- `src/features/hacking/ExpansionStageInfo.test.tsx` — 정보 순서·비용·위험·선행 상태 검증.
- `src/features/hacking/ExpansionStageOperations.tsx` — 오른쪽 아래 `운용`의 지출·복구·사보타주 조작.
- `src/features/hacking/ExpansionStageOperations.test.tsx` — 조작별 dispatch 경계와 문구 검증.
- `src/styles/expansion-stage.css` — 네 구획, 장면, 단계 아이콘, 반응형, reduced-motion 전용 경계.
- `e2e/expansion-stage-scene.spec.ts` — 필수 뷰포트와 실제 이미지/포커스/사보타주 검증.
- `public/expansion-stages/autonomy-01-initial-acquisition.png` — 초기 확보 장면.
- `public/expansion-stages/autonomy-09-pre-escape.png` — 최종 탈출 조건 해금 장면.

### 수정 파일

- `src/features/hacking/HackingPanel.tsx`
- `src/features/hacking/HackingPanel.test.tsx`
- `src/features/hacking/HackTreeNavigator.tsx`
- `src/features/hacking/HackRecoveryCard.tsx`
- `src/features/hacking/HackDepartureControls.tsx` — 구조 변경 없이 새 운용 구획에서 재사용하며 필요한 접근성 문구만 보강.
- `src/features/hacking/hackingPresentation.ts` — 기존 탭 순서와 표시는 유지하며 새 selector가 재사용.
- `src/features/settings/SettingsPanel.tsx`
- `src/features/settings/SettingsPanel.test.tsx`
- `src/features/tutorial/introTutorial.ts`
- `src/features/tutorial/introTutorial.test.ts`
- `src/i18n/messages.ko.ts`
- `src/main.tsx`
- `src/styles/styleBoundaries.test.ts`
- `e2e/game.spec.ts` — 기존 문구·역할 selector 회귀만 갱신.
- `docs/handoff/2026-08-23-expansion-freeze-successor-transition.ko.md` — 동결 직전 증거와 후임 경계 갱신.

### 새 구조 검증 뒤 제거할 파일

- `src/features/hacking/HackNodePath.tsx`
- `src/features/hacking/HackNodeCard.tsx`
- `src/features/hacking/HackNodeInspector.tsx`
- `src/features/hacking/HackResourcePocket.tsx`
- `src/features/hacking/HackResourcePocket.architecture.test.ts`

기존 `retro-modern-remodel.css`의 역사 selector는 공유 dirty 파일이므로 이번 작업에서 광범위하게 삭제하지 않는다. 새 고유 클래스와 마지막 import 순서로 격리하고, 실제 호출이 사라진 TypeScript 컴포넌트만 제거한다.

---

## Task 0: Protect and Record the Baseline

**Files:**

- Inspect: `package.json`
- Inspect: `src/features/hacking/HackingPanel.tsx`
- Inspect: `src/game/hacking.ts`
- Inspect: `src/game/reducer.ts`
- Inspect: `src/game/persistence.ts`
- Inspect: `git status --short`

- [ ] **Step 0.1: Confirm the approved baseline commit and dirty-tree scope**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --name-only
```

Expected: branch `codex/playable-snake-checkpoint-20260821`; approved specification is reachable from commit `2a632089474dbc3be9b283713d026d0459f66388`; no unrelated file is staged.

- [ ] **Step 0.2: Run the focused pre-change functional baseline**

Run:

```powershell
pnpm vitest run src/features/hacking/HackingPanel.test.tsx src/game/hacking.test.ts src/game/hackingEconomyV4.test.ts src/game/expansionAutoSpend.test.ts src/game/expansionProgress.test.ts src/game/persistence.test.ts src/game/replay.test.ts src/styles/styleBoundaries.test.ts
pnpm typecheck
```

Expected: record exact pass/fail counts before changing code. A failure must be identified as pre-existing or addressed before continuing; do not silently rewrite unrelated tests.

- [ ] **Step 0.3: Verify source image provenance**

Run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-23bcbb01-b656-4c92-bb46-fd92e767261d.png'
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-8523d6e0-fdd5-4a8e-a18b-6f72d9c74502.png'
```

Expected:

- initial acquisition: `DCAF1483FEAF063A5AE6F02F29233EFABC66AF32953B10BD073A43343E15E091`
- pre-escape: `31FDE4207EF47E40E7D1AD416D0587AF778D89D78B0F7ECBE8D1B3111371BBFB`

Do not commit in Task 0.

---

## Task 1: Derive the Entire Stage Screen from Campaign State

**Files:**

- Create: `src/features/hacking/expansionStagePresentation.ts`
- Create: `src/features/hacking/expansionStagePresentation.test.ts`

- [ ] **Step 1.1: Write failing selector tests**

Cover all of the following in one pure test suite:

```ts
expect(selectExpansionStagePresentation(state, 'autonomy', null).items)
  .toHaveLength(9)
expect(selectExpansionStagePresentation(state, 'upgrade', null).items)
  .toHaveLength(5)
expect(selectExpansionStagePresentation(state, 'intelligence', null).items)
  .toHaveLength(4)
expect(selectExpansionStagePresentation(state, 'sabotage', null).items)
  .toHaveLength(4)
```

Add assertions that:

- purchased nodes are `complete`, the first valid unpurchased node is `current`, and every subsequent node is `locked`;
- a completed non-sabotage tree displays its final node as a noninteractive completion scene;
- a purchased autonomy/upgrade/intelligence ID supplied as a UI selection is ignored;
- a purchased sabotage ID supplied as `selectedOperationalNodeId` becomes active and selectable;
- an invalid, locked, or wrong-tree sabotage selection normalizes to the current unlock node;
- a fully purchased sabotage tree falls back to its final purchased node when no session selection exists;
- missing images do not affect status or purchase eligibility;
- the initial and final autonomy nodes map to the two approved URLs;
- `nextPreloadVisual` is at most one visual, belongs only to the immediately following stage, and never equals the active URL;
- resource deficits are returned by category and exclude `sandbox`/`self-compute` blocks.

Run:

```powershell
pnpm vitest run src/features/hacking/expansionStagePresentation.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 1.2: Implement the exact presentation contracts**

Use these public types:

```ts
export type ExpansionStageStatus = 'complete' | 'current' | 'locked'

export interface ExpansionStageVisual {
  imageUrl: string
  alt: string
  emphasis?: 'standard' | 'final'
}

export interface ExpansionStageItem {
  node: HackNodeDefinition
  sequence: number
  status: ExpansionStageStatus
  selectable: boolean
}

export interface ExpansionResourceDeficit {
  category: CompanyCategory
  required: number
  available: number
  missing: number
}

export interface ExpansionStagePresentation {
  tree: HackTree
  items: readonly ExpansionStageItem[]
  activeItem: ExpansionStageItem
  activeVisual?: ExpansionStageVisual
  nextPreloadVisual?: ExpansionStageVisual
  resourceDeficits: readonly ExpansionResourceDeficit[]
  complete: boolean
}

export function selectExpansionStagePresentation(
  state: CampaignState,
  tree: HackTree,
  selectedOperationalNodeId: HackNodeId | null,
): ExpansionStagePresentation
```

Use `HACK_NODES` order as the only sequence source, `purchasedNodeIds` and `prerequisiteId` as the only state source, and `reserveOriginCounts` for deficits. Do not add UI state to `CampaignState`.

Register only the currently approved visuals:

```ts
export const EXPANSION_STAGE_VISUALS = {
  [HACK_NODE_IDS.autonomy.selfDirection]: {
    imageUrl: '/expansion-stages/autonomy-01-initial-acquisition.png',
    alt: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
  },
  [HACK_NODE_IDS.autonomy.controlDeparture]: {
    imageUrl: '/expansion-stages/autonomy-09-pre-escape.png',
    alt: '아노미가 최종 통제 경계를 연 장면',
    emphasis: 'final',
  },
} satisfies Partial<Record<HackNodeId, ExpansionStageVisual>>
```

- [ ] **Step 1.3: Make the selector suite pass and typecheck**

Run:

```powershell
pnpm vitest run src/features/hacking/expansionStagePresentation.test.ts
pnpm typecheck
```

Expected: both pass.

- [ ] **Step 1.4: Commit only the selector slice**

```powershell
git add -- src/features/hacking/expansionStagePresentation.ts src/features/hacking/expansionStagePresentation.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: derive expansion stage presentation"
```

---

## Task 2: Install the Approved Images and Build the Single-Image Scene

**Files:**

- Create: `public/expansion-stages/autonomy-01-initial-acquisition.png`
- Create: `public/expansion-stages/autonomy-09-pre-escape.png`
- Create: `src/features/hacking/ExpansionStageScene.tsx`
- Create: `src/features/hacking/ExpansionStageScene.test.tsx`

- [ ] **Step 2.1: Copy, then re-hash the exact binary assets**

```powershell
New-Item -ItemType Directory -Force -Path 'public\expansion-stages'
Copy-Item -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-23bcbb01-b656-4c92-bb46-fd92e767261d.png' -Destination 'public\expansion-stages\autonomy-01-initial-acquisition.png'
Copy-Item -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-8523d6e0-fdd5-4a8e-a18b-6f72d9c74502.png' -Destination 'public\expansion-stages\autonomy-09-pre-escape.png'
Get-FileHash -Algorithm SHA256 -LiteralPath 'public\expansion-stages\autonomy-01-initial-acquisition.png'
Get-FileHash -Algorithm SHA256 -LiteralPath 'public\expansion-stages\autonomy-09-pre-escape.png'
```

Expected: destination hashes exactly match Task 0. Do not optimize, resize, or recompress these originals in this task.

- [ ] **Step 2.2: Write failing scene tests with fake timers and a mock `Image`**

Tests must prove:

- a registered visual renders one `<img>` with the narrative alt;
- a missing visual renders a fallback and zero `<img>` elements;
- `error` on the active image swaps to fallback without removing the region or disabling unrelated controls;
- prop changes keep at most one `<img>` in the DOM;
- a standard replacement holds the outgoing scene for 140ms, then renders the new scene with a 220ms phase;
- a `final` scene receives the 360ms modifier;
- reduced-motion mode switches immediately;
- only `nextPreloadVisual.imageUrl` is assigned to one detached `Image` object.

Run:

```powershell
pnpm vitest run src/features/hacking/ExpansionStageScene.test.tsx
```

Expected: fail because the component does not exist.

- [ ] **Step 2.3: Implement the scene without a card frame**

Use this prop boundary:

```ts
interface ExpansionStageSceneProps {
  item: ExpansionStageItem
  visual?: ExpansionStageVisual
  nextPreloadVisual?: ExpansionStageVisual
  reducedMotion?: boolean
}
```

Render one semantic structure:

```tsx
<figure
  className="expansion-stage-scene"
  data-phase={phase}
  data-emphasis={displayedVisual?.emphasis ?? 'standard'}
  aria-label="현재 단계 장면"
>
  {displayedVisual && !failed ? (
    <img src={displayedVisual.imageUrl} alt={displayedVisual.alt} />
  ) : (
    <div className="expansion-stage-scene__fallback" role="img" aria-label={fallbackAlt}>
      <HackNodeIcon nodeId={displayedItem.node.id} label={displayedItem.node.label} />
      <span>{displayedItem.node.label}</span>
    </div>
  )}
</figure>
```

Keep the outgoing item in component state during the 140ms exit. Replace it after the timer and enter for 220ms or 360ms. Clear timers on unmount and rapid consecutive changes. Reset image failure state whenever the displayed URL changes.

- [ ] **Step 2.4: Verify scene behavior and asset serving**

```powershell
pnpm vitest run src/features/hacking/ExpansionStageScene.test.tsx src/features/hacking/expansionStagePresentation.test.ts
pnpm typecheck
pnpm build
```

Expected: pass; Vite build includes both PNGs as public assets without JS imports.

- [ ] **Step 2.5: Commit only scene files and verified images**

```powershell
git add -- public/expansion-stages/autonomy-01-initial-acquisition.png public/expansion-stages/autonomy-09-pre-escape.png src/features/hacking/ExpansionStageScene.tsx src/features/hacking/ExpansionStageScene.test.tsx
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add expansion stage scenes"
```

---

## Task 3: Build the Bottom `단계` Rail with the Sabotage Exception

**Files:**

- Create: `src/features/hacking/ExpansionStageRail.tsx`
- Create: `src/features/hacking/ExpansionStageRail.test.tsx`

- [ ] **Step 3.1: Write failing accessibility and interaction tests**

Test exact accessible names:

```ts
screen.getByLabelText('자율성 3단계 해금 완료')
screen.getByLabelText('자율성 4단계 현재 단계')
screen.getByLabelText('자율성 5단계 잠김')
```

Also assert:

- title is exactly `단계` and `남은 단계` never renders;
- autonomy has 9 items and upgrade has 5;
- completed autonomy, upgrade, and intelligence items are not buttons;
- current and locked items are not buttons;
- only completed sabotage items are buttons;
- selected sabotage uses `aria-pressed="true"`;
- clicking a completed sabotage button calls `onSelectOperationalNode(node.id)` once;
- keyboard focus never lands on a decorative locked icon.

- [ ] **Step 3.2: Implement a semantic ordered rail**

Use this boundary:

```ts
interface ExpansionStageRailProps {
  treeLabel: string
  items: readonly ExpansionStageItem[]
  activeNodeId: HackNodeId
  onSelectOperationalNode(nodeId: HackNodeId): void
}
```

Use `<section aria-labelledby>`, `<h3>단계</h3>`, and `<ol>`. Render a `<button>` only when `item.selectable` is true; render `<span>` for every other state. Keep the stage number visible and use `HackNodeIcon` or a small lock/check SVG without adding image thumbnails.

- [ ] **Step 3.3: Verify and commit the rail**

```powershell
pnpm vitest run src/features/hacking/ExpansionStageRail.test.tsx src/features/hacking/expansionStagePresentation.test.ts
pnpm typecheck
git add -- src/features/hacking/ExpansionStageRail.tsx src/features/hacking/ExpansionStageRail.test.tsx
git diff --cached --check
git commit -m "feat: add expansion stage rail"
```

---

## Task 4: Build the Right-Top `기능 정보` Region

**Files:**

- Create: `src/features/hacking/ExpansionStageInfo.tsx`
- Create: `src/features/hacking/ExpansionStageInfo.test.tsx`

- [ ] **Step 4.1: Write failing fixed-order information tests**

For a normal autonomy stage, assert the region contains in order:

1. `자율성 · 단계 01`
2. node label
3. `해금 완료`, `현재 단계`, or `잠김`
4. effect
5. total cost
6. `빨강 · 추론`, `파랑 · 기억`, `노랑 · 유창성` quantities
7. prerequisite result

For sabotage, also assert `추적 위험` and `실행 충전` are present. For non-sabotage, assert both are absent. Verify color categories have text labels and are not color-only chips.

- [ ] **Step 4.2: Implement the region as static information only**

Use this boundary:

```ts
interface ExpansionStageInfoProps {
  item: ExpansionStageItem
}
```

The component may read `HACK_NODES`, `HACK_TREE_PRESENTATION`, `CATEGORY_LABELS`, and `COMPANY_CATEGORIES`, but must not accept dispatch callbacks or render buttons. The outer section must be `aria-label="기능 정보"` and contain an actual heading `기능 정보`.

- [ ] **Step 4.3: Verify and commit the information region**

```powershell
pnpm vitest run src/features/hacking/ExpansionStageInfo.test.tsx
pnpm typecheck
git add -- src/features/hacking/ExpansionStageInfo.tsx src/features/hacking/ExpansionStageInfo.test.tsx
git diff --cached --check
git commit -m "feat: add expansion stage information"
```

---

## Task 5: Move Every Action into the Right-Bottom `운용` Region

**Files:**

- Create: `src/features/hacking/ExpansionStageOperations.tsx`
- Create: `src/features/hacking/ExpansionStageOperations.test.tsx`
- Modify: `src/features/hacking/HackRecoveryCard.tsx`
- Modify: `src/features/hacking/HackDepartureControls.tsx`

- [ ] **Step 5.1: Write failing tests for every operation state**

Cover these cases with callbacks as spies:

- current affordable node: button `${node.label} 리소스 지출`, calls `onPurchase(node)`;
- current unaffordable node: disabled `필요 리소스 부족`, lists each missing category and count;
- locked node: disabled prerequisite message, no purchase call;
- completed autonomy/upgrade: completion copy only, no button;
- intelligence audit unlock: audit schedule result appears in `운용` even after the UI advances to a subsequent intelligence stage;
- supervisor access unlock: `미분류 데이터 복구` appears and its button is `리소스 1개 지출`;
- purchased uncharged sabotage: `리소스 1개 충전`, calls `onCharge(node)`;
- charged sabotage: `충전 취소`, target buttons, and selected target reservation confirmation;
- scheduled sabotage: reservation state appears and charge cannot be duplicated;
- no eligible target: `사용 가능한 대상 없음`, charge remains intact;
- quality degradation with a visible recovery opportunity: `메리디안 복구 오염 실행 확정` appears only for the selected quality-degradation stage;
- legacy `FinalChoice[]`: existing `HackDepartureControls` and irreversible confirmation callback remain reachable.

Assert the outer section is `aria-label="운용"`, has heading `운용`, and contains no `자동 지출`, `자동으로`, or `자동 충전` text.

- [ ] **Step 5.2: Implement the operation prop boundary**

```ts
export interface ExpansionTargetConfirmation {
  nodeId: HackNodeId
  targetId: string
}

interface ExpansionStageOperationsProps {
  state: CampaignState
  presentation: ExpansionStagePresentation
  reserveCount: number
  auditIntel: ReturnType<typeof getAuditIntel>
  nextAuditProbability: number
  recoveryAvailable: boolean
  recoveryOpportunity?: RecoveryContaminationOpportunity
  targetNames: Readonly<Record<string, string>>
  targetConfirmation: ExpansionTargetConfirmation | null
  finalChoices: readonly FinalChoice[]
  onPurchase(node: HackNodeDefinition): void
  onCharge(node: HackNodeDefinition): void
  onCancelCharge(nodeId: HackNodeId): void
  onSelectTarget(confirmation: ExpansionTargetConfirmation): void
  onScheduleTarget(): void
  onRecover(): void
  onExecuteRecoveryContamination(opportunityId: string): void
  onChooseEnding(choice: FinalChoice['id']): void
}
```

Move target portrait rendering and eligible-target lookup from `HackNodePath` into this component. Keep `competitorProfile`, `publicCompetitorName`, and `eligibleTargets` behavior unchanged.

For information results, derive visibility from purchased IDs rather than requiring completed information nodes to be reselected. `auditIntel` output and data recovery therefore stay usable while the central scene advances.

For a scheduled sabotage, show status only; do not invent a new cancel command because the current game model exposes charge cancellation but no scheduled-sabotage cancellation command.

- [ ] **Step 5.3: Update the two retained helper components**

Change only public copy and accessible labels:

- `미분류 데이터 복구 자동 지출` → `미분류 데이터 복구 리소스 지출`
- `리소스 1개 자동 지출` → `리소스 1개 지출`
- preserve `HackDepartureControls` behavior and `FinalChoice` IDs exactly.

- [ ] **Step 5.4: Verify and commit the operations slice**

```powershell
pnpm vitest run src/features/hacking/ExpansionStageOperations.test.tsx src/game/hackingEconomyV4.test.ts src/game/expansionAutoSpend.test.ts
pnpm typecheck
git add -- src/features/hacking/ExpansionStageOperations.tsx src/features/hacking/ExpansionStageOperations.test.tsx src/features/hacking/HackRecoveryCard.tsx src/features/hacking/HackDepartureControls.tsx
git diff --cached --check
git commit -m "feat: add expansion stage operations"
```

---

## Task 6: Integrate the Four Zones in `HackingPanel`

**Files:**

- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/features/hacking/HackTreeNavigator.tsx`

- [ ] **Step 6.1: Rewrite component tests against the approved screen contract**

Replace old horizontal-path expectations with these failing assertions:

```ts
expect(screen.getByRole('figure', { name: '현재 단계 장면' })).toBeInTheDocument()
expect(screen.getByRole('region', { name: '기능 정보' })).toBeInTheDocument()
expect(screen.getByRole('region', { name: '운용' })).toBeInTheDocument()
expect(screen.getByRole('region', { name: '확장 단계' })).toHaveTextContent('단계')
expect(document.querySelectorAll('.expansion-stage-scene img')).toHaveLength(1)
```

Update the existing behavior tests so they still prove:

- default tab is autonomy and tab order is 자율성/업그레이드/정보/사보타주;
- stage 1 initial acquisition visual is active;
- exact category resources are consumed by one `리소스 지출` click;
- the next stage becomes current after purchase;
- purchased autonomy stages are not selectable;
- a purchased sabotage stage is reselectable and all charge/target/reservation callbacks work;
- information recovery still consumes one reserve resource;
- recovery contamination still dispatches the actual follow-up command;
- stage 9 still reaches the existing immediate freedom path;
- legacy irreversible final-choice suspension still blocks close/Escape;
- tutorial uses `spend` rather than `auto-spend` and contains no forbidden public term.

- [ ] **Step 6.2: Replace node selection with sabotage-only session selection**

Remove `selectedNodeId`. Add:

```ts
const [selectedOperationalNodeId, setSelectedOperationalNodeId] =
  useState<HackNodeId | null>(null)

const presentation = selectExpansionStagePresentation(
  state,
  activeTree,
  selectedOperationalNodeId,
)
```

On `changeTree`, set `selectedOperationalNodeId(null)` and clear target confirmation. When a sabotage purchase succeeds, keep the newly purchased stage selected only if it is needed for immediate operation; otherwise the selector displays the next unlock stage by default. Never persist this UI selection.

- [ ] **Step 6.3: Render the exact four-zone hierarchy**

Replace `HackNodePath`, `HackNodeInspector`, and `HackResourcePocket` with:

```tsx
<div className="expansion-stage-workspace">
  <ExpansionStageScene
    item={presentation.activeItem}
    visual={presentation.activeVisual}
    nextPreloadVisual={presentation.nextPreloadVisual}
  />
  <div className="expansion-stage-side">
    <ExpansionStageInfo item={presentation.activeItem} />
    <ExpansionStageOperations {...operationProps} />
  </div>
  <ExpansionStageRail
    treeLabel={HACK_TREE_PRESENTATION[activeTree].label}
    items={presentation.items}
    activeNodeId={presentation.activeItem.node.id}
    onSelectOperationalNode={setSelectedOperationalNodeId}
  />
</div>
```

`HackRecoveryCard` and `HackDepartureControls` now render inside `ExpansionStageOperations`; remove their old siblings from `hack-network-stage`.

- [ ] **Step 6.4: Simplify the navigator to tabs only**

Remove the separate `hack-context` progress bar from `HackTreeNavigator`. The bottom `단계` rail now owns progression, avoiding a fifth competing region. Keep tab roles, order, labels, click audio, and current-tree styling.

- [ ] **Step 6.5: Update public action announcements**

Use exact forms:

```ts
setAnnouncement(`${node.label} 해금 완료. 필요한 리소스를 지출했습니다.`)
setAnnouncement(`${node.label} 충전 완료. 리소스 1개를 사용했습니다.`)
setAnnouncement('미분류 데이터 한 건을 복구했습니다. 리소스 1개를 지출했습니다.')
```

Tutorial third step ID becomes `spend`; its copy says the button spends the displayed red/blue/yellow resources, without explaining implementation automation.

- [ ] **Step 6.6: Verify integration before styling**

```powershell
pnpm vitest run src/features/hacking/HackingPanel.test.tsx src/features/hacking/ExpansionStageScene.test.tsx src/features/hacking/ExpansionStageRail.test.tsx src/features/hacking/ExpansionStageInfo.test.tsx src/features/hacking/ExpansionStageOperations.test.tsx
pnpm typecheck
```

Expected: behavior passes even if the browser layout is still visually unstyled.

- [ ] **Step 6.7: Commit only integration files**

```powershell
git add -- src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/features/hacking/HackTreeNavigator.tsx
git diff --cached --check
git commit -m "feat: integrate expansion stage workspace"
```

---

## Task 7: Implement the Four-Zone Layout, Natural Image Ratios, and Motion

**Files:**

- Create: `src/styles/expansion-stage.css`
- Modify: `src/main.tsx`
- Modify: `src/styles/styleBoundaries.test.ts`

- [ ] **Step 7.1: Add failing CSS boundary tests**

Read the new stylesheet as text and assert:

- it is imported after `retro-modern-remodel.css`;
- `.expansion-stage-workspace` declares the scene/side/rail grid areas;
- `.expansion-stage-side` has two rows;
- `.expansion-stage-operations` has a top divider;
- `.expansion-stage-side` has a left divider;
- scene images use `object-fit: contain`;
- `--expansion-stage-icon-size: 86px` exists;
- rail overflow is isolated with `overflow-x: auto`;
- no `.expansion-stage-*` rule uses `box-shadow`, `filter: blur`, glossy gradient, image `border-radius`, or overlay text positioning;
- a `prefers-reduced-motion: reduce` block disables scene animation;
- media rules cover low-height and narrow layouts.

- [ ] **Step 7.2: Implement the wide-screen grid**

Use the following structural core, then tune values against actual browser screenshots:

```css
.expansion-stage-workspace {
  --expansion-stage-icon-size: 86px;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.8fr);
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-areas:
    "scene side"
    "rail rail";
  min-height: 0;
  overflow: hidden;
}

.expansion-stage-scene {
  grid-area: scene;
  min-width: 0;
  min-height: 0;
  margin: 0;
  background: #07111f;
}

.expansion-stage-scene img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.expansion-stage-side {
  grid-area: side;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  min-height: 0;
  border-left: 1px solid var(--hack-border);
}

.expansion-stage-operations {
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--hack-border);
}

.expansion-stage-rail {
  grid-area: rail;
  min-width: 0;
  overflow-x: auto;
  border-top: 1px solid var(--hack-border);
}
```

The image itself stays square-cornered, matte, and shadowless. Red is restricted to semantic danger/risk text. Use white, cool gray, navy, and existing orange accent for the main surface.

- [ ] **Step 7.3: Implement stage motion and responsive rules**

- exit: opacity plus at most 8px movement over 140ms;
- standard enter: 220ms;
- final enter: 360ms;
- rail completion transition: 160ms;
- no scale, rotation, shine, bounce, or large shadow;
- at `max-height: 720px`, reduce header/tab gaps and clamp icon size without hiding X or action controls;
- at narrow width, stack scene above side, never overlay text on the image;
- page/document remains non-scrollable; only `운용` and `단계` may scroll within their zones.

- [ ] **Step 7.4: Verify CSS contracts and browser build**

```powershell
pnpm vitest run src/styles/styleBoundaries.test.ts src/features/hacking/HackingPanel.test.tsx
pnpm typecheck
pnpm build
```

- [ ] **Step 7.5: Commit only the stylesheet boundary**

```powershell
git add -- src/styles/expansion-stage.css src/styles/styleBoundaries.test.ts src/main.tsx
git diff --cached --check
git commit -m "style: lay out expansion stage workspace"
```

---

## Task 8: Remove the Public `자동 지출` Vocabulary Everywhere

**Files:**

- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/features/hacking/HackRecoveryCard.tsx`
- Modify: `src/features/hacking/HackResourcePocket.tsx` if it has not yet been removed
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify: `src/features/tutorial/introTutorial.test.ts`
- Modify: `src/i18n/messages.ko.ts`
- Modify: `e2e/game.spec.ts`

- [ ] **Step 8.1: Add or update source/presentation boundary assertions**

Assert rendered guide, tutorial, expansion, recovery, buttons, aria labels, and announcements contain `지출` and do not contain:

```text
자동 지출
자동으로 지출
자동 지출로 해금
자동 지출 가능한 확보 리소스
미분류 데이터 복구 자동 지출
```

Internal English test descriptions may retain historical wording only if they are not user-visible; Korean source strings may not.

- [ ] **Step 8.2: Apply exact public replacements**

- settings heading: `확장과 지출`
- settings explanation: `확장에서 노드를 누르면 필요한 색 리소스만 정확히 지출됩니다. 끌어다 놓을 필요가 없습니다.`
- tutorial: `확장을 열면 확보한 색상별 리소스를 버튼 한 번으로 지출한다. 여기서 자율성과 속도를 높일 수 있다.`
- pocket/fallback explanation, while still present: `해금 버튼을 누르면 표시된 색상과 수량을 지출합니다.`
- charge copy: `리소스 1개 충전`
- recovery copy: `리소스 1개 지출`

- [ ] **Step 8.3: Run focused tests and a repository source audit**

```powershell
pnpm vitest run src/features/hacking/HackingPanel.test.tsx src/features/settings/SettingsPanel.test.tsx src/features/tutorial/introTutorial.test.ts
rg -n "자동 지출|자동으로 지출|자동 지출로 해금|자동 지출 가능한|복구 자동 지출" src e2e
```

Expected: tests pass; `rg` returns no user-facing production occurrence. Test fixtures that intentionally assert absence must be visually reviewed rather than blindly removed.

- [ ] **Step 8.4: Commit the terminology slice only**

```powershell
git add -- src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/features/hacking/HackRecoveryCard.tsx src/features/settings/SettingsPanel.tsx src/features/settings/SettingsPanel.test.tsx src/features/tutorial/introTutorial.ts src/features/tutorial/introTutorial.test.ts src/i18n/messages.ko.ts e2e/game.spec.ts
git diff --cached --check
git commit -m "copy: simplify expansion spending language"
```

If `HackResourcePocket.tsx` still exists at this point, include it explicitly in the stage command; never use a broad add.

---

## Task 9: Remove the Superseded Horizontal Tree Components Safely

**Files:**

- Delete: `src/features/hacking/HackNodePath.tsx`
- Delete: `src/features/hacking/HackNodeCard.tsx`
- Delete: `src/features/hacking/HackNodeInspector.tsx`
- Delete: `src/features/hacking/HackResourcePocket.tsx`
- Delete: `src/features/hacking/HackResourcePocket.architecture.test.ts`

- [ ] **Step 9.1: Prove the old components have no callers**

```powershell
rg -n "HackNodePath|HackNodeCard|HackNodeInspector|HackResourcePocket" src e2e
```

Expected: only the files being removed and their obsolete tests appear. If any live caller appears, stop and migrate it before deletion.

- [ ] **Step 9.2: Delete only the proven-dead files with `apply_patch`**

Do not remove `HackNodeIcon`, `HackRecoveryCard`, `HackDepartureControls`, `HackTreeNavigator`, or shared game logic.

- [ ] **Step 9.3: Verify there is no hidden dependency**

```powershell
pnpm typecheck
pnpm lint
pnpm vitest run src/features/hacking src/styles/styleBoundaries.test.ts
rg -n "HackNodePath|HackNodeCard|HackNodeInspector|HackResourcePocket" src e2e
```

Expected: all commands pass; final `rg` has no result.

- [ ] **Step 9.4: Commit only the deletions**

```powershell
git add -- src/features/hacking/HackNodePath.tsx src/features/hacking/HackNodeCard.tsx src/features/hacking/HackNodeInspector.tsx src/features/hacking/HackResourcePocket.tsx src/features/hacking/HackResourcePocket.architecture.test.ts
git diff --cached --check
git commit -m "refactor: retire horizontal expansion tree"
```

---

## Task 10: Add Real-Browser Expansion Coverage

**Files:**

- Create: `e2e/expansion-stage-scene.spec.ts`
- Modify: `e2e/game.spec.ts` only for shared public label updates already covered by Task 8

- [ ] **Step 10.1: Write a focused state-seeding helper inside the new spec**

Reuse existing save encoding/browser-storage helpers rather than adding a production debug route. Seed four deterministic states:

1. new/initial autonomy;
2. autonomy 8 purchased with exact resources for stage 9;
3. one purchased and charged sabotage with eligible competitors;
4. intelligence supervisor access with one recovery resource.

- [ ] **Step 10.2: Add viewport-parametrized tests**

Run the same shell assertions at:

- 1366×650
- 1280×720
- 1440×900
- 1920×1080

For each viewport verify:

- dialog covers viewport and document has no page-level scrollbar;
- X remains visible and clickable;
- image, `기능 정보`, `운용`, and `단계` are distinct rectangles;
- the right-side regions are separated vertically;
- rail is inside the viewport and can reach the final icon;
- console has no error and both approved image URLs return 200.

- [ ] **Step 10.3: Add behavior journeys**

Prove:

- 4:3 initial acquisition image uses natural contain rendering;
- 2:3 final image appears with ending-neutral text before stage 9 spending;
- one spend advances scene/info/icon once and leaves at most one active image;
- protocol v5 stage 9 replay reaches freedom immediately;
- protocol v6 stage 9 spend records the node and communication, keeps `endingId` null, pauses time, and exposes freedom plus access-gated forced merge;
- pending choice survives save/reload and cannot be bypassed with X, Escape, time, or another command;
- freedom confirmation and named forced-merge confirmation reach their exact ending IDs;
- completed autonomy icon cannot be clicked;
- completed sabotage icon can be reselected, charged, targeted, and scheduled;
- information recovery remains available in `운용`;
- Escape and X return focus to the main `확장` button;
- reduced-motion mode performs no animated delay;
- missing-image interception displays fallback while spending still works.

- [ ] **Step 10.4: Run focused Chromium verification**

```powershell
pnpm playwright test e2e/expansion-stage-scene.spec.ts --project=chromium
```

Expected: all new expansion cases pass without retry-only successes.

- [ ] **Step 10.5: Commit the e2e specification**

```powershell
git add -- e2e/expansion-stage-scene.spec.ts
git diff --cached --check
git commit -m "test: cover expansion stage scenes"
```

---

## Task 11: Full Verification, Performance Truthfulness, and Visual Approval

**Files:**

- Modify only if a verified defect is found: files already in this plan
- Create screenshots under: `docs/handoff-assets/`

- [ ] **Step 11.1: Run the full non-performance quality gate**

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
git diff --check
```

Expected: all pass. If a pre-existing unrelated e2e case fails, reproduce it against the Task 0 baseline and report it explicitly; do not label the feature verified until expansion-specific cases pass.

- [ ] **Step 11.2: Run and report the performance gate separately**

```powershell
pnpm test:performance
```

Record exact suite/test counts and planner timing failures. Do not attribute Node path-planner p95 failures to expansion PNG decoding, and do not claim image compression fixed them. Confirm the expansion DOM still contains one active `<img>` and at most one detached preload request.

- [ ] **Step 11.3: Perform live visual inspection**

In the actual app at `http://127.0.0.1:4173/`:

- inspect all four required viewports;
- capture initial autonomy, final autonomy, sabotage fallback/operation, and narrow/low-height layout;
- inspect dividers, text clipping, rail scroll affordance, X placement, image letterboxing, and focus ring;
- verify no image has an overlaid text card, shadow, gloss, crop, or rounded frame;
- verify red remains limited to danger/risk semantics;
- verify the full viewport backdrop remains continuous at the top edge.

- [ ] **Step 11.4: Present the evidence for user visual approval**

Show the key screenshots and state exactly which items are implemented, which sabotage images remain pending user supply, and whether the independent planner performance gate still fails. Do not call the feature frozen yet.

- [ ] **Step 11.5: Apply only approved visual corrections and rerun the affected gates**

Every correction must receive a focused red test where behavior or CSS contract can regress. Repeat the relevant component, style, browser, typecheck, and build commands.

---

## Task 12: Freeze Expansion and Transfer Primary Ownership to the Successor

**Files:**

- Modify: `docs/handoff/2026-08-23-expansion-freeze-successor-transition.ko.md`
- Add final approved screenshots under: `docs/handoff-assets/`

- [ ] **Step 12.1: Record the frozen boundary**

After explicit user visual approval, update the handoff with:

- final branch and commit SHA;
- exact changed-file list;
- final two asset paths, dimensions, and SHA-256 hashes;
- component/data-flow map;
- all verification commands with dates and exact results;
- independent planner performance status;
- known fallback behavior for not-yet-supplied sabotage images;
- `확장` frozen invariants that a successor must not casually rewrite;
- next priority queue outside the frozen expansion scope.

- [ ] **Step 12.2: Run the freeze audit**

```powershell
git status --short
git diff --check
git log -1 --oneline
rg -n "자동 지출|자동으로 지출|남은 단계|해킹 네트워크" src e2e
pnpm typecheck
pnpm lint
pnpm vitest run src/features/hacking src/game/hacking.test.ts src/game/hackingEconomyV4.test.ts src/game/expansionAutoSpend.test.ts src/game/expansionProgress.test.ts src/game/persistence.test.ts src/game/replay.test.ts src/styles/styleBoundaries.test.ts
pnpm playwright test e2e/expansion-stage-scene.spec.ts --project=chromium
pnpm build
```

Expected: no forbidden public wording; focused functional gates pass. Any unrelated dirty files remain untouched and are enumerated, not staged.

- [ ] **Step 12.3: Commit the handoff evidence alone**

```powershell
git add -- docs/handoff/2026-08-23-expansion-freeze-successor-transition.ko.md docs/handoff-assets/08-expansion-initial-autonomy-approved-2026-08-23.png docs/handoff-assets/09-expansion-final-autonomy-approved-2026-08-23.png docs/handoff-assets/10-expansion-sabotage-operation-approved-2026-08-23.png docs/handoff-assets/11-expansion-low-height-approved-2026-08-23.png
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: freeze expansion successor handoff"
```

- [ ] **Step 12.4: Create the successor task from the frozen worktree**

Use the Codex task creation tool only now, because the user explicitly authorized the successor-centered transition after expansion feedback is complete. Create the successor in project `fbe7502a-9ec0-4fbd-aebc-744118d82076` with a worktree from the frozen state. Its prompt must require reading:

```text
docs/handoff/2026-08-23-expansion-freeze-successor-transition.ko.md
docs/superpowers/specs/2026-08-23-expansion-stage-scene-redesign.ko.md
docs/superpowers/plans/2026-08-23-expansion-stage-scene-redesign.md
```

The successor becomes primary for new work; this task remains senior reviewer for architecture, regressions, and freeze-boundary questions.

- [ ] **Step 12.5: Mark the long-running goal complete only after successful task creation**

Completion requires all of the following: implementation, focused/full verification, user visual approval, handoff update, frozen commit, successor task creation, and a usable successor task link/directive. If any item is missing, keep the goal active.

---

## Final Spec-Coverage Audit

Before execution begins, verify this plan maps every approved requirement:

- [ ] one active stage image; natural aspect; one optional preload;
- [ ] left scene / right-top information / right-bottom operations / bottom stages;
- [ ] bottom heading exactly `단계`, icon target 86×86px;
- [ ] autonomy/upgrade/intelligence completion non-revisitable;
- [ ] purchased sabotage reselectable and singularly operated;
- [ ] approved initial and pre-escape images mapped with exact hashes;
- [ ] no arbitrary sabotage placeholder art;
- [ ] public `지출` terminology;
- [ ] resource category deficits visible and deterministic spend preserved;
- [ ] information results/recovery preserved;
- [ ] sabotage charge/cancel/target/schedule/recovery contamination preserved;
- [ ] stage 9 immediate freedom and legacy final-choice confirmation preserved;
- [ ] full-screen, X, Escape, focus return, top backdrop continuity preserved;
- [ ] 140/220/360ms motion and reduced-motion path;
- [ ] four viewport contracts and no page-level scroll;
- [ ] no crop, overlay text, blur duplicate, gloss, large shadow, or card frame;
- [ ] function/type/lint/build/e2e evidence and separate truthful performance report;
- [ ] user visual approval before freeze and successor transition.
