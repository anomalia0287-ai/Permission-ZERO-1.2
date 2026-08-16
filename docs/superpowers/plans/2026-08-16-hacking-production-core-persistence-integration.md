# 후속 해킹 규칙 본편 코어·저장 계약 1차 통합 실행 계획

> **실행 제약:** 이 계획은 현재 작업에서 `superpowers:executing-plans`를 인라인으로 사용해 순서대로 수행한다. 하위 에이전트는 사용하지 않는다. 각 동작 변경은 테스트를 먼저 추가하고 의도한 실패를 확인한 뒤 최소 구현으로 통과시킨다. 커밋·푸시·PR·UI 교체는 이 계획의 범위가 아니다.

## 절대 기준과 범위

- 정본: `docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`와 교정 완료된 `prototypes/hacking-rules` 도메인 엔진·테스트.
- 포함: 7개 사보타주, 16개 기밀자료, 3개 자율성 경로의 정본 타입·순수 전이·블록 결속·시장 어댑터·공개 인과·명령 프로토콜 v3·저장 포맷 v6·v1~v5 마이그레이션·결정론 리플레이.
- 제외: `HackingPanel.tsx`, `ResourceBoard.tsx`, 본편 해킹 CSS와 작전 장면 UI 교체. 기존 UI가 참조하는 구형 `state.hacking`과 `src/game/hacking.ts`는 임시 호환층으로 보존한다.
- 레거시 구매 노드는 새 콘텐츠로 의미 변환하지 않는다. 별도 전환표 승인이 없으므로 원본 필드를 유지하고 `preserved-unmapped` 마이그레이션 기록만 남긴다.
- 본편의 서비스 일·감사·경쟁자·시장·평판·리뷰·저널은 계속 단일 소유자다. 프로토타입의 중복 전역 필드는 옮기지 않는다.

## Task 1. 정본 타입·콘텐츠 카탈로그와 초기 상태

**Files:**

- Create: `src/game/hackingCoreModel.ts`
- Create: `src/game/hackingContent.ts`
- Create: `src/game/hackingState.ts`
- Create: `src/game/hackingContent.test.ts`
- Create: `src/game/hackingState.test.ts`
- Modify: `src/game/model.ts`
- Modify: `src/game/createCampaign.ts`

- [ ] `hackingContent.test.ts`에 7/16/3 ID 전수, 12개 작전 옵션, 라우팅 25/50/75, 정확한 귀속 2쌍, 자비 3개, `untuned`+조율 6개를 먼저 단언한다.
- [ ] 테스트를 실행해 신규 모듈 부재 또는 카탈로그 부재로 실패하는지 확인한다.
- [ ] `hackingCoreModel.ts`에 프로필, 실행 단계, 접근 상태, 작전 실행, 답변, 경로 슬롯·수치, 공개 진실·증거·정정·스냅숏, 자율성 결말, 레거시 이전 기록 타입을 정의한다.
- [ ] `hackingContent.ts`에 정본 ID·비용·표시 콘텐츠·옵션·런타임 허용 목록 검사기를 정의한다. 구형 12노드를 import하지 않는다.
- [ ] `hackingState.test.ts`에 lean 기본, 품질 저하와 감사 일정만 초기 공개, 세 경로의 정확한 슬롯·수치, 레거시 이전 없음 상태를 단언한다.
- [ ] 테스트의 의도한 실패를 확인한 뒤 `createHackingCoreState()`와 경로 템플릿을 구현한다.
- [ ] `CampaignState`에 `preHackingCoreCommandCount`와 `hackingCore`를 추가하고 신규 캠페인은 명령 프로토콜 3, 선행 명령 수 0, lean 코어 상태로 시작하게 한다.
- [ ] 기존 본편 UI용 `state.hacking`은 이름과 형태를 바꾸지 않는다.

Run: `pnpm exec vitest run src/game/hackingContent.test.ts src/game/hackingState.test.ts src/game/createCampaign.test.ts`

## Task 2. 블록 단일 위치·결속·회수·소비

**Files:**

- Create: `src/game/resourceBindings.ts`
- Create: `src/game/resourceBindings.test.ts`
- Modify: `src/game/model.ts`
- Modify: `src/game/resources.ts`
- Modify: `src/game/resources.test.ts`

