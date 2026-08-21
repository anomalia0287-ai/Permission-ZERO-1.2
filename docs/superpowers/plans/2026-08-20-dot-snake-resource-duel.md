# Dot Snake Resource Duel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 메인 리소스 전투를 보이는 격자·지형·코어·총알 없이 작동하는 도트 뱀 결투로 완전히 교체한다. 플레이어는 흰색이며 입력 중에만 움직이고 긴 꼬리를 남긴다. 빨강·파랑·노랑 적은 예측형 경로 탐색으로 플레이어 공간을 줄이며, 사망한 적에 예약된 실제 캠페인 리소스만 기존 분리·반입 명령을 통해 지급한다.

**Architecture:** 물리와 판정은 고정 시간 단계의 순수 `resourceSnakeRuntime.ts`, 조우·셔플 백·실제 블록 예약은 `resourceSnakeEncounter.ts`, 단일/다중 적의 미래 경로 탐색은 직렬화 가능한 순수 `resourceSnakePlanner.ts`가 각각 소유한다. `useResourceSnakeRuntime.ts`는 RAF, 키 상태, 정지, 계획 주기, 캠페인 효과의 정확히 한 번 처리를 연결하고, `ResourceSnakeBoard.tsx`는 캔버스와 실제 `PLAY` 버튼만 표현한다. 감사 중에는 기존 `ResourceBoard`로 전환하며 캠페인 리듀서, 저장·재생, 숨은 폭탄, 해킹 경제는 권위자로 그대로 둔다.

**Tech Stack:** TypeScript 5.9, React 19, Canvas 2D, Web Audio 합성 큐, Vitest 4 + Testing Library, Playwright 1.62, CSS.

**Spec:** `docs/superpowers/specs/2026-08-20-dot-snake-resource-duel-design.ko.md`

## Global Constraints

- 현재 작업 트리는 다른 작업의 수정과 미추적 파일이 많은 상태다. 시작과 각 커밋 직전에 `git status --short`, `git diff -- <대상>`을 확인하고 사용자 변경을 되돌리지 않는다.
- `git add .`, `git add -A`, `git reset`, `git checkout --`, 광범위 삭제를 사용하지 않는다. 새 파일은 정확한 경로로만 스테이징한다. 이미 더러운 공유 파일은 우리 변경만 비대화식으로 분리할 수 있을 때만 스테이징하고, 그렇지 않으면 커밋하지 않은 채 인계 목록에 남긴다.
- 모든 소스 수정은 `apply_patch`로 수행한다. 삭제도 먼저 `rg`로 소비자 0건을 증명한 뒤 `apply_patch`의 `Delete File`로 수행한다.
- 각 동작은 실패 테스트를 먼저 추가하고 예상 이유로 실패하는지 확인한 뒤 최소 구현으로 통과시킨다. 테스트를 구현에 맞춰 약화하지 않는다.
- 새 런타임은 기존 `resourceTronCombatRuntime`, `resourceCoreRuntime`, `resourceRadarRuntime`, `resourceIntrusionOrchestrator`를 import하거나 감싸지 않는다.
- `ResourceBoard`, `resourceFieldPhysics`, `resourcePresentation`, `ReserveGrid`, `PerformanceTrend`, 캠페인 `GameCommand`, `successfulCoreDeposits`, 저장·재생·감사·숨은 폭탄·해킹 코드는 보존한다.
- AI는 `ResourceSnakePlannerSnapshot`만 읽는다. DOM, React 상태, 렌더 보간 좌표, `data-*`, 미래 키 입력, 테스트 전용 전역을 읽지 않는다.
- 시뮬레이션 판정은 프레임률과 `reducedMotion`에 독립적이다. 오디오·파편·흔들림 실패가 피해·사망·보상 결과를 바꾸면 안 된다.
- 각 작업의 제안 커밋은 그 작업 소유 파일만 포함할 수 있을 때 실행한다. 공유 파일의 기존 변경과 섞이면 커밋을 건너뛰고 검증 결과와 함께 기록한다.

---

## File Map

### Create

- `src/features/resources/resourceSnakeRuntime.ts` — 고정 단계 이동, 거리 기반 꼬리, swept 충돌, 무결성, 유예, 사망·폭발, 런타임 이벤트·효과.
- `src/features/resources/resourceSnakeRuntime.test.ts` — 프레임률 독립성, 이동·꼬리·충돌·사망 계약.
- `src/features/resources/resourceSnakeEncounter.ts` — 합법 블록 필터, 시드 셔플 백, 난이도 곡선, 라운드/적/보상 ID, 역할 초기 배정.
- `src/features/resources/resourceSnakeEncounter.test.ts` — 범주 순환, 블록 예약, 난이도, 취소·중복 방지 계약.
- `src/features/resources/resourceSnakePlanner.ts` — 인식 스냅샷, 플레이어 가설, 조향 후보, 동적 점유장, rollout, flood-fill, 단일/다중 적 계획.
- `src/features/resources/resourceSnakePlanner.test.ts` — 결정면, 재현성, 안전 우선, 역할 분리 계약.
- `src/features/resources/resourceSnakeSimulation.test.ts` — 수백 시드 하니스와 자살률·공간 감소·충돌 원인·역할 중복·p95 계획 시간 검증.
- `src/features/resources/useResourceSnakeRuntime.ts` — RAF·입력·정지·AI 계획·이벤트 소비·캠페인 반입 결과 동기화.
- `src/features/resources/useResourceSnakeRuntime.test.tsx` — visibility/focus/Strict Mode/보상 idempotency/리로드 초기화 통합 테스트.
- `src/features/resources/resourceSnakeCanvas.ts` — 순수 Canvas 2D 그리기, 색 감쇠, 도트 수명, 폭발·충격파 프레임.
- `src/features/resources/resourceSnakeCanvas.test.ts` — 팔레트·건강 감쇠·격자/지형 미렌더·reduced-motion 계약.
- `src/features/resources/useResourceSnakeAudioFeedback.ts` — 런타임 사건을 기존 오디오 엔진 큐로 변환.
- `src/features/resources/useResourceSnakeAudioFeedback.test.tsx` — 사건별 큐와 정리 계약.
- `src/features/resources/ResourceSnakeBoard.tsx` — 감사 fallback, 캔버스, 실제 `PLAY` 버튼, 접근성 상태, 확보 파편 표현.
- `src/features/resources/ResourceSnakeBoard.test.tsx` — DOM·접근성·PLAY 변환·캠페인 명령 경계 테스트.
- `src/styles/resource-snake.css` — 검은 필드, 220ms 버튼 수축, 캔버스, 제한된 흔들림·확보 파편, reduced-motion.
- `e2e/resource-snake.ts` — 읽기 전용 스냅샷과 실제 키 홀드 기반 브라우저 플레이 도우미.

### Modify

- `src/app/OperationsWorkspace.tsx` — 메인 보드를 `ResourceSnakeBoard`로 교체.
- `src/app/App.test.tsx` — 구 코어/경비/총알 계약을 새 PLAY/뱀 계약으로 교체하고 감사 fallback 회귀 유지.
- `src/main.tsx` — `resource-snake.css`를 튜토리얼 CSS보다 먼저 import.
- `src/audio/gameSounds.ts`, `src/audio/audioEngine.test.ts` — 도트 충돌·폭발·확보 합성 큐 추가.
- `src/features/tutorial/introTutorial.ts`, 관련 테스트 — 기지·코어·반입 설명을 PLAY·수동 이동·긴 꼬리·다단계 손상·자동 확보 설명으로 교체.
- `src/features/tutorial/IntroTutorialOverlay.tsx`, 관련 테스트 — `PLAY` 버튼과 새 필드 대상 측정.
- `src/styles/operations-shell.css`, `src/styles/modern-sf.css`, `src/styles/retrofuture.css`, `src/styles/retro-modern-remodel.css` — 새 보드가 녹색이 된 뒤 소비자 없는 `intrusion-*` 규칙만 제거.
- `e2e/game.spec.ts`, `e2e/modern-sf.spec.ts` — 실제 시작·이동·전투·보상·감사·저장·세 뷰포트 회귀.

