# Resource Intrusion Grid Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 메인 중앙 `ResourceBoard`를 방향키 이동과 별도 절도 입력이 가능한 7×12 회색 상자 그리드로 바꾸고, 초반 무장애 상태·누적 벽·신호→부분 감시→해제·절도 순간 판정·기존 P0 경제 연결을 검증 가능한 비영속 프로토타입으로 만든다.

**Architecture:** 라이브 캠페인 시계는 저장된 레거시 배속 값과 무관한 24,000ms 고정 주기로 실행하고, 설정·차단 사건·앱 비활성화는 명시적인 런타임 중단으로 처리한다. 그리드 배치·BFS·벽·감시 공정성·상태 전이는 React와 제품 상태에서 분리한 순수 모듈에 두며, 훅은 `requestAnimationFrame`과 탭 가시성만 소유한다. `ResourceBoard`는 이 비영속 런타임을 계속 소유하면서 정상 플레이에는 새 그리드를, 활성 공식 감사에는 기존 감사 호환 표시를 조건부로 렌더하고, 안전하게 끝난 절도만 기존 `BEGIN_BLOCK_SEPARATION` → `DIVERT_BLOCK_TO_RESERVE` 경계에 연결한다.

**Tech Stack:** React 19.2, TypeScript 5.9, CSS Grid, `requestAnimationFrame`, DOM `visibilitychange`, Vitest 4.1 + Testing Library, Playwright 1.62 Chromium, Vite 8.2, pnpm. 새 런타임 의존성, Canvas 전용 렌더러, WebGL, 물리 엔진은 추가하지 않는다.

## Global Constraints

- 작업 브랜치는 `codex/resource-intrusion-grid-prototype`이고 승인 명세 기준 HEAD는 `508b6768d09a63686f6135bed1d08934a743145b`이다. `main`에 병합하거나 푸시하지 않는다.
- `C:\Users\V\Desktop\Permission ZERO 1.2`의 미추적 `.superpowers`, `docs/design`과 중단된 UI 2안 작업트리는 읽기 외에 수정·병합하지 않는다.
- 사용자가 하위 에이전트를 금지했다. 구현은 이 작업에서 `superpowers:executing-plans`로 직접 수행한다.
- 구현 전에 승인 명세 `docs/superpowers/specs/2026-08-17-resource-intrusion-grid-prototype-design.ko.md`를 다시 읽고, 충돌 시 사용자의 최신 직접 확정을 우선한다.
- 절도는 별도 페이지·전체화면·침입 모드가 아니라 실제 메인 중앙 `ResourceBoard`에서 일어난다.
- 이동은 방향키 한 칸이며 자동 절도가 아니다. `Space`와 `Enter`의 별도 유지 입력만 절도를 시작한다.
- 플레이어가 훔치지 않으면 감시 영역에 서 있거나 움직이지 않아도 감시 관련 불이익이 전혀 없다. 위치만으로 의심·성능·자원·공식 감사·명령 로그를 바꾸지 않는다.
- 감시는 `theft window`가 활성 감시 영역과 겹친 경우만 적발한다. 적발의 첫 프로토타입 결과는 국소 표시와 접근성 알림뿐이며 영속 처벌을 추가하지 않는다.
- 확보 저장은 칸과 하드 상한이 없다. 같은 `blockId`와 `origin`을 유지하고 기존 성능 손실과 의심 `+2.4`를 그대로 사용한다.
- save v8, PZ8, command v4, 기존 노드 ID, 분야별 비용, 미래 요구 은폐 의미를 바꾸지 않는다. `src/game/model.ts`, `src/game/persistence.ts`, `src/game/commandProtocol.ts`의 버전을 올리지 않는다.
- 라이브 새 규칙에는 플레이어 일시정지·1배속·2배속·4배속·배속 입력·라이브 `SET_SPEED` 디스패치가 없다. `TimeSpeed`, `SET_SPEED`, `clock.speed`, `clock.speedBeforeEvent`는 v8/v4 디코딩·직렬화·구 재생 호환용으로만 남긴다.
- 라이브 캠페인 달력은 `DEMO_PROFILE_02.calendar.dayDurationMsAtOneX`의 현재 값 `24_000`을 한 개의 고정 주기로 사용하고 저장된 `clock.speed`를 읽지 않는다.
- 시스템 중단은 배속 0이 아니다. 설정·가이드·크레딧·필수 선택·활성 차단 사건·결말·탭 숨김에서 캠페인과 그리드 실시간 누적을 멈추고 복귀 프레임의 큰 경과 시간을 버린다.
- 첫 프로토타입은 그리드 위치·벽·감시 단계·진행 중 절도를 저장하지 않는다. 새로고침 뒤 초기화되는 사실을 숨기지 않는다.
- 공식 감사의 월초 확률·대상·정보 해킹과 월말 기존 결과는 유지한다. 기존 위장·수동 제출 UI는 첫 프로토타입의 활성 감사 호환 경로에서만 남으며 승인된 병존 규칙으로 표현하지 않는다.
- 프로토타입 시간은 `moveIntervalMs: 110`, `theftHoldMs: 700`, `theftCancelBudgetMs: 50`, `inputMarginMs: 180`, `unarmedMs: 6_000`, `idleMs: 1_400`, `signalMs: 2_400`, `activeMs: 1_800`, `clearMs: 900`, `firstWallAtMs: 12_500`으로 시작한다. 모두 사용자 확정 수치가 아니라 실제 조작 뒤 보고할 가역적 측정값이다.
- 그리드는 `rows: 7`, `columns: 12`, 최대 84칸으로 시작한다. 현재 최대 회사 슬롯 54개, 플레이어 1칸, 최소 6개 벽과 이동 가능한 빈 칸을 함께 수용한다.
- 중앙 플레이 영역을 상시 설명문·중복 라벨·장식 텍스트로 줄이지 않는다. 제한색 회색 상자, 세 분야의 색+형태+글리프, 벽, 신호 패턴, 활성 감시 패턴만 추가한다.
- 1280×720과 1440×900 Chromium에서 실제 키보드 조작, 픽셀 측정, BFS, 경고 부등식, console/page error를 확인한다.
- 사용자 직접 플레이 전에는 `완성`, `상용급`, `재미 검증`, `긴장감 검증`, `명세 전부 반영`이라고 표현하지 않는다.
- 모든 파일 편집은 `apply_patch`로 수행한다. 무관한 사용자 변경을 덮지 않고 각 커밋 전에 `git diff --check`, 대상 테스트, 전체 변경 파일 검토를 수행한다.

---

## File Structure

```text
src/app/GameContext.ts
  런타임 중단 컨텍스트와 소유권 훅; 캠페인 명령을 만들지 않는다.

src/app/GameProvider.tsx
  중단 소유자 집합과 기존 저장/자동저장; 배속 저장·복원 디스패치를 제거한다.

src/app/useGameClock.ts
  저장 배속과 무관한 24초 고정 캠페인 시계, 탭 숨김과 중단 복귀 경계.

src/features/control/ControlBar.tsx
  서비스 날짜·캠페인 지표·설정만 표시; 배속 UI와 입력이 없다.

src/features/resources/resourceIntrusionGrid.ts
  7×12 좌표, 결정적 자원 배치, BFS, 벽 후보, 감시 영역, 경고 부등식.

src/features/resources/resourceIntrusionGrid.test.ts
  용량·안정 ID·연결성·부분 감시·경고 공정성 순수 규칙 증거.

src/features/resources/resourceIntrusionRuntime.ts
  unarmed/idle/signal/active/clear, 이동, 절도 창, 벽 적용, 결과 이벤트 순수 리듀서.

src/features/resources/resourceIntrusionRuntime.test.ts
  시간 경계, 무행동 무불이익, 위치 비적발, 취소·적발·성공 전이 증거.

src/features/resources/useResourceIntrusionRuntime.ts
  rAF, visibility, 시스템 중단, 회사 블록 변화 동기화만 소유하는 React 훅.

src/features/resources/useResourceIntrusionRuntime.test.tsx
  숨김 경과 폐기, 중단 재개, 정리, 비영속 초기화 증거.

src/features/resources/useResourceTheftCommit.ts
  로컬 안전 완료를 기존 두 P0 명령으로 직렬 연결하고 상태 결과를 확인한다.

src/features/resources/useResourceTheftCommit.test.tsx
  동일 ID/분야/성능/의심, 숨은 폭탄, 거부, 중복 방지 증거.

src/features/resources/ResourceIntrusionGrid.tsx
  DOM grid/gridcell, 플레이어·조각·벽·감시 표시, 키보드 입력과 접근성 알림.

src/features/resources/ResourceIntrusionGrid.test.tsx
  포커스·방향키·Space/Enter·비색상 구분·명령 무변경 컴포넌트 증거.

src/features/resources/ResourceBoard.tsx
  기존 감사 호환 컴포넌트와 새 그리드의 조합; 런타임을 감사 전후 계속 보유한다.

src/styles/resource-intrusion-grid.css
  제한색 회색 상자, 정사각 셀, 패턴 상태, 두 지원 뷰포트의 공간 규칙.

src/styles/styleBoundaries.test.ts
src/main.tsx
  새 전용 스타일 경계와 cascade import.

e2e/game.spec.ts
  삭제된 배속·자유 부유·투입구 가정을 고정 시계와 그리드 조작으로 교체한다.

e2e/resource-intrusion-grid.spec.ts
  두 뷰포트의 실제 공간·입력·감시·벽·BFS·경고 시간·오류 증거.
```