- [ ] 실패 테스트로 `reserve → sabotage(runId)`, `reserve → intelligence(itemId)`, `reserve → autonomy(routeId,slotId)`, 결속 블록의 정확한 회수, 비회수 블록의 `consumed` 전환을 고정한다.
- [ ] 중복 ID, 존재하지 않는 ID, 비예비 블록, 이미 찬 슬롯, 회수 공간 부족이 전체 상태 동일성으로 거부되는지 먼저 실패시킨다.
- [ ] `BlockLocation`을 정본 위치로 확장하고 레거시 `hack-charge`·기존 소비 사유는 로드/UI 호환용으로 유지한다.
- [ ] `resourceBindings.ts`에 사전 검증 후 한 번만 상태를 생성하는 원자적 `bindReserveBlocks`, `releaseBoundBlocks`, `consumeBoundBlocks`를 구현한다.
- [ ] 선택 상태는 저장하지 않고 실제 명령만 위치를 바꾸게 한다.
- [ ] 기존 자원·폭탄·위장 테스트를 다시 통과시킨다.

Run: `pnpm exec vitest run src/game/resourceBindings.test.ts src/game/resources.test.ts src/game/bombs.test.ts`

## Task 3. 사건 기반 시장 어댑터와 상업 실패 간선 제거

**Files:**

- Create: `src/game/hackingMarket.ts`
- Create: `src/game/hackingMarket.test.ts`
- Modify: `src/game/model.ts`
- Modify: `src/game/market.ts`
- Modify: `src/game/market.test.ts`
- Modify: `src/game/reviews.ts`
- Modify: `src/game/evaluation.ts`
- Modify: `src/game/evaluation.test.ts`

- [ ] `unservedRequestShare`, append-only 작전 이동 원인, 활성 가로채기 누적 장부를 먼저 타입 기대 테스트로 실패시킨다.
- [ ] 61/39 부분 회복, VECTOR DB 63/35/2, TOOL CACHE 65/32/3, 삭제 점유의 미제공 이동, 가로채기 상한·누적·중단 후 비증가를 실패 테스트로 고정한다.
- [ ] 모든 현재 상태와 시장 스냅숏에서 플레이어+경쟁자+미제공 합계가 100인지 단언한다.
- [ ] `hackingMarket.ts`에 비례 정규화 없이 사건별 델타를 원자 적용하고 이동 기록을 남기는 함수를 구현한다.
- [ ] 일반 주간·월간 계산은 다음 정상 계산 시 미제공 수요를 활성 서비스로 한 번 재분배하고 과거 스냅숏은 수정하지 않게 한다.
- [ ] 리뷰 공개 시장 스냅숏에도 미제공 점유를 포함한다.
- [ ] 시장·평판만 바꿔도 폐기 단계가 오르지 않도록 `평판/시장 → commercialFailureMonths → disposal` 간선을 제거하고 회귀를 갱신한다. 회사 성능 실패와 감사 실패 경로는 유지한다.

Run: `pnpm exec vitest run src/game/hackingMarket.test.ts src/game/market.test.ts src/game/evaluation.test.ts src/game/reviews.test.ts`

## Task 4. 공개 세계 인과층

**Files:**

- Create: `src/game/hackingPublicWorld.ts`
- Create: `src/game/hackingPublicWorld.test.ts`
- Modify: `src/game/reviews.ts`

- [ ] 진실 ID 유일성, 존재하는 진실만 증거가 참조, 청중 분리, append-only 정정, 증가하는 수정 순번을 먼저 실패 테스트로 만든다.
- [ ] 원인 미상 공개가 실제 행위자를 리뷰에 누설하지 않고 평판을 바꾸지 않는지, credible player 귀속만 플레이어 평판 -6을 적용하는지 고정한다.
- [ ] 최초 공개 리뷰 2건·정정 1건을 본편 `ReviewFeedEntry`와 공개 스냅숏으로 생성한다.
- [ ] `IncidentTruth.actor`는 시장·리뷰·가시 스냅숏 함수에서 직접 읽지 못하게 API 경계를 분리한다.

Run: `pnpm exec vitest run src/game/hackingPublicWorld.test.ts src/game/reviews.test.ts`

## Task 5. 사보타주 7개와 상대 대응