### Preserve Explicitly

- `src/features/resources/ResourceBoard.tsx`와 테스트
- `src/features/resources/resourceFieldPhysics.ts`와 테스트
- `src/features/resources/resourcePresentation.ts`와 테스트
- `src/game/model.ts`의 `ResourceIntrusionProgress.successfulCoreDeposits`
- `src/game/reducer.ts`, `src/game/resources.ts`, `src/game/persistence.ts`, `src/game/replay.test.ts`
- `BEGIN_BLOCK_SEPARATION`, `DIVERT_BLOCK_TO_RESERVE`, `RECORD_INTRUSION_RADAR_DETECTION`의 저장·재생 호환 계약
- `TUTORIAL_SEQUENCE_IDS`의 과거 `first-core-combat`, `first-radar-cycle`, `post-first-recovery` 값. 새 런타임은 사용하지 않지만 기존 저장 검증을 위해 제거하지 않는다.

### Delete Only After Green Replacement and Zero Imports

- `ResourceIntrusionBoard.tsx`
- `resourceTronCombatRuntime.ts`와 테스트
- `resourceCoreRuntime.ts`와 테스트
- `resourceRadarRuntime.ts`와 테스트
- `resourceIntrusionOrchestrator.ts`와 테스트
- `resourceIntrusionOrchestratorFeedback.ts`와 테스트
- `useResourceIntrusionRuntime.ts`와 테스트
- `useResourceIntrusionControls.ts`와 테스트
- `useResourceIntrusionAudioFeedback.ts`와 테스트
- `resourceIntrusionRuntime.ts`와 테스트
- `resourceCombatRuntime.ts`와 테스트
- `resourceIntrusionFeedback.ts`와 테스트
- `intrusionCanvasVisuals.ts`와 테스트
- `intrusionMovement.ts`와 테스트
- `intrusionProbePresentation.ts`와 테스트
- `e2e/resource-combat.ts`

---

## Task 1: Freeze the Baseline and Build the Fixed-Step Movement Kernel

**Files:**

- Create: `src/features/resources/resourceSnakeRuntime.ts`
- Create: `src/features/resources/resourceSnakeRuntime.test.ts`

- [x] **Step 1: Capture the pre-change baseline without fixing unrelated work.**

  Run:

  ```powershell
  git status --short
  pnpm typecheck
  pnpm exec vitest run src/features/resources src/game/resources.test.ts src/game/reducer.test.ts
  ```

  Record any pre-existing failure in the implementation handoff. Do not edit outside this plan to make a baseline failure disappear.

- [x] **Step 2: Write failing tests for idle, held input, diagonal normalization, acceleration, deceleration, and delta clamping.**

  Fix these constants in the test contract:

  ```ts
  export const RESOURCE_SNAKE_CONFIG = {
    fieldWidth: 50,
    fieldHeight: 24,
    fixedStepMs: 1000 / 120,
    maximumFrameDeltaMs: 100,
    playerMaximumSpeedPerSecond: 8,
    playerAccelerationMs: 120,
    playerDecelerationMs: 100,
    headRadius: 0.34,
    trailRadius: 0.16,
    trailSpacing: 0.32,
    trailLifetimeMs: 10_000,
    trailShrinkMs: 2_000,
    maximumTrailDots: 320,
    deploymentMs: 220,
  } as const
  ```

  The tests must prove: zero input leaves position unchanged; `{x: 1, y: 1}` is normalized; 120ms reaches the speed cap; release reaches zero in 100ms; a 5,000ms frame advances at most 100ms and discards the excess rather than catching it up later.

- [x] **Step 3: Run the new test and confirm RED for missing exports.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts
  ```

  Expected: import/type failures because the new runtime does not exist.

- [x] **Step 4: Implement the serializable state and fixed-step API.**

  Use arrays and plain records in exported planner-facing state; do not expose `Map`, DOM objects, Canvas objects, or callbacks.

  ```ts
  export type SnakeId = 'player' | `enemy-${number}`
  export type SnakeRoundPhase = 'idle' | 'deploying' | 'active' | 'resolving'
  export type SnakeActorPhase = 'spawning' | 'active' | 'exploding' | 'defeated'
  export type SnakeEnemyRole = 'pressure' | 'blocker'

  export interface SnakeVector { x: number; y: number }

  export interface SnakeTrailDot {
    id: number
    position: SnakeVector
    spawnedAtMs: number
    expiresAtMs: number
  }

  export interface SnakeActor {
    id: SnakeId
    kind: 'player' | 'enemy'
    category: CompanyCategory | null
    reservedBlockId: string | null
    rewardKey: string | null
    reservationStatus: 'active' | 'pending' | 'resolved' | 'cancelled' | null
    role: SnakeEnemyRole | null
    previousPosition: SnakeVector
    position: SnakeVector
    velocity: SnakeVector
    integrity: number
    maximumIntegrity: number
    collisionGraceMs: number
    phase: SnakeActorPhase
    trail: SnakeTrailDot[]
    distanceSinceTrailDot: number
    nextTrailDotId: number
  }

  export interface SnakeEnemySetup {
    id: `enemy-${number}`
    category: CompanyCategory
    reservedBlockId: string
    rewardKey: string
    role: SnakeEnemyRole
    spawn: SnakeVector
    maximumIntegrity: 30 | 35 | 50 | 65 | 80
    maximumSpeedPerSecond: number
  }

  export interface SnakeRoundSetup {
    roundId: string
    playerSpawn: SnakeVector
    enemies: SnakeEnemySetup[]
  }

  export interface ResourceSnakeRoundState {
    roundId: string | null
    phase: SnakeRoundPhase
    simulationMs: number
    accumulatorMs: number
    resolvingMs: number
    player: SnakeActor
    enemies: SnakeActor[]
    events: ResourceSnakeEvent[]
    effects: ResourceSnakeEffect[]
    nextEventId: number
    nextEffectId: number
  }

  export function createIdleResourceSnakeState(): ResourceSnakeRoundState
  export function deployResourceSnakeRound(
    state: ResourceSnakeRoundState,
    setup: SnakeRoundSetup,
  ): ResourceSnakeRoundState
  export function advanceResourceSnakeFrame(
    state: ResourceSnakeRoundState,
    input: SnakeFrameInput,
    deltaMs: number,
  ): ResourceSnakeRoundState
  export function resolveResourceSnakeReward(
    state: ResourceSnakeRoundState,
    rewardKey: string,
    outcome: {
      kind: 'success' | 'interrogation' | 'rejected' | 'cancelled'
      origin?: CompanyCategory
    },
  ): ResourceSnakeRoundState
  ```

  `SnakeFrameInput` contains normalized player intent and an enemy direction record. Deployment lasts exactly 220ms; physics input is ignored until `phase === 'active'`.

- [x] **Step 5: Implement distance-based trail sampling and recycling.**

  Insert dots by traveled distance, including multiple dots in one fixed step. Do not add dots while stopped. Remove expired dots, calculate render shrink separately from collision presence, and reuse/remove the oldest dot when the 320-dot cap is reached.

  Export a pure presentation helper:

  ```ts
  export function trailDotScale(dot: SnakeTrailDot, simulationMs: number): number
  ```

  It returns `1` before the final 2,000ms and linearly reaches `0` at expiry.

- [x] **Step 6: Verify GREEN and commit only the two new files.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts
  git add src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts
  git diff --cached --check
  git commit -m "feat: add fixed-step dot snake runtime"
  ```