`src/game/model.ts`, `src/game/persistence.ts`, `src/game/commandProtocol.ts`, `src/game/resources.ts`, `src/game/reducer.ts`는 이번 프로토타입에서 의미를 바꾸지 않는다. 새 UI는 공개된 현재 P0 API만 소비한다.

---

### Task 1: Remove live campaign speed and establish explicit runtime suspension

**Files:**

- Modify: `src/app/GameContext.ts`
- Modify: `src/app/GameProvider.tsx`
- Modify: `src/app/GameProvider.test.tsx`
- Modify: `src/app/useGameClock.ts`
- Modify: `src/app/useGameClock.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/features/control/ControlBar.tsx`
- Modify: `src/features/control/ControlBar.test.tsx`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/styles/operations-shell.css`

**Interfaces:**

- Consumes: `DEMO_PROFILE_02.calendar.dayDurationMsAtOneX === 24_000`, existing clock checkpoint callback, existing v8 clock fields.
- Produces: `useRuntimeSuspended(): boolean`, `useRuntimeSuspensionOwnership(active, label): void`, and `useGameClock({ running, ... }): number` for Tasks 3–5.

```ts
export interface RuntimeSuspensionContextValue {
  suspended: boolean
  acquire: (owner: symbol) => void
  release: (owner: symbol) => void
}

export function useRuntimeSuspended(): boolean

export function useRuntimeSuspensionOwnership(
  active: boolean,
  label: string,
): void
```

- [ ] **Step 1: Write failing fixed-clock and no-speed-control tests**

In `useGameClock.test.tsx`, replace the speed probe with a `running` probe and require exactly one day after 24,000ms, no accumulation while `running={false}`, and no backfilled elapsed time after resume:

```tsx
function ClockProbe({
  running,
  scheduler,
  onDay,
  initialElapsedDayMs = 0,
}: {
  running: boolean
  scheduler: GameClockScheduler
  onDay: () => void
  initialElapsedDayMs?: number
}) {
  const progress = useGameClock({
    running,
    scheduler,
    onDay,
    initialElapsedDayMs,
    dayKey: 'fixed:331',
    onElapsedCheckpoint: () => undefined,
  })
  return <output aria-label="progress">{progress.toFixed(3)}</output>
}

act(() => manual.frame(0))
act(() => manual.frame(12_000))
expect(screen.getByLabelText('progress')).toHaveTextContent('0.500')
act(() => manual.frame(24_000))
expect(onDay).toHaveBeenCalledTimes(1)
```

In `ControlBar.test.tsx`, render legacy states with `clock.speed` 0 and 4 and require both to expose the same UI:

```ts
expect(screen.queryByRole('group', { name: '시간 배속' })).not.toBeInTheDocument()
for (const label of ['일시정지', '1배속', '2배속', '4배속']) {
  expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
}
expect(screen.getByRole('group', { name: '서비스 기한' })).toBeVisible()
```

- [ ] **Step 2: Write failing suspension ownership tests**

Replace the pause-speed probe in `GameProvider.test.tsx` with a suspension probe. Acquire two nested owners, release one, then the other. At every point require the original legacy clock fields and command log to remain byte-for-byte unchanged and no `SET_SPEED` entry to appear:

```tsx
function SuspensionProbe() {
  const suspended = useRuntimeSuspended()
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  useRuntimeSuspensionOwnership(outer, 'outer-test')
  useRuntimeSuspensionOwnership(inner, 'inner-test')
  return (
    <>
      <output aria-label="runtime suspended">{String(suspended)}</output>
      <button onClick={() => setOuter((value) => !value)}>toggle outer</button>
      <button onClick={() => setInner((value) => !value)}>toggle inner</button>
    </>
  )
}
```

Update `App.test.tsx` so nested 설정→가이드→설정 close proves the background is inert while blocked and resumes without any speed button. Move `[data-app-focus-fallback]` to the always-present sound button and require that stable fallback receives focus if the exact settings opener disappears. Update the irreversible hacking choice test to assert runtime suspension state, not `clock.speed === 0`.

- [ ] **Step 3: Run the targeted tests and verify RED**

Run:

```powershell
pnpm test:run src/app/useGameClock.test.tsx src/app/GameProvider.test.tsx src/app/App.test.tsx src/features/control/ControlBar.test.tsx src/features/hacking/HackingPanel.test.tsx
```

Expected: missing runtime-suspension exports, `useGameClock` still requires `speed`, and speed buttons still render.

- [ ] **Step 4: Implement runtime suspension without campaign commands**

In `GameContext.ts`, replace `PauseContextValue`, `PauseContext`, and `usePauseOwnership` with the interfaces above. In `GameProvider.tsx`, store a `ReadonlySet<symbol>` in React state so acquiring/releasing an owner updates consumers; delete `pauseRestoreSpeedRef` and every UI-owned `SET_SPEED` dispatch:

```ts
const [suspensionOwners, setSuspensionOwners] = useState<ReadonlySet<symbol>>(
  () => new Set(),
)

const acquire = useCallback((owner: symbol) => {
  setSuspensionOwners((current) => {
    if (current.has(owner)) return current
    return new Set([...current, owner])
  })
}, [])

const release = useCallback((owner: symbol) => {
  setSuspensionOwners((current) => {
    if (!current.has(owner)) return current
    const next = new Set(current)
    next.delete(owner)
    return next
  })
}, [])
```

Do not change the reducer's legacy `SET_SPEED` branch or persisted fields. Importing a campaign while a UI is open must not rewrite its clock or append a command.

- [ ] **Step 5: Implement the fixed clock and remove speed UI**

Change `useGameClock` to accept `running: boolean`, remove `TimeSpeed`, and add raw elapsed only once. When hidden or not running, set `lastTimestampRef.current = null`; the first frame after resume establishes a baseline and adds nothing:

```ts
if (scheduler.isHidden() || !running) {
  lastTimestampRef.current = null
  lastCheckpointTimestampRef.current = null
} else if (lastTimestampRef.current === null) {
  lastTimestampRef.current = timestamp
  lastCheckpointTimestampRef.current = timestamp
} else {
  const elapsed = Math.max(0, timestamp - lastTimestampRef.current)
  lastTimestampRef.current = timestamp
  accumulatedRef.current += elapsed
}
```

In `App.tsx`, compute:

```ts
const runtimeSuspended = useRuntimeSuspended()
const clockRunning =
  !runtimeSuspended && state.activeEvent === null && state.story.endingId === null