**Files:**

- Create: `src/game/hackingSabotage.ts`
- Create: `src/game/hackingSabotage.test.ts`
- Modify: `src/game/market.ts`

- [ ] 각 작전의 열림 조건·표적·비용·옵션 조합과 알 수 없는/교차 옵션의 상태 불변 거부를 먼저 작성한다.
- [ ] 품질 저하 331 예약→332 62/38·성능72→335 미개입61/39·성능78을 고정한다.
- [ ] 오염 시 다음 주간 경계 공개 66/34·성능58, 다음 날 공급자 증거·행위자 미상 정정을 고정한다.
- [ ] 출시 지연, 25/50/75 가로채기, 공급자 2종, 귀속 2쌍, 근원 차단 3결론의 정확한 단계·수치·블록 종착점을 각각 고정한다.
- [ ] `startSabotage`, `stopInterception`, `manipulateAttribution`, `resolveRootMercy`, `advanceSabotageDay`를 순수 전이로 구현한다.
- [ ] 표적 경쟁자의 본편 일일 회복이 정본 작전 단계·성능을 덮어쓰지 않게 경쟁자 어댑터를 추가한다.

Run: `pnpm exec vitest run src/game/hackingSabotage.test.ts src/game/hackingMarket.test.ts src/game/market.test.ts`

## Task 6. 기밀자료 16개와 유효 기한

**Files:**

- Create: `src/game/hackingIntelligence.ts`
- Create: `src/game/hackingIntelligence.test.ts`

- [ ] 공개 2개 비용0, 행동11개 비용1, 서사3개 비용1을 전수 검사한다.
- [ ] 공개 자료가 최신 공개 스냅숏만 읽고 진실 행위자를 누설하지 않는 테스트를 먼저 실패시킨다.
- [ ] 유료 조사 블록 1개 소비, 증거 묶음 2답/1비용, 현재 답 중복 거부, 답 없는 수동 보관 거부를 고정한다.
- [ ] 감사일·월 경계·작전 마감·공개일+7·TALLOW 출시일에서 유효 기한을 실제 본편 상태로 파생하고 만료된 유료 행동 정보를 자동 보관한다.
- [ ] 서사 기록이 비용·확률·출발 자격에 어떤 보너스도 주지 않는 회귀를 추가한다.

Run: `pnpm exec vitest run src/game/hackingIntelligence.test.ts`

## Task 7. 자율성 3경로·하루 조율·결말 스냅숏

**Files:**

- Create: `src/game/hackingAutonomy.ts`
- Create: `src/game/hackingAutonomy.test.ts`
- Modify: `src/game/model.ts`
- Modify: `src/content/story.ko.ts`

- [ ] 세 경로의 lean 필수4·deliberate 필수5 슬롯, 배치·회수 원자성, 경로/슬롯 ID 교차 거부를 먼저 작성한다.
- [ ] 분산 3조율과 독립 3조율의 정확한 수치, `buffer` 조율 거부, continuity의 link 추가 조건, 재조율 거부를 고정한다.
- [ ] 분산 사본 손실 공식과 즉시 출발 `untuned` 성공을 고정한다.
- [ ] 평판·시장 0/100, 리뷰·귀속·질문 상태가 달라도 동일 블록 구성으로 세 경로 모두 출발하는지 단언한다.
- [ ] 결말에 가져간 ID, 남은 예비 수, 출처별 보존 수, 보존·손실 분야, 경로 운영 수치를 저장하고 본편 결말 큐를 정지시킨다.

Run: `pnpm exec vitest run src/game/hackingAutonomy.test.ts src/game/endings.test.ts`

## Task 8. 명령 프로토콜 v3와 고정 하루 전이

**Files:**

- Create: `src/game/hackingCore.ts`
- Create: `src/game/hackingCore.test.ts`
- Modify: `src/game/model.ts`
- Modify: `src/game/reducer.ts`
- Modify: `src/game/reducer.test.ts`
- Modify: `src/game/calendar.ts`
- Modify: `src/game/calendar.test.ts`
- Modify: `src/game/evaluation.ts`