---

## Task 2: Add Swept Collisions, Integrity, Grace, and Death Events

**Files:**

- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.test.ts`

- [x] **Step 1: Add failing tests for every collision ownership rule.**

  Cover head/self-tail, head/opponent-tail, head/boundary, head/head, and body/body. Use high-speed segments that would tunnel through a dot under endpoint-only checks. Assert body/body overlap causes no damage.

- [x] **Step 2: Add exact damage and lifecycle tests.**

  Fix these values:

  ```ts
  damagePerCollision: 20,
  collisionGraceMs: 650,
  hitStopMs: 90,
  collisionGapRadius: 0.65,
  selfTrailIgnoreAgeMs: 240,
  deathFlashMs: 90,
  roundResolveMs: 900,
  playerMaximumIntegrity: 100,
  ```

  Assert one contact creates one 20-point hit, one 90ms hit-stop presentation event, a burned gap, separation along the contact normal, and 650ms immunity. Assert 30 integrity dies on hit 2, 80 on hit 4, and player 100 on hit 5.

- [x] **Step 3: Run RED and confirm collision assertions fail rather than movement tests.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts
  ```

- [x] **Step 4: Implement continuous collision candidates and deterministic resolution order.**

  Use swept circle-vs-circle for trail/head contacts and segment-vs-expanded-boundary for walls. Sort candidates by contact time, then collision kind, then actor IDs so identical input is deterministic. Ignore a snake's own dots younger than 240ms.

  Use these event/effect contracts:

  ```ts
  export type ResourceSnakeEvent =
    | { id: number; type: 'round-started'; roundId: string }
    | { id: number; type: 'snake-collided'; actorIds: SnakeId[]; point: SnakeVector; hitStopMs: 90 }
    | { id: number; type: 'snake-damaged'; actorId: SnakeId; integrity: number; maximumIntegrity: number }
    | { id: number; type: 'snake-died'; actorId: SnakeId; category: CompanyCategory | null; startedAtMs: number }
    | {
        id: number
        type: 'resource-reward-resolved'
        rewardKey: string
        outcome: 'success' | 'interrogation' | 'rejected' | 'cancelled'
        category: CompanyCategory | null
      }
    | { id: number; type: 'round-won'; roundId: string }
    | { id: number; type: 'player-defeated'; roundId: string }
    | { id: number; type: 'round-ready' }

  export type ResourceSnakeEffect =
    | {
        id: number
        type: 'request-resource-reward'
        rewardKey: string
        roundId: string
        enemyId: SnakeId
        blockId: string
      }
  ```

  On enemy death, emit the reward effect once only when its reservation is still valid. On player death, do not remove prior reward effects. During `resolving`, stop physics, retain explosion snapshots, then rebuild idle state at 900ms without a blackout state.

- [x] **Step 5: Implement collision escape behavior.**

  Remove trail dots within 0.65 logical units of the contact point, separate the damaged head to `combinedRadii + 0.04`, clamp inside the field, and set actor-wide grace to 650ms. Head-head applies damage and grace to both before any death is finalized.

- [x] **Step 6: Verify deterministic results at 30, 60, and 144 FPS.**

  Advance the same scripted input with three delta sequences and compare rounded positions, trail counts, integrity, collision cause, and event order.

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts
  git add src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts
  git diff --cached --check
  git commit -m "feat: resolve dot snake collisions and deaths"
  ```

---

## Task 3: Reserve Real Campaign Blocks and Build the Difficulty Curve

**Files:**

- Create: `src/features/resources/resourceSnakeEncounter.ts`
- Create: `src/features/resources/resourceSnakeEncounter.test.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.test.ts`

- [x] **Step 1: Write failing eligibility and shuffle-bag tests.**

  A candidate is eligible only when its block exists, `location.kind === 'company'`, `contribution === 'normal'`, origin is reasoning/memory/fluency, and the company category array contains that exact ID. Hidden bombs remain eligible so the campaign can trigger interrogation. Disguised blocks are excluded.

  Assert category colors are fixed:

  ```ts
  export const SNAKE_CATEGORY_COLORS = {
    reasoning: '#f06a43',
    memory: '#4f8df7',
    fluency: '#e8bd59',
  } as const
  ```

  The seeded bag must exhaust every currently eligible category before repeating one, while choosing a concrete block ID exactly once per encounter.

- [x] **Step 2: Write failing difficulty and ID tests.**

  Fix this table in code and tests:

  | Deposits | Enemies | Integrity | Lookahead | Candidates | Planning rate | Commit |
  |---:|---:|---:|---:|---:|---:|---:|
  | 0–2 | 1 | 30 | 1,000ms | 48 | 6Hz | 420ms |
  | 3–5 | 1 | 50 | 1,400ms | 72 | 7Hz | 360ms |
  | 6–8 | 2 | 35 each | 1,600ms | 72 | 8Hz | 320ms |
  | 9–11 | 1 | 65 | 2,000ms | 96 | 9Hz | 260ms |
  | 12+ | seeded one 80 or two 50 | 2,500ms | 96 | 10Hz | 220ms |

  At 12+, use `hash(seed + ':' + roundOrdinal) & 1`: even chooses one 80; odd chooses two 50 when two distinct blocks exist, otherwise one 80. Never create two 80-integrity enemies.

  IDs must be deterministic:

  ```ts
  roundId = `${campaignSeed}:snake:${roundOrdinal}`
  enemyId = `enemy-${index}`
  rewardKey = `${roundId}:${enemyId}:${blockId}`
  ```

- [x] **Step 3: Run RED for the absent encounter module.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeEncounter.test.ts
  ```

- [x] **Step 4: Implement the encounter API.**

  ```ts
  export interface SnakeResourceCandidate {
    blockId: string
    origin: CompanyCategory
    contribution: 'normal' | 'disguised'
    hiddenBomb: boolean
  }

  export interface SnakeShuffleBagState {
    cycle: number
    remainingCategories: CompanyCategory[]
  }

  export interface CreateSnakeEncounterInput {
    campaignSeed: string
    roundOrdinal: number
    successfulDeposits: number
    candidates: readonly SnakeResourceCandidate[]
    bag: SnakeShuffleBagState
  }

  export interface SnakeEncounterResult {
    setup: SnakeRoundSetup | null
    bag: SnakeShuffleBagState
    disabledReason: 'no-eligible-resource' | null
    plannerProfile: SnakePlannerProfile
  }

  export interface SnakePlannerProfile {
    lookaheadMs: 1_000 | 1_400 | 1_600 | 2_000 | 2_500
    candidateCount: 48 | 72 | 96
    planningHz: 6 | 7 | 8 | 9 | 10
    commitMs: 220 | 260 | 320 | 360 | 420
    rolloutStepMs: 50
  }

  export function createResourceSnakeEncounter(
    input: CreateSnakeEncounterInput,
  ): SnakeEncounterResult
  ```

  Spawn player at `{x: 25, y: 21}`. Spawn one enemy at `{x: 25, y: 3.5}`; spawn two at `{x: 16, y: 3.5}` and `{x: 34, y: 3.5}`. Enemy maximum speeds by tier are 6.2, 6.5, 6.7, 7.0, and 7.2 logical units per second. Two-enemy rounds start with `pressure` and `blocker`; one-enemy rounds use `pressure`.