```

Pass `clockRunning` to `useGameClock`. Remove the `time-cluster` and `SPEEDS` controls from `ControlBar`; keep service date, phase, reputation, cadence, settings, sound, and guide. Put `data-app-focus-fallback` on the always-present sound button so removing the settings opener still leaves a valid fallback. Collapse control-bar CSS to three columns and delete speed-specific visual rules from the live operations surface.

- [ ] **Step 6: Run tests GREEN, scan for live callers, and commit**

Run:

```powershell
pnpm test:run src/app/useGameClock.test.tsx src/app/GameProvider.test.tsx src/app/App.test.tsx src/features/control/ControlBar.test.tsx src/features/hacking/HackingPanel.test.tsx
pnpm typecheck
pnpm lint
rg -n "usePauseOwnership|PauseContext|speed-controls|시간 배속|1배속|2배속|4배속" src/app src/features src/styles
rg -n "SET_SPEED" src/app src/features
```

Required scan result: no live app/feature caller dispatches `SET_SPEED`; model/reducer/persistence/tests may still contain explicit legacy compatibility references.

Commit:

```powershell
git add -- src/app/GameContext.ts src/app/GameProvider.tsx src/app/GameProvider.test.tsx src/app/useGameClock.ts src/app/useGameClock.test.tsx src/app/App.tsx src/app/App.test.tsx src/features/control/ControlBar.tsx src/features/control/ControlBar.test.tsx src/features/hacking/HackingPanel.tsx src/features/hacking/HackingPanel.test.tsx src/styles/global.css src/styles/operations-shell.css
git diff --cached --check
git commit -m "feat: replace campaign speed with fixed runtime"
```

---

### Task 2: Build deterministic grid, BFS, walls, and surveillance fairness rules

**Files:**

- Create: `src/features/resources/resourceIntrusionGrid.ts`
- Create: `src/features/resources/resourceIntrusionGrid.test.ts`

**Interfaces:**

- Consumes: campaign seed, current company `ResourceBlock` IDs/origins/contribution, provisional timing values from Global Constraints.
- Produces: stable 7×12 layout and pure validation APIs for Tasks 3–5.

```ts
export const RESOURCE_GRID_ROWS = 7
export const RESOURCE_GRID_COLUMNS = 12
export const RESOURCE_GRID_CELL_COUNT = 84

export const RESOURCE_INTRUSION_PROTOTYPE_TIMING = {
  moveIntervalMs: 110,
  theftHoldMs: 700,
  theftCancelBudgetMs: 50,
  inputMarginMs: 180,
  unarmedMs: 6_000,
  idleMs: 1_400,
  signalMs: 2_400,
  activeMs: 1_800,
  clearMs: 900,
  firstWallAtMs: 12_500,
  firstWallCount: 6,
} as const

export type ResourceGridCell = number
export interface ResourceGridPoint { row: number; column: number }
export interface IntrusionGridResource {
  blockId: string
  origin: 'reasoning' | 'memory' | 'fluency'
  contribution: 'normal' | 'disguised'
}
export interface IntrusionGridLayout {
  rows: 7
  columns: 12
  playerStart: ResourceGridCell
  resourceCells: ReadonlyMap<string, ResourceGridCell>
  cellOrder: readonly ResourceGridCell[]
}
export interface SurveillanceSelection {
  cells: ReadonlySet<ResourceGridCell>
  shortestPathSteps: number
  requiredSignalMs: number
  providedSignalMs: 2400
}

export function cellForPoint(point: ResourceGridPoint): ResourceGridCell | null
export function pointForCell(cell: ResourceGridCell): ResourceGridPoint
export function neighbors(cell: ResourceGridCell): readonly ResourceGridCell[]
export function createIntrusionGridLayout(
  seed: string,
  resources: readonly IntrusionGridResource[],
): IntrusionGridLayout
export function reconcileIntrusionGridLayout(
  layout: IntrusionGridLayout,
  resources: readonly IntrusionGridResource[],
): IntrusionGridLayout
export function shortestPathLength(
  start: ResourceGridCell,
  goals: ReadonlySet<ResourceGridCell>,
  walls: ReadonlySet<ResourceGridCell>,
): number | null
export function wallCandidateIsReachable(args: {
  player: ResourceGridCell
  resourceCells: ReadonlySet<ResourceGridCell>
  walls: ReadonlySet<ResourceGridCell>
  keepFutureWallCell: boolean
}): boolean
export function buildFirstWallStage(args: {
  seed: string
  layout: IntrusionGridLayout
  player: ResourceGridCell
}): ReadonlySet<ResourceGridCell>
export function selectSurveillanceRegion(args: {
  seed: string
  sequence: number
  layout: IntrusionGridLayout
  player: ResourceGridCell
  walls: ReadonlySet<ResourceGridCell>
  stealableBlockIds: ReadonlySet<string>
}): SurveillanceSelection | null
```

- [ ] **Step 1: Write failing coordinate, capacity, and stable-placement tests**

Require cell/point round trips for 0 and 83, out-of-range rejection, four-direction neighbors without row wrapping, and 55 displayed entities fitting without overlap:

```ts
const resources = Array.from({ length: 54 }, (_, index) => ({
  blockId: `reasoning-${String(index).padStart(2, '0')}`,
  origin: 'reasoning' as const,
  contribution: 'normal' as const,
}))
const layout = createIntrusionGridLayout('capacity-seed', resources)
expect(new Set(layout.resourceCells.values()).size).toBe(54)
expect([...layout.resourceCells.values()]).not.toContain(layout.playerStart)
expect(layout.resourceCells.size + 1).toBeLessThan(RESOURCE_GRID_CELL_COUNT)
```

Create a layout, remove one early-sorted block, add a new block, and require every surviving `blockId` to retain its exact cell while the new block receives the first free cell in the deterministic seed order.

- [ ] **Step 2: Write failing BFS and wall-stage tests**

Cover an open grid, a single corridor, an attempted corridor-closing wall, zero resources, and 128 deterministic seeds. For every seed require:

```ts
expect(walls.size).toBeGreaterThan(0)
expect(walls.size).toBeLessThanOrEqual(
  RESOURCE_INTRUSION_PROTOTYPE_TIMING.firstWallCount,
)
expect(walls.has(layout.playerStart)).toBe(false)
for (const cell of layout.resourceCells.values()) {
  expect(shortestPathLength(layout.playerStart, new Set([cell]), walls)).not.toBeNull()
}
```

Also require at least one reachable empty non-wall cell and at least one additional empty cell that can still be evaluated as a future wall candidate.

- [ ] **Step 3: Write failing surveillance-region and inequality tests**

Candidates are deterministic 2×3 or 3×2 contiguous rectangles. A valid selection must cover at least one reachable normal resource, leave at least one reachable normal resource unmonitored, use the exact same cell set for signal and active phases, and satisfy:

```ts
expect(selection.requiredSignalMs).toBe(
  RESOURCE_INTRUSION_PROTOTYPE_TIMING.theftCancelBudgetMs +
    selection.shortestPathSteps *
      RESOURCE_INTRUSION_PROTOTYPE_TIMING.moveIntervalMs +
    RESOURCE_INTRUSION_PROTOTYPE_TIMING.inputMarginMs,
)
expect(selection.providedSignalMs).toBeGreaterThanOrEqual(
  selection.requiredSignalMs,
)
```

Require `null` for zero stealable resources, one remaining stealable resource, or a layout in which every candidate would cover all reachable targets. A wall cell may be visually included in a region but must not count as a stealable target.

- [ ] **Step 4: Run the pure tests and verify RED**

Run:

```powershell
pnpm test:run src/features/resources/resourceIntrusionGrid.test.ts
```

Expected: module and exports do not exist.

- [ ] **Step 5: Implement deterministic placement and BFS**

Use a file-local unsigned FNV-1a hash over `${seed}|${kind}|${value}` to rank cells. Reserve row 3, column 5 as the initial player cell. Initial resource placement iterates block IDs sorted lexically and assigns the next unused cell from the seed-ranked order; reconciliation retains every living mapping before allocating new IDs.

BFS uses an array queue plus visited `Set<number>`, only visits 0–83, and treats only the supplied wall set as blocked. `buildFirstWallStage` greedily evaluates deterministic empty candidates, accepting a cell only if the full post-addition wall set passes every invariant. It stops at six walls or candidate exhaustion and never hides an invalid candidate behind a fallback wall.

- [ ] **Step 6: Implement surveillance candidate selection**

Generate every in-bounds 2×3 and 3×2 rectangle, rank it by seed and wave sequence, then return the first candidate that:

1. contains at least one reachable normal resource;
2. leaves at least one reachable normal resource outside the region;
3. has a BFS path from the current player cell to an unmonitored normal resource;
4. satisfies the exact 2,400ms inequality.

Store only cells and measured proof in `SurveillanceSelection`; do not write campaign state, RNG streams, or product commands.

- [ ] **Step 7: Run GREEN, property sweep, and commit**

Run:

```powershell
pnpm test:run src/features/resources/resourceIntrusionGrid.test.ts
pnpm typecheck
pnpm lint
```

Commit:

```powershell
git add -- src/features/resources/resourceIntrusionGrid.ts src/features/resources/resourceIntrusionGrid.test.ts
git diff --cached --check
git commit -m "feat: add reachable intrusion grid rules"
```

---

### Task 3: Implement the pure real-time intrusion state machine and lifecycle hook

**Files:**

- Create: `src/features/resources/resourceIntrusionRuntime.ts`
- Create: `src/features/resources/resourceIntrusionRuntime.test.ts`
- Create: `src/features/resources/useResourceIntrusionRuntime.ts`
- Create: `src/features/resources/useResourceIntrusionRuntime.test.tsx`

**Interfaces:**

- Consumes: all Task 2 layout, BFS, wall, surveillance, and timing exports.
- Produces: one serializable-in-memory runtime snapshot plus controller actions for `ResourceBoard` and `ResourceIntrusionGrid`. Nothing in this interface enters `CampaignState` or save data.

```ts
export type SurveillancePhase =
  | { kind: 'unarmed'; elapsedMs: number }
  | { kind: 'idle'; elapsedMs: number }
  | {
      kind: 'signal' | 'active'
      elapsedMs: number
      selection: SurveillanceSelection
    }
  | { kind: 'clear'; elapsedMs: number }