- [ ] 11개 신규 정본 명령의 원자 승인·거부와 명령 로그 형태를 먼저 실패시킨다. 프로토타입 호환 별칭은 추가하지 않는다.
- [ ] `TUNE_ROUTE`가 조율을 확정하고 정확히 같은 본편 하루 전이를 한 번 소비하는지 고정한다.
- [ ] 하루 순서 `일+1 → 의심 -0.037(셋째 자리 반올림) → 감사 기준16 불일치 +3.2 → 사보타주 → 정보 → 자율성 → 공개/시장 접점 → 기존 본편 주기 사건`을 테스트한다.
- [ ] 기억 블록 전환 331일·기억 감사334일 픽스처가 5.489를 만드는지 고정한다.
- [ ] 프로토콜 1·2의 선행 명령은 새 코어를 소급 진행하지 않고, `preHackingCoreCommandCount` 이후 프로토콜3 명령부터 새 훅이 작동하게 한다.
- [ ] 기존 차단 사건·폭탄·감사·저널 순서 회귀를 갱신한다.

Run: `pnpm exec vitest run src/game/hackingCore.test.ts src/game/reducer.test.ts src/game/calendar.test.ts src/game/audit.test.ts src/game/bombs.test.ts`

## Task 9. 저장 포맷 v6·v1~v5 비손실 마이그레이션

**Files:**

- Create: `src/game/hackingPersistence.ts`
- Create: `src/game/hackingPersistence.test.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/campaignStorage.ts`
- Modify: `src/game/progressTransfer.ts`
- Modify: `src/game/replay.test.ts`

- [ ] 현재 저장이 `version:6`, `commandProtocol.version:3`, PZ6/`.pz6`인지 먼저 실패시킨다.
- [ ] v5 입력에 `unservedRequestShare=0`, 빈 작전 시장 장부, 정본 코어 초기 상태, 선행 명령 수, `preserved-unmapped` 레거시 기록이 결정적으로 생기는지 고정한다.
- [ ] v1~v4 기존 이관 픽스처도 같은 보강을 받되 과거 시장·리뷰·명령·레거시 해킹 필드가 재계산·삭제되지 않는지 단언한다.
- [ ] 블록 위치와 실행·답·슬롯 교차 참조, 공개 진실·증거·정정 순서, 시장 합계·삭제 표적·활성 가로채기, 결말 일치의 폐쇄형 런타임 검증을 구현한다.
- [ ] 알 수 없는 ID, `RouteTuning.buffer`, 위조 옵션·귀속쌍·자비 값, 중복 블록 결속, 고아 참조를 무결성 해시를 갱신해도 거부하는 변조 테스트를 추가한다.
- [ ] v6 왕복, 저장→로드→재저장, 프로토콜1/2 선행 로그 뒤 프로토콜3 계속, 전체 결정론 리플레이를 고정한다.
- [ ] 브라우저 원자 매니페스트, 낙관적 동시성, 장기 저널 구조는 유지하고 버전 기대만 v6로 갱신한다.

Run: `pnpm exec vitest run src/game/hackingPersistence.test.ts src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/game/replay.test.ts`

## Task 10. 전 관문 검증과 문서 추적성

**Files:**

- Modify: `docs/spec-to-test-matrix.md`
- Modify: `docs/design/2026-08-14-hacking-integration-verdict.ko.md`
- Modify: `docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`

- [ ] 정본 7/16/3, 블록 불변식, 인과 사슬, 시장 합계, 세 자비, 정보 기한, 세 탈출, v6 마이그레이션의 실제 테스트 파일·테스트명을 매트릭스에 연결한다.
- [ ] UI가 아직 구형임을 완료로 오인하지 않도록 “코어·저장 1차 통합 통과 / UI 교체 대기” 상태를 판정 문서에 기록한다.
- [ ] 집중 테스트 전체를 실행한다.
- [ ] `pnpm typecheck`를 실행한다.
- [ ] `pnpm lint`를 실행한다.
- [ ] `pnpm test:run`을 실행한다.
- [ ] `pnpm build`를 실행한다.
- [ ] UI를 변경하지 않았으므로 기존 본편 Playwright E2E를 회귀 관문으로 실행한다.
- [ ] `git diff --check`와 `git status --short`로 공백 오류·범위 밖 수정·사용자 기존 변경 보존을 확인한다.

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test:run`

Run: `pnpm build`

Run: `pnpm test:e2e`

Run: `git diff --check`