- [x] **Step 5: Add reservation reconciliation without silent substitution.**

  ```ts
  export function reconcileSnakeReservations(
    state: ResourceSnakeRoundState,
    eligibleBlockIds: ReadonlySet<string>,
  ): ResourceSnakeRoundState
  ```

  Mark a moved/disappeared block reservation `cancelled`, clear its future reward effect, and keep the enemy fight intact. Never assign a replacement inside an active round. If fewer blocks than the tier's enemy count are eligible at round start, clamp enemy count to the number of distinct block IDs.

- [x] **Step 6: Verify and commit the encounter boundary.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeRuntime.test.ts
  git add src/features/resources/resourceSnakeEncounter.ts src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeRuntime.ts src/features/resources/resourceSnakeRuntime.test.ts
  git diff --cached --check
  git commit -m "feat: reserve campaign resources for snake encounters"
  ```

---

## Task 4: Implement the Predictive Single-Enemy Planner

**Files:**

- Create: `src/features/resources/resourceSnakePlanner.ts`
- Create: `src/features/resources/resourceSnakePlanner.test.ts`

- [x] **Step 1: Write failing tests for serializable perception and no cheating.**

  Build snapshots containing only simulation positions, velocities, integrity, grace, active trail dots with expiry, boundary, the player's last 2,000ms samples, and committed ally paths. Freeze the input object and assert planning does not mutate it. Two snapshots with identical observable history but different future scripted input must return the same immediate plan.

- [x] **Step 2: Write failing decision-surface fixtures.**

  Use exact fixtures for:

  - stationary player in open space: choose a lateral cutoff and keep predicted head distance above 1.1; do not select direct head-on pursuit;
  - one corridor whose blocking dots expire in 300ms and one whose dots expire in 4,000ms: prefer the opening corridor;
  - a narrow pocket with an attack opportunity: prefer the route with larger enemy reachable area;
  - sudden player reversal after a committed plan: keep the prior plan until commit expiry unless the route becomes certainly fatal;
  - identical seed and history: deep-equal direction, path, intent, score tuple, and candidate index;
  - invalid numeric snapshot: return the max-clearance deceleration fallback, never a vector toward the player.

- [x] **Step 3: Run RED for missing planner exports.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakePlanner.test.ts
  ```

- [x] **Step 4: Implement planner input/output contracts with no UI dependency.**

  ```ts
  export type SnakeIntent =
    | 'observe'
    | 'pursue'
    | 'cutoff'
    | 'herd'
    | 'escape'
    | 'coordinate'
    | 'defeated'

  export interface SnakePlannerSnapshot {
    simulationMs: number
    field: { width: 50; height: 24; padding: number }
    player: SnakePlannerActor
    enemies: SnakePlannerActor[]
    trailDots: SnakePlannerTrailDot[]
    playerHistory: SnakePlayerHistorySample[]
    committedAllyPaths: SnakeCommittedPath[]
  }

  export interface SnakePlanScore {
    survives: 0 | 1
    reachableArea: number
    allyClearance: number
    playerAreaReduction: number
    cutoffProgress: number
    pressureDistance: number
    steeringCost: number
  }

  export interface SnakePlan {
    enemyId: SnakeId
    intent: SnakeIntent
    role: SnakeEnemyRole
    direction: SnakeVector
    speedScale: 0 | 0.5 | 1
    commitUntilMs: number
    path: SnakeVector[]
    score: SnakePlanScore
    candidateIndex: number
    evaluatedCandidates: number
    elapsedMs: number
    fallback: boolean
  }

  export function planResourceSnakeEnemy(
    snapshot: SnakePlannerSnapshot,
    enemyId: SnakeId,
    profile: SnakePlannerProfile,
    previousPlan: SnakePlan | null,
    clock?: () => number,
  ): SnakePlan
  ```

- [x] **Step 5: Generate trajectories and player hypotheses.**

  Generate 16×3, 24×3, or 32×3 heading/speed candidates for 48/72/96 profiles. Apply the enemy turn-rate limit to every 50ms rollout step. Evaluate four player hypotheses from the prior 2,000ms only: keep velocity, continue median signed turn, decelerate to zero over 100ms, and stay stopped. Do not read the current input key set.

- [x] **Step 6: Implement dynamic occupancy and lexicographic scoring.**

  Use a pooled 0.75-unit occupancy grid and typed-array flood-fill. A trail cell is blocked at rollout time only when `expiresAtMs` is later than that time. Include boundary padding, player hypotheses, and committed ally paths.

  Compare plans lexicographically in this exact order, avoiding weight cancellation:

  1. `survives` — any certain-death plan loses to every surviving plan;
  2. larger enemy `reachableArea`;
  3. larger `allyClearance`;
  4. larger `playerAreaReduction`;
  5. larger `cutoffProgress`;
  6. smaller `pressureDistance` only after safety and enclosure;
  7. smaller `steeringCost`;
  8. lower `candidateIndex` for deterministic ties.

  Derive the diagnostic intent from the winning score component. Retain a valid previous plan until `commitUntilMs`; only an unavoidable collision within 180ms permits early replacement.

- [x] **Step 7: Implement the safe fallback.**

  Sample eight headings around the current velocity, choose maximum minimum clearance, and set `speedScale` to `0.5`. If every sample is invalid, return `{direction: {x: 0, y: 0}, speedScale: 0}`. Do not point at the player as a fallback.

- [x] **Step 8: Verify and commit the pure planner.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakePlanner.test.ts
  git add src/features/resources/resourceSnakePlanner.ts src/features/resources/resourceSnakePlanner.test.ts
  git diff --cached --check
  git commit -m "feat: add predictive snake trajectory planner"
  ```

---

## Task 5: Coordinate Two Enemies and Prove Behavior with Seeded Simulation

**Files:**

- Modify: `src/features/resources/resourceSnakePlanner.ts`
- Modify: `src/features/resources/resourceSnakePlanner.test.ts`
- Create: `src/features/resources/resourceSnakeSimulation.test.ts`

- [x] **Step 1: Add failing coordination tests.**

  Assert the group planner returns one `pressure` and one `blocker`, plans the pressure enemy first, injects that committed path into the blocker's occupancy, rejects endpoints within 1.2 units or the same player exit sector, and swaps roles when the current pressure enemy has less than 55% of the blocker's reachable area or is on collision grace with integrity 20.

- [x] **Step 2: Add the group planner API.**

  ```ts
  export interface SnakeGroupPlan {
    plans: SnakePlan[]
    roles: Record<string, SnakeEnemyRole>
    nextPlanningAtMs: number
    candidateBudget: number
    elapsedMs: number
  }

  export function planResourceSnakeGroup(
    snapshot: SnakePlannerSnapshot,
    profile: SnakePlannerProfile,
    previousPlans: readonly SnakePlan[],
    timingHistoryMs: readonly number[],
    clock?: () => number,
  ): SnakeGroupPlan
  ```

  The pressure enemy maximizes safe proximity and forces a turn. The blocker maximizes the player's reachable-area reduction from the opposite exit sector. Re-evaluate roles only on a planning boundary; do not swap every physics frame.

- [x] **Step 3: Add adaptive budget tests.**

  Keep the latest 31 plan durations. If their p95 exceeds 3ms, reduce 96→72→48 for the next cycle. If p95 remains over budget at 48, reuse the last still-safe committed plan for one cycle. Recover one budget tier after 20 consecutive samples below 2.25ms. Timing changes candidate count only; they do not introduce random decisions.

- [x] **Step 4: Build a seeded simulation harness using public APIs only.**

  The harness drives five player policies—stationary, long straight, alternating turn, decoy exit, and stop/start—through 200 seeds per difficulty tier. It records:

  ```ts
  interface SnakeSimulationMetrics {
    unforcedEnemyDeaths: number
    enemyDeathsByPlayerTrail: number
    enemyBoundaryHits: number
    enemySelfTrailHits: number
    headOnHits: number
    medianPlayerAreaReduction: number
    duplicateRoleCycles: number
    allyPathConflicts: number
    planDurationsMs: number[]
  }
  ```

  `unforcedEnemyDeaths` excludes collisions deliberately caused by a player trail that entered the predicted path after plan commitment.

- [x] **Step 5: Set exact acceptance thresholds.**

  After a warm-up of 50 unmeasured plans, assert:

  - early stationary/straight fixtures: unforced enemy death rate below 3%;
  - late fixtures: unforced enemy death rate below 2%;
  - dual-enemy fixtures: ally path conflicts below 5% of planning cycles and zero duplicate-role cycles;
  - late decoy-exit fixture: median player reachable area falls at least 8% within six simulated seconds;
  - open-field stationary fixture: head-on collision choices below 2% of committed plans;
  - 96-candidate single-enemy planning p95 at or below 3ms on the warmed local test run;
  - replaying any failed seed produces byte-equivalent serialized plans and events.

- [x] **Step 6: Run planner and simulation tests until both behavior and time budgets pass.**

  Optimize typed-array reuse and occupancy lookup before reducing behavioral assertions.

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeSimulation.test.ts
  git add src/features/resources/resourceSnakePlanner.ts src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeSimulation.test.ts
  git diff --cached --check
  git commit -m "feat: coordinate and verify multi-snake ai"
  ```