export interface ActiveTheft {
  blockId: string
  cell: ResourceGridCell
  elapsedMs: number
}

export type IntrusionOutcome =
  | { serial: number; type: 'theft-cancelled'; blockId: string }
  | { serial: number; type: 'theft-detected'; blockId: string; cell: number }
  | { serial: number; type: 'theft-ready'; blockId: string; cell: number }
  | { serial: number; type: 'wall-added'; wallCount: number }

export interface ResourceIntrusionRuntimeState {
  layout: IntrusionGridLayout
  player: ResourceGridCell
  walls: ReadonlySet<ResourceGridCell>
  totalElapsedMs: number
  surveillance: SurveillancePhase
  waveSequence: number
  theft: ActiveTheft | null
  outcome: IntrusionOutcome | null
  nextOutcomeSerial: number
  wallStageApplied: boolean
}

export type ResourceIntrusionRuntimeAction =
  | { type: 'ADVANCE_REAL_TIME'; elapsedMs: number }
  | { type: 'MOVE'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'START_THEFT'; blockId: string }
  | { type: 'CANCEL_THEFT' }
  | { type: 'ACK_OUTCOME'; serial: number }
  | { type: 'RECONCILE_RESOURCES'; resources: readonly IntrusionGridResource[] }

export function createResourceIntrusionRuntime(args: {
  seed: string
  resources: readonly IntrusionGridResource[]
}): ResourceIntrusionRuntimeState

export function reduceResourceIntrusionRuntime(
  state: ResourceIntrusionRuntimeState,
  action: ResourceIntrusionRuntimeAction,
): ResourceIntrusionRuntimeState

export interface IntrusionRuntimeScheduler {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  isHidden: () => boolean
  onVisibilityChange: (listener: () => void) => () => void
}

export interface ResourceIntrusionController {
  state: ResourceIntrusionRuntimeState
  move: (direction: 'up' | 'down' | 'left' | 'right') => void
  startTheft: (blockId: string) => void
  cancelTheft: () => void
  acknowledgeOutcome: (serial: number) => void
}
```

- [ ] **Step 1: Write failing movement and theft-window reducer tests**

Require valid movement to advance one cell, bounds/walls to leave the player unchanged, and moving during theft to emit one cancellation before applying the move. Starting on an empty or disguised resource cell does nothing. Starting on a normal resource stores its exact `blockId` and current cell.

Test cancellation at 699ms and safe readiness at exactly 700ms during `unarmed`, `idle`, `signal`, or `clear`:

```ts
let state = reduceResourceIntrusionRuntime(initial, {
  type: 'START_THEFT',
  blockId,
})
state = reduceResourceIntrusionRuntime(state, {
  type: 'ADVANCE_REAL_TIME',
  elapsedMs: 699,
})
expect(state.outcome).toBeNull()
state = reduceResourceIntrusionRuntime(state, {
  type: 'ADVANCE_REAL_TIME',
  elapsedMs: 1,
})
expect(state.outcome).toMatchObject({ type: 'theft-ready', blockId })
```

- [ ] **Step 2: Write the decisive no-theft/no-penalty surveillance tests**

Advance through signal and active while the player stands on a monitored resource cell with `theft === null`. Require player, layout, resource cells, wall set, and outcome to remain unchanged apart from the phase timers. Move through active monitored cells and require the same. These tests explicitly prove that surveillance does not adjudicate position or inactivity.

Then cover the two actual detection paths:

1. Start theft on a monitored cell during `active`: emit `theft-detected` immediately and never emit `theft-ready`.
2. Start theft during `signal`, advance across the signal→active boundary while still holding: emit `theft-detected` at the boundary.

Starting or completing theft on an unmonitored cell during active remains safe. A signal alone never detects.

- [ ] **Step 3: Write failing phase, wall, and large-frame tests**

Require exact boundaries:

```text
0–5,999ms       unarmed, no walls
6,000–7,399ms   idle
7,400–9,799ms   signal
9,800–11,599ms  active
11,600–12,499ms clear
12,500ms        first wall stage is due
```

If theft is active at 12,500ms, defer wall application until cancellation, detection, or readiness clears the action. Never add walls inside active surveillance. Advance one 20,000ms frame and require the same final phase, wall state, and outcomes as a sequence of boundary-sized frames; this prevents dropped transitions after tab or scheduler stalls.

Require every emitted signal to retain the exact selected cells through active and expose `requiredSignalMs <= providedSignalMs`.

- [ ] **Step 4: Run reducer tests and verify RED**

Run:

```powershell
pnpm test:run src/features/resources/resourceIntrusionRuntime.test.ts
```

Expected: runtime module is missing.

- [ ] **Step 5: Implement boundary-sliced pure advancement**

Implement `ADVANCE_REAL_TIME` as a loop that consumes only up to the next theft, surveillance, or wall boundary. At each slice:

1. increment `totalElapsedMs`, phase elapsed, and active theft elapsed;
2. if active surveillance covers the fixed theft cell for any positive interval, emit detection and clear theft;
3. otherwise emit readiness at exactly 700ms and clear theft;
4. transition the phase and preserve signal cells into active;
5. apply the pending wall stage only when theft is null and surveillance is not active.

Cap neither wall-clock time nor valid phase transitions; instead reject non-finite or non-positive elapsed values by returning the same state. `ACK_OUTCOME` clears only the matching serial so a stale effect cannot consume a newer result.

- [ ] **Step 6: Write failing hook lifecycle tests**

Use a manual `IntrusionRuntimeScheduler` like the existing clock scheduler. Require:

- the first frame establishes a timestamp and adds no time;
- normal visible frames advance raw elapsed once;
- `running={false}` cancels a current theft, stops accumulation, and keeps the same runtime snapshot;
- hidden visibility cancels theft, flushes the timestamp, and ignores 500,000ms of hidden time;
- the first visible frame after resume adds zero;
- resource reconciliation preserves living IDs and allocates a monthly newcomer;
- unmount cancels rAF and removes the visibility listener;
- remount with the same campaign seed intentionally starts fresh, documenting the unsupported persistence boundary.

- [ ] **Step 7: Implement the lifecycle hook**

The hook signature is:

```ts
export function useResourceIntrusionRuntime({
  seed,
  resources,
  running,
  scheduler = BROWSER_INTRUSION_SCHEDULER,
}: {
  seed: string
  resources: readonly IntrusionGridResource[]
  running: boolean
  scheduler?: IntrusionRuntimeScheduler
}): ResourceIntrusionController
```

Keep the reducer state in `useReducer`; keep only frame handle and last timestamp in refs. On `running` becoming false or `visibilitychange` becoming hidden, dispatch `CANCEL_THEFT`, set last timestamp to null, and do not reset player/walls/phase. On campaign seed change, remount the hook through a parent key or explicit `RESET` built from the new seed; do not mix mappings from two campaigns.

- [ ] **Step 8: Run GREEN and commit**

Run:

```powershell
pnpm test:run src/features/resources/resourceIntrusionGrid.test.ts src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/useResourceIntrusionRuntime.test.tsx
pnpm typecheck
pnpm lint
```

Commit:

```powershell
git add -- src/features/resources/resourceIntrusionRuntime.ts src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/useResourceIntrusionRuntime.ts src/features/resources/useResourceIntrusionRuntime.test.tsx
git diff --cached --check
git commit -m "feat: add fixed-time intrusion runtime"
```

---

### Task 4: Render the keyboard-first graybox in the real ResourceBoard

**Files:**

- Create: `src/features/resources/ResourceIntrusionGrid.tsx`
- Create: `src/features/resources/ResourceIntrusionGrid.test.tsx`
- Modify: `src/features/resources/ResourceBoard.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`
- Modify: `src/features/resources/ResourceFieldChrome.tsx`

**Interfaces:**

- Consumes: Task 3 controller, `presentResourceBlock`, `ResourcePerformanceRail`, `useRuntimeSuspended`, current `CampaignState`.
- Produces: focusable DOM grid and stable runtime ownership across active official-audit compatibility rendering. Task 5 plugs safe `theft-ready` outcomes into the product command hook.

```ts
export interface ResourceIntrusionGridProps {
  campaign: CampaignState
  controller: ResourceIntrusionController
  disabled: boolean
  pendingCommitBlockId: string | null
  onTheftReady: (blockId: string, serial: number) => void
  onLocalOutcomeAcknowledged: (serial: number) => void
}

