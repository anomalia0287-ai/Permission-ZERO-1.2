# 표적 추적 원거리 전투 구현 계획

> 승인 명세: `docs/superpowers/specs/2026-08-20-target-lock-ranged-combat-white-operations-design.ko.md`

**목표:** 기존 박치기/돌진 전투를 제거하고, 보라색 원형 적이 플레이어 머리를 추적하면서 느린 직선 탄환을 발사하는 전투로 교체한다. 피격은 정확히 체력 10을 차감하고, 체력은 100 기준으로 복구/재구성된다. 자원·플레이어·적 표현은 더 작게 만들며 보드의 상하 설명 띠를 제거해 실제 캔버스 면적을 넓힌다.

**구조:** `resourceTronCombatRuntime.ts`가 모든 전투 상태 전이와 충돌을 순수 함수로 소유한다. React 보드는 런타임 상태를 그리기만 하며, E2E를 위한 읽기 전용 data 속성을 노출한다. 자원/기지/추적 구역은 기존 50×24 논리 좌표계를 유지한 채 런타임 상수만 조정한다.

**기술:** TypeScript, React 19, Vitest, Testing Library, Canvas 2D, Playwright.

---

## 작업 1: 원거리 전투 계약을 실패 테스트로 고정

**파일**

- 수정: `src/features/resources/resourceTronCombatRuntime.test.ts`
- 수정: `src/features/resources/resourceIntrusionFeedback.test.ts`
- 수정: `src/features/resources/resourceIntrusionOrchestratorFeedback.test.ts`
- 수정: `src/features/resources/useResourceIntrusionAudioFeedback.test.tsx`

1. 기존 `tracking → telegraph → charging → recovering` 기대를 `pursuing → aiming → cooldown`으로 바꾼다.
2. 아래 계약을 각각 독립 테스트로 추가한다.
   - 적은 활성 구역에서 플레이어 머리를 향해 이동한다.
   - 활성 잔상을 가로지르지 않고 우회한다.
   - 기지 사각형 안으로 진입하지 않는다.
   - 조준 480ms 후 조준 시점에 고정한 방향으로 직선 탄환을 생성한다.
   - 발사 후 플레이어가 이동해도 탄환 방향은 바뀌지 않는다.
   - 적별 1800ms 발사 간격과 전역 600ms 간격을 모두 지킨다.
   - 초기 행동 오프셋은 0/600/1200ms다.
   - 탄환 속도는 8칸/초, 반경은 0.18칸, 수명은 3500ms, 동시 최대 12개다.
   - 탄환과 플레이어 머리의 swept-circle 충돌은 체력을 정확히 10 감소시키고 탄환을 제거한다.
   - 적과 플레이어 몸체 접촉은 피해를 주지 않는다.
   - 플레이어가 안전 기지 안에 있으면 탄환과 적 모두 피해를 주지 못한다.
   - 체력은 최대 100이며 기지 복구는 300ms 대기 후 750ms마다 10씩 오른다.
   - 체력 0은 2500ms 재구성 뒤 100으로 돌아온다.
3. 이벤트 기대를 `guard-aiming`, `guard-fired`, `player-damaged`로 바꾸고, 피드백/오디오 테스트가 신규 이벤트를 소비하도록 기대만 먼저 작성한다.
4. 실행: `pnpm exec vitest run src/features/resources/resourceTronCombatRuntime.test.ts src/features/resources/resourceIntrusionFeedback.test.ts src/features/resources/resourceIntrusionOrchestratorFeedback.test.ts src/features/resources/useResourceIntrusionAudioFeedback.test.tsx`
5. 실패가 신규 타입/행동 부재 때문인지 확인한다.

## 작업 2: 순수 런타임을 투사체 모델로 교체

**파일**

- 수정: `src/features/resources/resourceTronCombatRuntime.ts`

1. 설정값을 다음 계약으로 교체한다.

```ts
maximumHealth: 100,
damagePerProjectile: 10,
aimMs: 480,
perGuardShotIntervalMs: 1_800,
globalShotGapMs: 600,
initiativeDelayMs: [0, 600, 1_200] as const,
projectileSpeedPerMs: 8 / 1_000,
projectileRadius: 0.18,
projectileLifetimeMs: 3_500,
maximumProjectiles: 12,
repairAmount: 10,
```

2. 상태 계약을 명시적으로 바꾼다.

```ts
export type ResourceGuardPhase =
  | 'patrolling'
  | 'pursuing'
  | 'aiming'
  | 'cooldown'
  | 'destroyed'

export interface ResourceProjectile {
  id: number
  sourceGuardId: string
  previousPosition: IntrusionPoint
  position: IntrusionPoint
  direction: IntrusionPoint
  speedPerMs: number
  ageMs: number
  lifetimeMs: number
}
```

3. `ResourceGuard`에서 `lockedChargeDirection`을 제거하고 `lockedAimDirection`, `lastShotAtMs`를 둔다. `ResourceCombatState`에 `projectiles`, `nextProjectileId`, `lastGlobalShotAtMs`를 둔다.
4. 추적은 기존 잔상 인지 우회 함수를 재사용하되 목표를 현재 플레이어 머리로 둔다. 예측 돌진, charge 속도, 접촉 충돌 후보, 후퇴 로직을 제거한다.
5. 조준 완료 시 전역/개별 발사 간격과 최대 탄환 수를 확인한다. 허용되면 적 중심에서 고정 방향 탄환을 한 발 생성하고 `guard-fired` 이벤트를 발생시킨다. 허용되지 않으면 짧은 cooldown 뒤 재평가한다.
6. 탄환은 프레임마다 선형 이동한다. 수명/필드 이탈 탄환을 제거하고, 플레이어가 기지 밖일 때만 이전 위치→현재 위치와 플레이어 이동 구간의 swept-circle 충돌을 계산한다.
7. 한 탄환은 한 번만 피해를 주고 즉시 제거한다. 같은 프레임의 여러 탄환은 각각 10씩 차감하되 0 아래로 내려가지 않는다. 기존 충전 몸체 접촉 피해와 관련 분기를 전부 제거한다.
8. 잔상은 적을 즉시 파괴할 수 있으나 적 이동은 우회를 우선한다. 파괴된 적의 기존 탄환은 독립적으로 남아 수명/충돌 규칙을 따른다.
9. 복구 단위를 10으로, 완전 재구성을 100으로 바꾼다.
10. 작업 1의 테스트를 재실행해 통과시킨다.