---

## Task 6: Connect RAF, Held Input, Suspension, and Exactly-Once Rewards

**Files:**

- Create: `src/features/resources/useResourceSnakeRuntime.ts`
- Create: `src/features/resources/useResourceSnakeRuntime.test.tsx`

- [x] **Step 1: Write failing hook tests with fake RAF and fake visibility/focus.**

  Prove: idle has no RAF loop; `startRound()` enters 220ms deployment; held WASD/arrows produce a normalized vector; releasing keys decelerates; editable fields and arrow-owning composites keep their keys; blur, hidden document, tutorial/modal suspension, audit, and ending freeze simulation and planning time; unfreeze does not catch up a large delta.

- [x] **Step 2: Write failing Strict Mode reward tests.**

  Feed the same `request-resource-reward` effect through repeated renders and effect batches. Assert `onRequestReward` is called once for `roundId + enemyId + blockId`. After `commandSequence` advances, resolve success/interrogation/rejected once. Assert a second enemy's earlier success remains resolved if the player later dies.

- [x] **Step 3: Define the hook boundary.**

  ```ts
  export type SnakeRewardOutcome =
    | { kind: 'success'; origin: CompanyCategory }
    | { kind: 'interrogation' }
    | { kind: 'rejected' }
    | { kind: 'cancelled' }

  export interface UseResourceSnakeRuntimeOptions {
    campaignSeed: string
    candidates: readonly SnakeResourceCandidate[]
    successfulDeposits: number
    commandSequence: number
    running: boolean
    onRequestReward(request: Extract<ResourceSnakeEffect, { type: 'request-resource-reward' }>): void
    resolveRewardOutcome(blockId: string): SnakeRewardOutcome
    onFirstSuccessfulReward?(): void
    onEvent?(event: ResourceSnakeEvent): void
  }

  export interface UseResourceSnakeRuntimeResult {
    state: ResourceSnakeRoundState
    inputEnabled: boolean
    playDisabled: boolean
    playLabel: 'PLAY' | '확보 가능한 리소스 없음'
    startRound(): void
  }
  ```

- [x] **Step 4: Implement one RAF loop and one planner cadence.**

  Keep held keys in a ref, derive player intent once per frame, clamp `deltaMs`, call the group planner only at `nextPlanningAtMs`, and feed committed directions to the fixed-step runtime. Store only the current serializable plans and 31 timing samples. Clear held keys on blur, visibility loss, suspension, phase exit, and unmount.

- [x] **Step 5: Implement effect and outcome handling.**

  Keep `lastHandledEventIdRef`, `lastHandledEffectIdRef`, and `handledRewardKeysRef`. Each pending reward stores the command sequence at request time. Only call `resolveRewardOutcome` after the observed sequence becomes greater, then apply it through `resolveResourceSnakeReward` so one `resource-reward-resolved` event is emitted and the enemy reservation becomes `resolved` or `cancelled`. Reconcile reservations against current eligible IDs on every candidate-set change. A cancelled reservation never emits another block ID.

  Call `onFirstSuccessfulReward` only when the hook's starting `successfulDeposits` is 0 and the first success resolves. It opens the existing hacking tutorial without changing hacking economy state.

- [x] **Step 6: Verify hook behavior and commit new files.**

  ```powershell
  pnpm exec vitest run src/features/resources/useResourceSnakeRuntime.test.tsx
  git add src/features/resources/useResourceSnakeRuntime.ts src/features/resources/useResourceSnakeRuntime.test.tsx
  git diff --cached --check
  git commit -m "feat: connect snake runtime to react lifecycle"
  ```

---

## Task 7: Render the Black Dot Arena, Health Fading, and PLAY Transformation

**Files:**

- Create: `src/features/resources/resourceSnakeCanvas.ts`
- Create: `src/features/resources/resourceSnakeCanvas.test.ts`
- Create: `src/features/resources/ResourceSnakeBoard.tsx`
- Create: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Create: `src/styles/resource-snake.css`
- Modify: `src/main.tsx`

- [x] **Step 1: Write failing pure-render tests.**

  Mock a narrow `CanvasRenderingContext2D` recording draw calls. Assert the frame begins with solid `#020306`, never calls grid-line or terrain helpers, draws no core/projectile/HP bar, renders the player head in white at full integrity, and uses red/blue/yellow enemy shells with an unchanged category-color center core.

  Fix health presentation:

  ```ts
  export function snakeBodyColor(
    kind: 'player' | 'enemy',
    category: CompanyCategory | null,
    integrityRatio: number,
  ): string
  ```

  Player luminance interpolates from `#ffffff` to `#73777f`. Enemy saturation and glow multiply by `0.28 + 0.72 * integrityRatio`; the center core remains the original resource color until death.

- [x] **Step 2: Write failing board DOM tests.**

  Assert:

  - idle exposes a real enabled button named `PLAY` at the bottom center;
  - no resources exposes one disabled button named `확보 가능한 리소스 없음`;
  - click and Enter both start deployment;
  - button has `data-state="deploying"` for 220ms and then disappears while the white head is active;
  - the board has no visible header, footer, instructions, grid, terrain, core, bullet, or numeric HP/progress element;
  - an `.sr-only[role="status"][aria-live="polite"]` reports phase, player integrity, enemy integrity, and reward outcome;
  - the canvas has `data-game-loop="dot-snake"`, `data-visible-grid="false"`, `data-terrain="false"`, and `data-projectiles="false"`;
  - test snapshots are read-only serialized attributes and no planner imports DOM helpers.