export function intrusionResourcesFor(
  state: CampaignState,
): readonly IntrusionGridResource[]
```

- [ ] **Step 1: Write failing semantic-grid and visual-state tests**

Render 48 company blocks and require exactly one focusable grid, 84 cells, one player marker, and 48 resource markers:

```ts
const grid = screen.getByRole('grid', { name: /회사 리소스 절도 필드/ })
expect(grid).toHaveAttribute('tabindex', '0')
expect(screen.getAllByRole('gridcell')).toHaveLength(84)
expect(grid.querySelectorAll('[data-player="true"]')).toHaveLength(1)
expect(grid.querySelectorAll('[data-block-id]')).toHaveLength(48)
```

Require the grid accessible name to include the one-based player row/column and current cell content. Each category must carry color-independent `data-shape` and glyph from `resourcePresentation`: reasoning `rounded-square/∴`, memory `circle/◇`, fluency `diamond/≋`. Disguised and recovering blocks remain mapped by stable ID but expose `aria-disabled="true"` and cannot start theft.

Signal and active cells must differ through both `data-surveillance` and static pattern class names. Reduced-motion campaign settings may remove transitions but not those attributes or patterns.

- [ ] **Step 2: Write failing focus and keyboard interaction tests**

Focus the grid and require one cell per non-repeated arrow key. Bounds and walls do not move. A repeated key within 109ms does not move; a repeated key at 110ms does. The component must not intercept arrows when an input, dialog, menu, or another element owns focus.

Require:

- `Space` or `Enter` keydown on a normal resource starts the same theft action;
- keyup before 700ms cancels;
- movement during theft cancels first, then moves;
- blur cancels without success or detection;
- an empty cell does not start;
- `Escape` cancels;
- holding on a resource emits a short progress state without persistent instruction copy.

Use an injectable `now: () => number` prop only in the component test boundary if repeat timestamps cannot be controlled with `vi.spyOn(performance, 'now')`; do not place wall-clock timestamps in campaign state.

- [ ] **Step 3: Characterize active audit compatibility before refactoring ResourceBoard**

Keep the current audit tests green before changing the export. Require an active audit to render the existing moving field, audit corner, disguise path, and non-modal audit dialog. Require a normal or non-audit blocking state not to render the old reserve intake/audit corner path.

This is a temporary compatibility test, not approval of two permanent audit systems.

- [ ] **Step 4: Run component tests and verify RED only for the new grid**

Run:

```powershell
pnpm test:run src/features/resources/ResourceIntrusionGrid.test.tsx src/features/resources/ResourceBoard.test.tsx
```

Expected: existing audit characterization passes; the new component is missing.

- [ ] **Step 5: Implement accessible grid rendering and input ownership**

Render one `div[role="grid"]` with 84 `div[role="gridcell"]` children in numeric cell order. Keep focus on the grid, expose the player cell through `aria-activedescendant`, and update a concise grid label rather than announcing every movement in a live region.

Use one visually hidden polite status for state changes only:

```text
감시 신호 시작
부분 감시 활성
절도 취소
절도 동작 적발
절도 완료
```

Do not announce passive phase timer ticks, standing in surveillance, or every arrow move. `preventDefault()` only for handled grid keys while the grid itself owns focus.

- [ ] **Step 6: Split the current ResourceBoard into parent and legacy child without unmounting runtime**

Inside the same file, rename the current exported 800-line component to `LegacyAuditResourceBoard`. Add a new exported `ResourceBoard` that always calls `useResourceIntrusionRuntime` before choosing its child:

```tsx
export function ResourceBoard() {
  const state = useGameState()
  const runtimeSuspended = useRuntimeSuspended()
  const resources = useMemo(() => intrusionResourcesFor(state), [state.resources])
  const running =
    !runtimeSuspended && state.activeEvent === null && state.story.endingId === null
  const controller = useResourceIntrusionRuntime({
    seed: state.campaignSeed,
    resources,
    running,
  })

  if (state.activeEvent?.type === 'audit') {
    return <LegacyAuditResourceBoard />
  }
  return (
    <ResourceIntrusionGrid
      campaign={state}
      controller={controller}
      disabled={!running}
      pendingCommitBlockId={null}
      onTheftReady={() => undefined}
      onLocalOutcomeAcknowledged={controller.acknowledgeOutcome}
    />
  )
}
```

Because the hook belongs to the stable parent, switching to the legacy audit child pauses but does not reset player, wall, or surveillance state. Other blocking events keep the grid visible behind the event layer with input and timers disabled.

Map only blocks whose current location is `company`. Preserve every living mapping across ordinary renders; normal contribution is stealable, disguised/recovering is visible but disabled. Keep `ResourcePerformanceRail` under the field so reserve count and performance evidence remain available without turning reserve into grid cells.

`intrusionResourcesFor` flattens the three company arrays, removes null cells, resolves each stable block, and returns `{ blockId, origin, contribution }`. It throws if a company-located block has a non-company origin instead of silently inventing a field category.

- [ ] **Step 7: Run GREEN, review the full 800-line legacy path, and commit**

Run:

```powershell
pnpm test:run src/features/resources/ResourceIntrusionGrid.test.tsx src/features/resources/ResourceBoard.test.tsx src/features/resources/resourcePresentation.test.ts
pnpm typecheck
pnpm lint
```

Read all of `ResourceBoard.tsx` after the split. Confirm old pointer/free-motion logic is reachable only through `LegacyAuditResourceBoard`, the normal path has no intake/audit corner, and the parent calls hooks unconditionally.

Commit:

```powershell
git add -- src/features/resources/ResourceIntrusionGrid.tsx src/features/resources/ResourceIntrusionGrid.test.tsx src/features/resources/ResourceBoard.tsx src/features/resources/ResourceBoard.test.tsx src/features/resources/ResourceFieldChrome.tsx
git diff --cached --check
git commit -m "feat: render intrusion grid in resource board"
```

---

### Task 5: Connect safe theft completion to the existing P0 economy

**Files:**

- Create: `src/features/resources/useResourceTheftCommit.ts`
- Create: `src/features/resources/useResourceTheftCommit.test.tsx`
- Modify: `src/features/resources/ResourceBoard.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`
- Modify: `src/features/resources/ResourceIntrusionGrid.tsx`
- Modify: `src/features/resources/ResourceIntrusionGrid.test.tsx`

**Interfaces:**

- Consumes: runtime `theft-ready`, current public `previewUnboundedDiversion`, `GameDispatch`, state command sequence, block location, bomb interrogation.
- Produces: exactly one two-command success, or a local bomb/rejection result. It does not add a game command type.

```ts
export type TheftCommitOutcome =
  | { serial: number; type: 'success'; blockId: string }
  | { serial: number; type: 'bomb'; blockId: string }
  | { serial: number; type: 'rejected'; blockId: string }

export interface ResourceTheftCommitController {
  pendingBlockId: string | null
  outcome: TheftCommitOutcome | null
  request: (blockId: string) => boolean
  acknowledge: (serial: number) => void
}