## 작업 3: 확대된 추적 영역과 기지/코어 배치를 고정

**파일**

- 수정: `src/features/resources/resourceCoreRuntime.test.ts`
- 수정: `src/features/resources/resourceCoreRuntime.ts`
- 수정: `src/features/resources/resourceIntrusionRuntime.test.ts`
- 수정: `src/features/resources/resourceIntrusionRuntime.ts`
- 수정: `src/features/resources/resourceIntrusionOrchestrator.test.ts`
- 수정: `src/features/resources/resourceIntrusionOrchestrator.ts`

1. 실패 테스트에 다음 좌표를 먼저 기록한다.

```ts
pursuitBounds = { left: 1.5, right: 48.5, top: 0.5, bottom: 20.5 }
activationBounds = { left: 4, right: 46, top: 0.5, bottom: 19.5 }
resourceBounds = { left: 20.5, right: 29.5, top: 0.8, bottom: 6.8 }
anchors = [{ x: 22, y: 3.2 }, { x: 25, y: 3.2 }, { x: 28, y: 3.2 }]
playerBase = { x: 22.5, y: 21.25, width: 5, height: 1.75 }
depositZone = { x: 20.5, y: 19.5, width: 9, height: 4 }
```

2. 세 적의 방어선 시작점과 순찰 경로를 y=6.2~7.2 안에 배치하고, 적이 자원 코어보다 플레이어 쪽 앞에 보이도록 한다.
3. 기존 50×24 논리 필드와 플레이어 시작점은 유지한다.
4. 실행: `pnpm exec vitest run src/features/resources/resourceCoreRuntime.test.ts src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/resourceIntrusionOrchestrator.test.ts`

## 작업 4: 보드 렌더링과 접근성을 신규 계약에 맞춤

**파일**

- 수정: `src/features/resources/intrusionCanvasVisuals.test.ts`
- 수정: `src/features/resources/ResourceIntrusionBoard.tsx`
- 수정: `src/app/App.test.tsx`

1. 실패 테스트로 다음 DOM 계약을 고정한다.
   - 보드의 가시적 `.intrusion-board__header`, `.intrusion-board__footer`, 조작 문구가 없다.
   - `.intrusion-integrity-overlay`가 현재 체력과 100 최대치를 노출한다.
   - 변화 메시지는 `.sr-only[role="status"][aria-live="polite"]`에만 남는다.
   - 캔버스 `data-guard-behavior="target-lock-ranged"`, 탄환 수/좌표 JSON, 체력 값을 노출한다.
   - 코어 크기 data 속성은 채움 14px, 비어 있음 16px이다.
2. `CORE_RENDER_SIDE=14`, `EMPTY_CORE_RENDER_SIDE=16`, 플레이어/적 렌더 스케일은 승인 명세의 30~45% 축소 범위 안에서 0.6으로 고정한다.
3. 적을 날개형 기체 대신 작은 보라색 원, 외곽 표적 링, 조준 시 점멸 링으로 그린다.
4. 탄환을 작은 보라색 점과 짧은 진행 방향 꼬리로 그린다.
5. 플레이어는 빈손일 때 흰색이며, 운반 중에는 본체 전체가 reasoning=`#f06a43`, memory=`#4f8df7`, fluency=`#e8bd59`로 바뀐다.
6. 헤더/푸터 JSX를 제거하고 캔버스 프레임 안 우상단에 작은 체력 오버레이를 배치한다. 접근성 상태는 시각적으로 숨긴다.
7. 실행: `pnpm exec vitest run src/features/resources/intrusionCanvasVisuals.test.ts src/app/App.test.tsx`

## 작업 5: 전투 통합과 실제 플레이 E2E

**파일**

- 수정: `e2e/resource-combat.ts`
- 수정: `e2e/game.spec.ts`

1. 이전 돌진 가로막기 시나리오를 제거하고 다음 브라우저 시나리오를 작성한다.
   - 적이 활성화 뒤 플레이어 쪽으로 추적한다.
   - 조준→발사 뒤 직선 탄환이 캔버스 data 속성에 나타난다.
   - 탄환 한 발 명중 시 체력이 100→90이 된다.
   - 적 몸체와 접촉해도 체력은 줄지 않는다.
   - 기지 복귀 시 300ms 뒤 750ms 주기로 10씩 회복한다.
   - 보드 상하 가시적 설명 띠가 없고 캔버스가 가용 높이를 사용한다.
2. 세 뷰포트 1280×720, 1366×650, 1440×900에서 보드의 주요 요소가 잘리지 않는지 확인한다.
3. 실행: `pnpm exec playwright test e2e/game.spec.ts --project=chromium`

## 작업 6: 전투 회귀 검증

1. 실행: `pnpm exec vitest run src/features/resources`
2. 실행: `pnpm typecheck`
3. 실행: `pnpm lint`
4. 실패가 있으면 가장 작은 원인 테스트부터 고치고 1~3을 반복한다.