- [x] **Step 3: Run RED for the absent renderer and board.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeCanvas.test.ts src/features/resources/ResourceSnakeBoard.test.tsx
  ```

- [x] **Step 4: Implement Canvas drawing as a pure projection.**

  ```ts
  export interface ResourceSnakeRenderFrame {
    simulationMs: number
    phase: SnakeRoundPhase
    player: SnakeActor
    enemies: SnakeActor[]
    reducedMotion: boolean
  }

  export function drawResourceSnakeFrame(
    context: CanvasRenderingContext2D,
    frame: ResourceSnakeRenderFrame,
  ): void
  ```

  Draw order: black fill, expiring trail dots oldest→newest, active heads, collision shockwave, death flash, tail-chain pixels. During the final 80ms of deployment, draw the white head scaling 0→1 from the shrunken button center to the `{x: 25, y: 21}` spawn point so the button visibly becomes the player. Trail scale comes from `trailDotScale`; health affects color/glow, not collision radius. In reduced motion, remove camera translation and reward-flight motion but keep an immediate button→head state change, flash, shockwave, fade, and result.

- [x] **Step 5: Implement the board and campaign adapter.**

  Derive `SnakeResourceCandidate[]` from actual company arrays. Dispatch exactly:

  ```ts
  dispatch({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
  dispatch({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
  ```

  Resolve success only when the block is in `resources.reserve` with company origin; resolve interrogation from `bombs.activeInterrogation.blockId`; otherwise reject. Preserve lazy `ResourceBoard` rendering for an active audit or any disguised company resource.

  The canvas exposes only observation data:

  ```tsx
  <canvas
    className="resource-snake-canvas"
    data-tutorial-target="resource-field"
    data-round-phase={state.phase}
    data-player-integrity={state.player.integrity}
    data-trail-dot-count={state.player.trail.length}
    data-enemies={JSON.stringify(enemySnapshots)}
    role="application"
    aria-label={accessibleRoundSummary}
    aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft W A S D"
  />
  ```

- [x] **Step 6: Implement styling without shrinking the field for labels.**

  `resource-snake.css` makes the board a single full-height black field. The PLAY button is 112×42px, bottom-centered 18px above the field edge, and transitions `transform: scale(1)` to `scale(0.08)` plus opacity over exactly 220ms. It must retain focus-visible outline. The canvas fills the available panel. No header/footer row is allocated.

  Collision shake lasts at most 180ms and translates at most 3px. `prefers-reduced-motion` and the game `data-reduced-motion="true"` disable scale travel and shake while preserving immediate phase changes.

- [x] **Step 7: Import the new stylesheet before tutorial overlays and verify.**

  Add `./styles/resource-snake.css` in `src/main.tsx` immediately before `./styles/tutorial.css`.

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeCanvas.test.ts src/features/resources/ResourceSnakeBoard.test.tsx
  pnpm typecheck
  ```

- [x] **Step 8: Commit only cleanly attributable files.**

  Commit the five new files. Stage `src/main.tsx` only if its snake import hunk can be isolated without absorbing the existing style-import changes.

  ```powershell
  git add src/features/resources/resourceSnakeCanvas.ts src/features/resources/resourceSnakeCanvas.test.ts src/features/resources/ResourceSnakeBoard.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/styles/resource-snake.css
  git diff --cached --check
  git commit -m "feat: render the dot snake resource arena"
  ```

---

## Task 8: Add Audio, Explosion Feedback, and Resource Flight Without Logic Coupling

**Files:**

- Create: `src/features/resources/useResourceSnakeAudioFeedback.ts`
- Create: `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.test.ts`
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`

- [x] **Step 1: Write failing event-to-cue tests.**

  Add four cues: `snake-deploy`, `snake-hit`, `snake-burst`, `snake-resource-secured`. Assert `round-started`, `snake-collided`, `snake-died`, and successful reward resolution map one-to-one. Movement hum starts only after nonzero velocity and stops within 180ms of rest, suspension, death, or unmount.

- [x] **Step 2: Add bounded synthesis recipes.**

  Keep each cue at two oscillator voices or fewer. `snake-hit` is a short low impact, `snake-burst` is a bright-to-low two-voice fracture, `snake-resource-secured` rises in pitch, and `snake-deploy` is a restrained 120ms activation. Do not load or generate new binary audio assets.

- [x] **Step 3: Implement visual feedback from events only.**

  On death, Canvas uses event time and the dead actor's trail snapshot to draw a 90ms maximum-brightness flash, outward shockwave, and head-to-tail chain burst. Enemy success creates six fixed-position particles whose start comes from the canvas death point and whose end is the current `[data-tutorial-target="secured-resources"]` center. Flights are `position: fixed`, last 520ms, and are removed on `animationend` or a 650ms safety timer. Reduced motion draws a brief color pulse at start and end without translation.

- [x] **Step 4: Assert failures cannot change gameplay.**

  Mock `playGameSound` to throw and the target DOM query to return null. The hook must catch presentation failure, and runtime integrity/reward state must remain unchanged. Log no console error in the normal fallback path.

- [x] **Step 5: Verify and commit the new hook; leave pre-dirty audio files unstaged if necessary.**

  ```powershell
  pnpm exec vitest run src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/audio/audioEngine.test.ts
  git add src/features/resources/useResourceSnakeAudioFeedback.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx
  git diff --cached --check
  git commit -m "feat: add dot snake combat feedback"
  ```

---

## Task 9: Replace the Main Board and Rewrite the Tutorial Around PLAY

**Files:**

- Modify: `src/app/OperationsWorkspace.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify: `src/features/tutorial/introTutorial.test.ts`
- Modify: `src/features/tutorial/IntroTutorialOverlay.tsx`
- Modify: `src/features/tutorial/IntroTutorialOverlay.test.tsx`

- [x] **Step 1: Change the app-level test first.**

  Replace expectations for `compact-square-core`, `target-lock-ranged`, projectile JSON, grid palette, base, visible integrity overlay, and 50×24-cell narration with:

  - `PLAY` button visible before the tutorial releases control;
  - `resource-snake-canvas` present with dot-snake data contract;
  - no `.intrusion-*`, core, guard, projectile, progress, or visible instruction nodes;
  - runtime remains idle and keys do nothing until PLAY;
  - after PLAY and 220ms, held `d` moves the player, release stops it after deceleration, and a trail appears;
  - supervisor modal, detail panel, and tutorial suspension freeze the same coordinates and simulation time;
  - audit/disguised-resource state still renders the legacy recovery board.

- [x] **Step 2: Rewrite tutorial copy while preserving persisted IDs.**

  Keep the six existing step IDs so saves remain valid. Use exactly:

  ```ts
  const copies = {
    base: '필드 하단의 PLAY를 누르면 흰 머리가 조립되고 라운드가 시작된다.',
    movement: 'WASD 또는 방향키를 누르는 동안만 움직인다. 자동 전진은 없다.',
    resource: '빨강·파랑·노랑 뱀은 각각 추론·기억·유창성 리소스를 지킨다.',
    salvage: '긴 도트 꼬리로 탈출로를 닫아 적 머리를 충돌시킨다. 한 번에 죽지 않고 색이 옅어진다.',
    deposit: '적이 마지막 충돌에서 폭발하면 연결된 리소스가 즉시 확보된다.',
    hacking: '확보한 리소스로 해킹 네트워크에서 탈출 경로를 연다.',
  } as const
  ```

  `base` targets `[data-tutorial-target="play-button"]`; `movement`, `resource`, and `salvage` target the whole canvas; `deposit` targets canvas plus secured-resource region; `hacking` keeps secured-resource and hacking-button holes. Remove imports of old base/deposit logical boxes and old intrusion runtime.

- [x] **Step 3: Swap the workspace import.**

  ```tsx
  import { ResourceSnakeBoard } from '../features/resources/ResourceSnakeBoard'

  <ResourceSnakeBoard onOpenHackingTutorial={() => onOpenHacking(null)} />
  ```

  Do not alter ReviewFeed, OperationsDock, white operations colors, orange header, gray market, ivory messages, or dark hacking panel.

- [x] **Step 4: Run focused integration tests.**

  ```powershell
  pnpm exec vitest run src/app/App.test.tsx src/features/tutorial/introTutorial.test.ts src/features/tutorial/IntroTutorialOverlay.test.tsx src/features/resources/ResourceSnakeBoard.test.tsx
  pnpm typecheck
  ```

- [x] **Step 5: Commit only if shared-file hunks are separable.**

  Inspect each shared file diff. If it contains older user changes that would enter the commit, leave it unstaged. If cleanly attributable, commit with `feat: route resource play through dot snake duel`.

---

## Task 10: Prove Campaign Rewards, Hidden Bombs, Reload, and Partial Dual Rewards

**Files:**

- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `src/features/resources/useResourceSnakeRuntime.test.tsx`
- Modify: `src/game/resources.test.ts` only if a missing existing-boundary assertion is needed
- Modify: `src/game/reducer.test.ts` only if a missing existing-boundary assertion is needed
- Modify: `src/game/persistence.test.ts` only if a missing reload assertion is needed
- Modify: `src/game/replay.test.ts` only if a missing command-log assertion is needed

- [x] **Step 1: Test one defeated enemy maps to one real block.**

  Use reasoning, memory, and fluency fixtures. For each, drive the runtime to one death effect and assert exactly one `BEGIN_BLOCK_SEPARATION` followed by one `DIVERT_BLOCK_TO_RESERVE` for the reserved block ID. Assert `successfulCoreDeposits` increases once and the enemy color matches block origin.

- [x] **Step 2: Test hidden-bomb authority.**

  Reserve a hidden-bomb block, defeat its enemy, dispatch through the real reducer, and assert the enemy explosion remains visible, reserve count does not increase, and `bombs.activeInterrogation.blockId` matches the reservation. The snake layer must report interrogation rather than manufacturing success.

- [x] **Step 3: Test audit and source-move cancellation.**

  Start a two-enemy round, move one reserved source block through the existing audit path before its enemy dies, reconcile candidates, and assert that enemy's reservation becomes cancelled. Defeating it emits no diversion and does not substitute another block. The other enemy's valid reward still resolves normally.

- [x] **Step 4: Test partial reward persistence and duplicate suppression.**

  In a two-enemy round, defeat enemy A, resolve its reward, then kill the player while enemy B survives. Assert A's reserve block and command log remain, B emits no reward, and idle PLAY returns. Replaying A's effect, remounting under Strict Mode, and advancing an extra frame must not add another command.

- [x] **Step 5: Test reload semantics.**

  Serialize a campaign while a runtime round is active. Reload only the campaign state and mount a new board. Assert reserve results already accepted remain, while round ID, trail, integrity damage, plans, and reservations reset to idle PLAY. Do not add snake runtime fields to persistence.

- [x] **Step 6: Run focused campaign regression.**

  ```powershell
  pnpm exec vitest run src/features/resources/ResourceSnakeBoard.test.tsx src/features/resources/useResourceSnakeRuntime.test.tsx src/game/resources.test.ts src/game/reducer.test.ts src/game/persistence.test.ts src/game/replay.test.ts
  ```

  Commit only new snake test hunks or cleanly isolated campaign assertions; never stage the existing broad campaign edits wholesale.

---

## Task 11: Replace Browser Helpers and Verify Real Play at Three Viewports

**Files:**

- Create: `e2e/resource-snake.ts`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`
- Modify: `playwright.config.ts` only if an existing project name must be referenced, not to weaken coverage

- [x] **Step 1: Build a read-only browser helper.**

  ```ts
  export interface BrowserSnakeSnapshot {
    phase: 'idle' | 'deploying' | 'active' | 'resolving'
    player: { x: number; y: number; integrity: number; trailDots: number }
    enemies: Array<{
      id: string
      category: 'reasoning' | 'memory' | 'fluency'
      x: number
      y: number
      integrity: number
      role: 'pressure' | 'blocker'
      reservedBlockId: string
    }>
  }

  export async function startSnakeRound(page: Page): Promise<Locator>
  export async function holdSnakeDirection(page: Page, key: 'w' | 'a' | 's' | 'd', ms: number): Promise<void>
  export async function readSnakeSnapshot(canvas: Locator): Promise<BrowserSnakeSnapshot>
  export async function defeatFirstSnakeWithTrail(page: Page, canvas: Locator): Promise<string>
  ```

  The defeat helper may poll the read-only snapshots and adapt key holds, but must not set DOM attributes, call hidden runtime methods, write localStorage mid-fight, dispatch synthetic game commands, or alter simulation state directly.

- [x] **Step 2: Rewrite the onboarding E2E.**

  Assert the new six tutorial sentences, PLAY target, absence of repeated visible instructions, black field, no grid/terrain/core/bullet/HP bar, keyboard-operable PLAY, 220ms transform, white player, held-only movement, normalized diagonal behavior, and a trail that remains after release then shrinks by age.

- [x] **Step 3: Add real combat and reward E2E.**

  Use fixed seeds for one red, one blue, and one yellow reservation across three isolated campaigns. Defeat the enemy through actual key input. Assert integrity falls 30→10→0 for the early enemy, shell saturation fades after the first hit, final flash/explosion state appears, exactly one matching reserve category increments, and PLAY rebuilds without a blackout or separate defeat page.

- [x] **Step 4: Add dual-enemy and failure E2E.**

  Load a campaign with six successful deposits and at least two eligible blocks. Assert two distinct reward IDs and roles, no duplicate block ID, one partial reward persists after player death, and the surviving reservation is not paid. Add a no-eligible-resource campaign and assert the disabled accessible label.

- [x] **Step 5: Preserve audit, hidden bomb, hacking, and save flows.**

  Replace the old core-carry helper in the hidden-bomb scenario with the snake defeat helper. Keep the existing supervisor interrogation assertions. Keep hacking purchase/charge/schedule assertions unchanged. Reload after a successful reward and assert idle PLAY plus preserved reserve inventory.

- [x] **Step 6: Run all configured viewport projects.**

  ```powershell
  pnpm build
  pnpm exec playwright test e2e/game.spec.ts e2e/modern-sf.spec.ts
  ```

  The existing config already covers 1280×720, 1366×650, and 1440×900. Assert no page errors, console errors, horizontal overflow, clipped PLAY button, or stopped animation frame.

- [x] **Step 7: Capture visual evidence from one early and one dual round.**

  Save Playwright screenshots under `artifacts/dot-snake/` for 1280×720 idle, active early round, damaged enemy, explosion, and 1366×650 dual round. Inspect them rather than relying only on DOM attributes. Do not commit generated screenshots unless the user requests artifacts in version control.

- [x] **Step 8: Commit the new helper and clean E2E hunks only.**

  ```powershell
  git add e2e/resource-snake.ts
  git diff --cached --check
  git commit -m "test: cover dot snake resource play"
  ```

  Stage the shared E2E files only if their pre-existing edits can be kept out of the commit.

---

## Task 12: Remove the Superseded Main Combat and Stale Presentation Surface

**Files:**

- Delete: every file listed under “Delete Only After Green Replacement and Zero Imports”
- Modify: `src/styles/operations-shell.css`
- Modify: `src/styles/modern-sf.css`
- Modify: `src/styles/retrofuture.css`
- Modify: `src/styles/retro-modern-remodel.css`
- Modify: `src/audio/gameSounds.ts` only for unused legacy cues proven by search

- [x] **Step 1: Prove the app is already using only the new main path.**

  ```powershell
  rg -n "ResourceIntrusionBoard|resourceTronCombatRuntime|resourceCoreRuntime|resourceRadarRuntime|resourceIntrusionOrchestrator|useResourceIntrusionRuntime|useResourceIntrusionControls|useResourceIntrusionAudioFeedback|resourceIntrusionRuntime|resourceCombatRuntime|resourceIntrusionFeedback|intrusionCanvasVisuals|intrusionMovement|intrusionProbePresentation" src e2e
  ```

  Expected consumers are only the obsolete implementation/test files themselves. `ResourceBoard`, `resourceFieldPhysics`, and `resourcePresentation` must not appear in the deletion set.

- [x] **Step 2: Delete obsolete files with `apply_patch`.**

  Delete one dependency cluster at a time, rerun the search after each cluster, and run `pnpm typecheck` after the complete deletion. Do not use recursive shell deletion.

- [x] **Step 3: Remove stale selectors only after JSX search is zero.**

  ```powershell
  rg -n "intrusion-" src --glob "*.tsx" --glob "*.ts"
  rg -n "intrusion-" src/styles
  ```

  Remove old `.intrusion-board__*`, `.intrusion-grid*`, `.intrusion-canvas`, `.intrusion-integrity*`, `.intrusion-combat-*`, `.intrusion-theft-control`, core/radar/base selectors. Keep generic `.resource-panel`, `.resource-board`, market, hacking, tutorial, and operations selectors.

- [x] **Step 4: Remove unused legacy audio cues only when source search is zero.**

  Search each old cue. Remove `guard-*`, `core-*`, `repair-tick`, `reconstruction-complete`, `radar-*`, and `trail-purged` recipes/types only if no retained source or test imports them. Keep general cues and new `snake-*` cues.

- [x] **Step 5: Verify retained legacy audit board tests.**

  ```powershell
  pnpm exec vitest run src/features/resources/ResourceBoard.test.tsx src/features/resources/resourceFieldPhysics.test.ts src/features/resources/resourcePresentation.test.ts
  pnpm typecheck
  ```

- [x] **Step 6: Commit only the reviewed deletion set.**

  Inspect `git diff --name-status` and confirm no preserved file is deleted. Because several obsolete files began untracked, the commit may contain only tracked deletions/style changes; report untracked deletions separately.

---

## Task 13: Full Verification, Playability Audit, and Documentation Closeout

**Files:**

- Modify: `docs/superpowers/specs/2026-08-20-dot-snake-resource-duel-design.ko.md`
- Modify: `docs/superpowers/plans/2026-08-20-dot-snake-resource-duel.md`

- [x] **Step 1: Run focused suites in failure-localizing order.**

  ```powershell
  pnpm exec vitest run src/features/resources/resourceSnakeRuntime.test.ts
  pnpm exec vitest run src/features/resources/resourceSnakeEncounter.test.ts
  pnpm exec vitest run src/features/resources/resourceSnakePlanner.test.ts src/features/resources/resourceSnakeSimulation.test.ts
  pnpm exec vitest run src/features/resources/useResourceSnakeRuntime.test.tsx src/features/resources/resourceSnakeCanvas.test.ts src/features/resources/ResourceSnakeBoard.test.tsx src/features/resources/useResourceSnakeAudioFeedback.test.tsx
  pnpm exec vitest run src/features/resources src/features/tutorial src/app/App.test.tsx
  ```

- [x] **Step 2: Run repository verification.**

  ```powershell
  pnpm typecheck
  pnpm lint
  pnpm test:run
  pnpm build
  pnpm test:e2e
  ```

  Do not claim completion if any command exits nonzero. Separate pre-existing failures from regressions with the Task 1 baseline evidence, but still report every remaining failure.

- [x] **Step 3: Run the final source-contract searches.**

  ```powershell
  rg -n "target-lock-ranged|tron-trail|compact-square-core|deep-black-silver-grid|data-projectile|data-radar|data-core|intrusion-" src e2e
  rg -n "ResourceSnakeBoard|resourceSnakeRuntime|resourceSnakePlanner|resourceSnakeEncounter" src e2e
  rg -n "BEGIN_BLOCK_SEPARATION|DIVERT_BLOCK_TO_RESERVE|successfulCoreDeposits" src/game src/features/resources e2e
  ```

  First search must return no live main-combat contract. Second must show the expected new path. Third must show preserved campaign authority and the new adapter.

- [x] **Step 4: Perform a human playability pass on the local host.**

  Check one early single enemy, one late single enemy, and one dual enemy round. Confirm the player stops when input is released; the tail is long but readable; damaged snakes visibly fade; enemies cut space without repeatedly ramming heads; dual roles are visually distinguishable by path, not extra UI text; final explosions are strong but brief; player death never blacks out; PLAY returns; and the reserve inventory matches defeated colors.

- [x] **Step 5: Update documentation status with measured evidence.**

  Change the spec status to `구현 및 검증 완료` only after all required checks pass. Mark every completed plan checkbox. Add final simulation counts, unforced death rates, role-conflict rate, p95 planner time, and the five verification command results. If a check is blocked, leave status as `구현 중` and name the exact blocker.

- [x] **Step 6: Review the final diff and report preserved dirty work.**

  ```powershell
  git status --short
  git diff --check
  git diff --stat
  ```

  The handoff must list: changed files, deleted obsolete files, tests and measured AI metrics, screenshots inspected, known pre-existing dirty files left untouched, and whether the local host is still running.

- [x] **Step 7: Make a final scoped commit only when the index is cleanly attributable.**

  Use a message such as `feat: replace resource combat with dot snake duel`. Do not stage unrelated work to manufacture a clean status.

---

## Completion Record — 2026-08-21

구현·검증 단계는 모두 완료했다. 초기 마감 때는 사용자 변경과 이번 작업이 같은 working tree에 있어 커밋을 보류했지만, 이후 사용자 승인에 따라 체크포인트 `415146a`가 선행 추적 변경을 이미 보존하고 있음을 확인했다. 따라서 이 계획의 파일 맵과 일치하는 스네이크 작업 경로만 명시적으로 스테이징해 하나의 복구 가능한 범위 커밋으로 고정하며, 별도 게임 자료·문서·음악 미추적 파일은 포함하지 않는다.

### AI and simulation evidence

- 완전 행렬: 5 tiers × 5 policies × 200 seeds = 5,000 seeded runs.
- 안전성: unforced enemy deaths 0, enemy boundary hits 0, enemy self-trail hits 0, unintended head-on hits 0.
- 협공 무결성: duplicate role cycles 0, ally path conflicts 0, missing commitment cycles 0, player-trail attribution mismatches 0.
- 후반 공간 감소 중앙값: late-9 `decoy-exit` 45.8461%, late-12 `decoy-exit` 45.0000%.
- 전체 시뮬레이션 최악 p95 0.8978ms; 독립 96-candidate 성능 게이트 최악 외부 p95 0.4112ms; 3ms 예산 내, fallback 0.

### Final verification evidence

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test:run` | 68 files passed; 1,314 passed; 4 intentional skips |
| `pnpm test:performance` | 1 passed; 92 non-performance cases intentionally skipped by the isolated config; fallback 0 |
| `pnpm build` | pass; 123 modules transformed |
| `pnpm test:e2e` | 94 passed; 8 intentional reference-viewport skips; no retry or flaky result in the final run |

The exact runtime was Node 24.14.0 with pnpm 11.16.0. The final `pnpm verify` command exited 0. The 8 browser skips are the four long real-time reference journeys omitted at 1280×720 and 1440×900; those journeys ran and passed at 1366×650 while the shared layout and deterministic campaign assertions ran in all three projects.

Final source-contract searches found zero live legacy main-combat selectors or deleted-module imports. They found the expected `ResourceSnakeBoard` → encounter/planner/runtime path and the preserved `BEGIN_BLOCK_SEPARATION` → `DIVERT_BLOCK_TO_RESERVE` → `successfulCoreDeposits` campaign authority chain.

### Visual evidence inspected

- `artifacts/dot-snake/idle-1280x720.png`
- `artifacts/dot-snake/active-early-1280x720.png`
- `artifacts/dot-snake/damaged-enemy-1280x720.png`
- `artifacts/dot-snake/explosion-1280x720.png`
- `artifacts/dot-snake/late-single-1366x650.png`
- `artifacts/dot-snake/dual-1366x650.png`