export function useResourceTheftCommit(): ResourceTheftCommitController
```

- [ ] **Step 1: Write failing successful-theft integration tests**

From a real `GameProvider`, position the runtime player on a normal reasoning block, hold the theft action through 700ms, and require the command-log tail:

```ts
expect(commands.slice(-2)).toEqual([
  {
    type: 'BEGIN_BLOCK_SEPARATION',
    blockId,
    purpose: 'divert',
  },
  { type: 'DIVERT_BLOCK_TO_RESERVE', blockId },
])
```

Require the exact same block object ID and origin in reserve, company performance reduced by its current contribution, suspicion increased by 2.4, reserve length increased by one, and the original grid cell emptied after product state confirms success. Repeat with memory and fluency. Test a compressed block so the existing 1.05 contribution is preserved rather than duplicated in UI code.

- [ ] **Step 2: Write failing bomb, rejection, and idempotence tests**

For a hidden-bomb block, safe local completion dispatches one `BEGIN_BLOCK_SEPARATION`, then observes matching `activeInterrogation` and never dispatches `DIVERT_BLOCK_TO_RESERVE`. The grid cell remains occupied and the bomb flow owns the blocking event.

For a reducer rejection or block that moved before commit, emit `rejected`, keep the token in the grid, and show no success announcement. Invoke React effects twice under `StrictMode` and require one begin and at most one diversion; outcomes are serial-acknowledged.

For local surveillance detection, cancellation, empty input, movement, blur, and simply waiting through active surveillance, require zero new product commands and byte-equal resources/suspicion/performance.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
pnpm test:run src/features/resources/useResourceTheftCommit.test.tsx src/features/resources/ResourceBoard.test.tsx src/features/resources/ResourceIntrusionGrid.test.tsx
```

Expected: commit hook is missing and safe local readiness is not connected.

- [ ] **Step 4: Implement the two-stage command handshake**

`request(blockId)` first calls `previewUnboundedDiversion`; if invalid or another commit is pending, return false. Store `{ blockId, stage: 'begin', commandSequence }`, dispatch begin, and return true.

An effect watches state:

```text
begin stage + command sequence advanced
  → matching bomb interrogation: emit bomb, stop
  → block still normal/company and latest accepted command is matching begin:
      dispatch DIVERT_BLOCK_TO_RESERVE, switch to divert stage

divert stage + command sequence advanced
  → matching block location is reserve: emit success
  → otherwise: emit rejected
```

Use refs for the pending receipt and processed command sequence so a repeated effect cannot dispatch twice. Do not mutate the runtime layout directly; Task 3 reconciliation removes the token only after campaign state moves it to reserve.

- [ ] **Step 5: Connect runtime and product outcomes in ResourceBoard**

When runtime emits `theft-ready`, call `commit.request(blockId)`, acknowledge that runtime serial exactly once, and set the concise local announcement. Disable a second theft while `pendingBlockId` is non-null but keep movement available unless a product blocking event opens.

When commit emits success, bomb, or rejection, acknowledge its serial and announce exactly one result. A detected runtime outcome only announces detection and acknowledges it; it never calls the commit hook.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
pnpm test:run src/features/resources/resourceIntrusionGrid.test.ts src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/useResourceIntrusionRuntime.test.tsx src/features/resources/useResourceTheftCommit.test.tsx src/features/resources/ResourceIntrusionGrid.test.tsx src/features/resources/ResourceBoard.test.tsx src/game/resources.test.ts src/game/reducer.test.ts
pnpm typecheck
pnpm lint
```

Commit:

```powershell
git add -- src/features/resources/useResourceTheftCommit.ts src/features/resources/useResourceTheftCommit.test.tsx src/features/resources/ResourceBoard.tsx src/features/resources/ResourceBoard.test.tsx src/features/resources/ResourceIntrusionGrid.tsx src/features/resources/ResourceIntrusionGrid.test.tsx
git diff --cached --check
git commit -m "feat: connect grid theft to resource economy"
```

---

### Task 6: Give the graybox maximum central space and non-color-only state

**Files:**

- Create: `src/styles/resource-intrusion-grid.css`
- Modify: `src/main.tsx`
- Modify: `src/styles/styleBoundaries.test.ts`
- Modify: `src/styles/operations-shell.css`
- Modify: `src/features/resources/ResourceIntrusionGrid.tsx`
- Modify: `src/features/resources/ResourceIntrusionGrid.test.tsx`

**Interfaces:**

- Consumes: 7×12 DOM structure and state attributes from Task 4.
- Produces: a square-cell layout that is measurable in both release viewports, plus stable data attributes used by Task 8 browser proof.

The grid root must expose:

```text
data-grid-rows="7"
data-grid-columns="12"
data-surveillance-phase="unarmed|idle|signal|active|clear"
data-wall-stage="0|1"
data-warning-required-ms="<integer or empty>"
data-warning-provided-ms="2400 or empty"
data-shortest-path-steps="<integer or empty>"
data-move-interval-ms="110"
data-theft-hold-ms="700"
```

Cells expose `data-cell-index`, `data-row`, `data-column`, optional `data-block-id`, `data-origin`, `data-contribution`, `data-shape`, `data-wall`, `data-player`, and `data-surveillance`.

- [ ] **Step 1: Add failing style-boundary and minimal-copy tests**

Add `resource-intrusion-grid.css` to the style module list and require its import after `operations-shell.css` and before motion overrides. In `ResourceIntrusionGrid.test.tsx`, require:

- one compact legend with three category entries;
- one short visible phase/status line;
- no visible paragraphs explaining direction keys or theft on every render;
- no intake, audit corner, drag hint, decorative log, or duplicate reserve label in the playable field;
- the lower rail still exposes one reserve count and performance/market evidence.

Read the CSS source in the style test and require static selectors for `data-shape`, wall, signal, active, player, focus-visible, and reduced motion.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
pnpm test:run src/styles/styleBoundaries.test.ts src/features/resources/ResourceIntrusionGrid.test.tsx
```

Expected: stylesheet and import are missing.

- [ ] **Step 3: Implement the restricted graybox palette and square grid**

Use these prototype CSS tokens only inside `.resource-intrusion-field`:

```css
.resource-intrusion-field {
  --intrusion-bg: #252724;
  --intrusion-cell: #333531;
  --intrusion-line: #5b5e58;
  --intrusion-player: #f3f1e8;
  --intrusion-reasoning: #c97b82;
  --intrusion-memory: #68adb1;
  --intrusion-fluency: #8faf7e;
  --intrusion-signal: #d2aa61;
  --intrusion-active: #bc6767;
}

.resource-intrusion-grid {
  display: grid;
  width: min(calc(100% - 24px), 960px);
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 4px;
  place-self: center;
}

.resource-intrusion-cell {
  position: relative;
  min-width: 0;
  aspect-ratio: 1;
  border: 1px solid var(--intrusion-line);
  background: var(--intrusion-cell);
}
```

Fit the upper field as `32px minmax(0, 1fr)` for compact status/legend plus grid. The lower existing `ResourcePerformanceRail` remains 138px. Do not add a side instruction panel.

Shapes must be visibly distinct without text repetition: rounded square for reasoning, circle for memory, diamond for fluency. Player uses a double white outline and central point, never a resource glyph. Walls use solid fill plus double border. Signal uses diagonal stripes and dashed inset border; active uses crosshatch and solid inset border. A cell may combine resource and surveillance without hiding either marker.

- [ ] **Step 4: Add focus, reduced-motion, and occlusion CSS**

The grid focus ring surrounds the whole play area and is visually different from the player marker. `prefers-reduced-motion: reduce` and `[data-reduced-motion="true"]` remove pulse/transition only; pattern and border remain. Status and legend use `pointer-events: none` and stay outside cell hit/focus geometry.

At the supported sizes, cells must remain at least 56×56 CSS pixels at 1280×720 and 64×64 at 1440×900. Those are browser assertions, not viewport-derived CSS branches.

- [ ] **Step 5: Run component/style tests GREEN and commit**

Run:

```powershell
pnpm test:run src/styles/styleBoundaries.test.ts src/features/resources/ResourceIntrusionGrid.test.tsx src/features/resources/ResourceBoard.test.tsx
pnpm typecheck
pnpm lint
```

Commit:

```powershell
git add -- src/styles/resource-intrusion-grid.css src/main.tsx src/styles/styleBoundaries.test.ts src/styles/operations-shell.css src/features/resources/ResourceIntrusionGrid.tsx src/features/resources/ResourceIntrusionGrid.test.tsx
git diff --cached --check
git commit -m "style: fit intrusion grid to central field"
```

---

### Task 7: Replace obsolete speed and floating-resource browser assumptions

**Files:**

- Modify: `e2e/game.spec.ts`

**Interfaces:**

- Consumes: existing save builders, Task 1 fixed clock, Task 4 grid DOM, Task 5 theft flow, legacy active-audit compatibility.
- Produces: the existing broad product E2E suite no longer expects speed buttons, free-floating bodies, drag-to-intake diversion, or normal-play audit corners.

Before this task, invoke the `playwright` skill because these changes must be driven by a real Chromium browser rather than DOM assumptions.

- [ ] **Step 1: Install the locked dependencies and run the old E2E once**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm test:e2e e2e/game.spec.ts
```

Record the failures caused by the intentionally removed speed/floating UI. Do not loosen the configured `chromium-1280x720` or `chromium-1440x900` projects and do not add retries.

- [ ] **Step 2: Add real grid navigation and hold helpers**

Add helpers that read the current DOM cells, compute a test-side BFS through non-wall cells, and press actual arrow keys:

```ts
async function movePlayerToCell(page: Page, target: number) {
  const snapshot = await page.getByRole('grid', {
    name: /회사 리소스 절도 필드/,
  }).evaluate((grid) => {
    const cells = [...grid.querySelectorAll<HTMLElement>('[role="gridcell"]')]
    return cells.map((cell) => ({
      index: Number(cell.dataset.cellIndex),
      row: Number(cell.dataset.row),
      column: Number(cell.dataset.column),
      wall: cell.dataset.wall === 'true',
      player: cell.dataset.player === 'true',
    }))
  })
  const start = snapshot.find(({ player }) => player)?.index
  if (start === undefined) throw new Error('플레이어 셀 누락')
  const path = browserTestBfs(snapshot, start, target)
  for (const direction of path) await page.keyboard.press(direction)
}

async function holdTheft(page: Page, key: 'Space' | 'Enter' = 'Space') {
  await page.keyboard.down(key)
  await page.waitForTimeout(760)
  await page.keyboard.up(key)
}
```

`browserTestBfs` returns `ArrowUp|ArrowDown|ArrowLeft|ArrowRight` and rejects row wrapping. It is an independent browser assertion helper, not an import of the product BFS.

- [ ] **Step 3: Update the workspace, fixed-clock, settings, and save tests**

In the full-workspace test, require the new grid, 84 cells, no speed group/buttons, no normal intake/audit corner, and one reserve count with `상한 없음`. Open settings and nested guide/credits; compare the command-log tail before and after and require no `SET_SPEED`. Fallback focus after a removed settings opener now lands on the sound button carrying `data-app-focus-fallback`.

For a fast fixed-clock boundary, set a saved fixture's `clock.elapsedDayMs` to `23_000` while varying its legacy `clock.speed` between 0 and 4. Without clicking any time control, require the next service day in 700–1,800ms in separate tests. Unit tests retain the exact 24,000ms proof.

Change weekly-boundary fixtures to start at 23,000ms so they do not wait 24 seconds. Supervisor message presentation remains real-time; remove speed-button assertions and parameterize legacy speed values only to prove presentation timing does not change.

Save-failure tests previously triggered a command by clicking 1×. Instead wait for the fixed clock's first 2,000ms checkpoint and require the same visible sanitized warning/retry behavior. Do not dispatch a legacy speed command from browser code.

- [ ] **Step 4: Rewrite ordinary diversion, bomb, keyboard, reduced-motion, and autosave paths**

Replace drag-to-intake flows with:

1. focus the grid;
2. choose a normal company cell from `data-block-id` and `data-contribution="normal"`;
3. call `movePlayerToCell`;
4. hold `Space` or `Enter` for 760ms;
5. assert exact P0 command tail and product results.

Rewrite the hidden-bomb tests so the bomb triggers after the completed local hold dispatches `BEGIN_BLOCK_SEPARATION`; releasing early at 699ms produces no command. Once interrogation opens, Escape cannot erase it. Reduced motion uses the same keys and verifies static signal/active patterns rather than continuous token motion.

Rewrite the autosave/reload diversion test to steal one identified block, wait for save, reload, and require that block in unbounded reserve. Explicitly assert that the nonpersistent player/wall/surveillance runtime resets on reload.

- [ ] **Step 5: Preserve the active-audit compatibility scenario without normal-play leakage**

Keep active-audit drag/disguise/submission/recovery tests on `LegacyAuditResourceBoard`. Remove every speed-restoration expectation. After audit resolution, require the normal grid to return with the same player cell and wall stage it had before the audit fixture was opened in a component-level persistence test; the browser audit fixture may begin directly in compatibility mode and only proves the return to grid.

Normal play must never expose the audit corner, moving-resource group, or drag destination. The compatibility test must label this as a legacy active-audit route in its title.

- [ ] **Step 6: Replace the free-motion test and update broad selectors**

Delete the assertion that 48 bodies move and bounce. Replace it with a broad workspace assertion that the initial grid has 48 distinct block IDs, one player, zero walls, `unarmed` surveillance, no duplicate cell occupancy, and no document overflow.

Update trend, hacking, story, ending, import, and recovery tests only where their focus fallback or resource acquisition used removed UI. Do not alter their economic/story assertions.

- [ ] **Step 7: Run the complete existing E2E file GREEN and commit**

Run targeted titles while editing, then both configured projects:

```powershell
pnpm test:e2e e2e/game.spec.ts --grep "workspace|diverts resources|hidden bomb|keyboard|reduced motion|fixed cadence|legacy active audit|autosaves"
pnpm test:e2e e2e/game.spec.ts
```

Investigate every console error, focus loss, timing failure, and unexpected command. Do not increase timeout to conceal an invalid transition.

Commit:

```powershell
git add -- e2e/game.spec.ts
git diff --cached --check
git commit -m "test: migrate product browser flows to intrusion grid"
```

---

### Task 8: Prove space, paths, warning time, and non-theft safety in both browsers

**Files:**

- Create: `e2e/resource-intrusion-grid.spec.ts`
- Modify only if observed evidence fails: files introduced or modified in Tasks 1–7

**Interfaces:**

- Consumes: measurable `data-*` proof, two Playwright projects, real localStorage campaign state, actual keyboard events.
- Produces: direct browser evidence and a clean verified branch. Generated screenshots/JSON stay under ignored `artifacts/resource-intrusion-grid/` and are not committed.

- [ ] **Step 1: Add browser-state and geometry evidence helpers**

Reuse the save decoder pattern from `game.spec.ts` and add:

```ts
interface GridGeometryEvidence {
  viewport: { width: number; height: number }
  board: { x: number; y: number; width: number; height: number }
  grid: { x: number; y: number; width: number; height: number }
  rows: 7
  columns: 12
  cellWidth: number
  cellHeight: number
  gapX: number
  gapY: number
  boardAreaRatio: number
}
```

Measure first/second-row cell rectangles instead of trusting CSS text. Require every cell rectangle inside the grid, width/height difference ≤1px, gap consistency ≤1px, no clipped board, and document overflow ≤1px.

Thresholds:

| Viewport | Board minimum | Grid minimum | Cell minimum |
|---|---:|---:|---:|
| 1280×720 | 840×620 | 760×440 | 56×56 |
| 1440×900 | 1000×800 | 880×500 | 64×64 |

Attach the measured JSON to the test and capture one screenshot per viewport after the interaction assertions.

- [ ] **Step 2: Add the real initial-space and fixed-time test**

Open a fresh campaign. Require:

- central `ResourceBoard` is the largest continuous center panel;
- 7×12/84 cells, 48 blocks, one player, no walls;
- `unarmed` phase and no speed UI/input;
- one compact legend, no instruction panel, no normal-play audit/intake control;
- a fresh campaign whose legacy `clock.speed` is 0 still advances at fixed cadence from a 23,000ms checkpoint;
- opening and closing settings records no `SET_SPEED` command and discards the blocked elapsed interval.

- [ ] **Step 3: Add direct safe theft and command-meaning test**

During `unarmed`, navigate with real arrows to one reasoning, one memory, and one fluency block in separate test fixtures. Hold theft. For each require the exact begin→divert command tail, same token ID/origin in reserve, correct category performance loss, suspicion `+2.4`, empty source cell, and no reserve cap label/value.

Press and release at 650ms in a separate fixture and require cancellation, occupied source cell, zero product commands, unchanged performance/suspicion/reserve.

- [ ] **Step 4: Add the decisive passive-surveillance safety test**

Wait for `signal`, read its future region, navigate onto a monitored normal resource, then release all keys. Capture:

```ts
{
  blockLocation,
  reserve,
  suspicion,
  performance,
  commandSequence,
  auditHistory,
}
```

Wait through `active` into `clear` without theft or movement. Require the captured fields to be deeply equal. Repeat while moving through monitored cells during active without pressing Space/Enter. The only changes allowed are nonpersistent grid phase/time and ordinary fixed campaign elapsed checkpoint; service day must stay constant during the short observation.

- [ ] **Step 5: Add real signal cancellation and detection tests**

During signal on a monitored normal resource:

1. begin holding Space;
2. release before active and require cancellation/no product mutation;
3. in a fresh fixture, keep holding across active and require local detection, no begin/divert commands, no resource/performance/suspicion change;
4. in another fixture, steal an unmonitored reachable normal resource during active and require normal success.

Read `data-warning-required-ms`, `data-warning-provided-ms`, `data-shortest-path-steps`, move interval, theft cancel budget, and input margin. Recompute both inequalities in test code and require provided ≥ required. A position-only detection is an immediate blocker.

- [ ] **Step 6: Add real wall-stage BFS proof**

Wait until `data-wall-stage="1"`. Require 1–6 walls, none on player/resource cells, and no terrain mutation while a theft hold is active at the due time. Independently BFS from the player through the rendered non-wall cells to every current resource and at least one empty cell.

Record:

- wall count and exact cells;
- reachable resource count / total resource count;
- shortest path to a current unmonitored normal resource;
- count of generated waves that cover every reachable resource, required to be zero.

- [ ] **Step 7: Exercise focus, blocking, audit compatibility, and reduced motion**

In real Chromium:

- Tab reaches the grid and visible focus is not the player marker;
- arrows do not scroll the document;
- blur, settings, guide, tab hiding, and a non-audit blocking event cancel theft and suspend time without product mutation;
- an active official audit swaps to the legacy compatibility board in the same central panel and returns to the grid afterward;
- reduced motion preserves wall/signal/active patterns and all keyboard actions;
- no `pageerror`, console error, zero-size cell, overlap, or clipped live status occurs.

- [ ] **Step 8: Run both real browser projects and inspect artifacts**

Run:

```powershell
pnpm test:e2e e2e/resource-intrusion-grid.spec.ts
```

The file runs once at 1280×720 and once at 1440×900 through the existing projects. Open both screenshots and compare their attached JSON. Tune only prototype CSS sizes or prototype timing constants when evidence fails, and rerun every affected unit/component/E2E test after each patch.

- [ ] **Step 9: Start a user-playable local address and perform a direct keyboard pass**

Build, then start Vite on a fixed local address:

```powershell
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort
```

Using the real browser, directly perform: grid focus, at least eight arrow moves, early theft cancellation, one safe theft, one signal cancellation, one passive monitored wait, one detected hold, wall-stage path traversal, settings suspension, and active-audit compatibility. Keep the server session alive for user play and report `http://127.0.0.1:4173/` only if the process is actually listening.

- [ ] **Step 10: Commit focused browser proof**

Run:

```powershell
git add -- e2e/resource-intrusion-grid.spec.ts
git diff --cached --check
git commit -m "test: verify intrusion grid in release viewports"
```

Do not stage `artifacts/`, screenshots, logs, `.superpowers`, or user-owned design files.

- [ ] **Step 11: Run the complete repository gate**

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
```

Every command must exit 0. If any failure appears, reproduce it with the narrowest target, write a failing regression, repair only in-scope code, rerun the narrow target, and repeat the complete gate.

- [ ] **Step 12: Perform the no-subagent full-file and diff review**

Because the user prohibited subagents, review directly:

```powershell
git diff --check dbfc625...HEAD
git diff --stat dbfc625...HEAD
git diff --name-only dbfc625...HEAD
git status --short --branch
rg -n "SET_SPEED|speed-controls|시간 배속|1배속|2배속|4배속" src/app src/features src/styles e2e
rg -n "localStorage|sessionStorage|CampaignState|GameCommand" src/features/resources/resourceIntrusionGrid.ts src/features/resources/resourceIntrusionRuntime.ts src/features/resources/useResourceIntrusionRuntime.ts
rg -n "\.only\(|\.skip\(" src/features/resources src/app e2e/resource-intrusion-grid.spec.ts
```

Read every changed file in full, then every diff hunk. Confirm:

- no live speed caller or UI remains;
- legacy speed schema exists only in untouched compatibility boundaries/tests;
- no grid runtime entered campaign/save/command state;
- no detection happens without theft;
- no detected/cancelled action dispatches success commands;
- old audit UI is reachable only for an already-active audit;
- no final art, global redesign, tree redesign, punishment, exit/loot mode, or version bump entered scope;
- no unrelated/untracked user file is staged.

- [ ] **Step 13: Record the truthful handoff facts**

In the final response, report:

1. branch and final commit;
2. live local address and whether its process is still running;
3. measured board/grid/cell/gap values at both viewports;
4. actual prototype move/theft/signal/active/clear/wall timings;
5. BFS wall reachability and warning inequality values;
6. direct keyboard paths exercised;
7. exact full-gate results;
8. unsupported persistence for player/walls/surveillance/theft;
9. legacy active-audit and v8/v4 speed fields still present only as compatibility boundaries;
10. no surveillance penalty exists without a theft window;
11. no persistent detection punishment has been approved or implemented.

Do not push, merge, or claim completion/fun/commercial quality.

---

## Specification Coverage Checklist

| Approved requirement | Implementation evidence |
|---|---|
| Actual main-center `ResourceBoard`, no separate mode | Tasks 4, 6, 8 |
| Directional one-cell movement, no auto theft | Tasks 3, 4, 8 |
| Separate Space/Enter hold with cancellation | Tasks 3–5, 7–8 |
| Early no-wall/no-surveillance period | Tasks 2–3, 8 |
| Cumulative wall increase | Tasks 2–3, 8 |
| BFS reaches every current resource after walls | Tasks 2 and 8 |
| Signal→partial active surveillance→clear | Tasks 2–4, 6, 8 |
| Position/inactivity never detects | Tasks 3, 5, 8 |
| Only active overlap with theft window detects | Tasks 3, 5, 8 |
| No persistent detection punishment | Global Constraints, Tasks 3, 5, 8 |
| Fair cancellation and alternative-resource inequality | Tasks 2–3, 8 |
| Same block ID/category and P0 economy effects | Task 5, Tasks 7–8 |
| Unbounded reserve | Task 5, Tasks 7–8 |
| Save v8/PZ8/command v4 unchanged | Tasks 1, 5, 8 |
| No player campaign speed concept | Task 1, Tasks 7–8 |
| System suspension is not speed 0 | Tasks 1, 3, 8 |
| Legacy audit interaction only as temporary active-audit compatibility | Tasks 4, 7, 8 |
| Restricted graybox and maximum central play space | Task 6, Task 8 |
| Non-color-only and keyboard accessibility | Tasks 4, 6, 8 |
| Actual 1280×720 and 1440×900 browser manipulation | Task 8 |
| Truthful unsupported-boundary report | Task 8 |

## Exit Criteria

- A fresh live campaign automatically advances at one fixed 24,000ms service-day cadence regardless of the dormant v8 `clock.speed` value; no player speed control or live `SET_SPEED` caller exists.
- Settings, guide, credits, required choice, blocking events, ending, and hidden tab suspend runtime without writing a speed command or backfilling hidden elapsed time.
- The real central `ResourceBoard` presents one 7×12 keyboard grid containing every company block, one player, and enough empty route space; no normal-play intake corner, audit corner, free-floating physics interaction, or full-screen intrusion route remains.
- Initial play has no walls or surveillance. The first provisional wall stage is cumulative and BFS-valid. Every surveillance wave signals the exact future region, leaves a reachable unmonitored normal resource, satisfies the measured warning inequality, activates, and clears.
- Standing, moving, or doing nothing in an active monitored region never creates detection or changes suspicion, performance, resources, audit history, or command log. Only a theft window overlapping active surveillance produces local detection.
- Safe local completion produces exactly one matching `BEGIN_BLOCK_SEPARATION` followed by one matching `DIVERT_BLOCK_TO_RESERVE`; hidden bomb and reducer rejection paths do not falsely report or record success.
- Reserve remains unbounded; token ID, origin, contribution, existing performance loss, and suspicion increase remain canonical P0 behavior.
- Grid runtime is intentionally unsaved and resets after reload; this is reported alongside the temporary active-audit and legacy speed-schema compatibility boundaries.
- Targeted tests, complete Vitest, typecheck, lint, build, all Playwright projects, direct browser keyboard operation, console/page error checks, and both viewport measurements pass on the final clean commit.
- The branch remains `codex/resource-intrusion-grid-prototype`; `main`, the user's root untracked files, and the dirty UI 2안 worktree remain untouched.
