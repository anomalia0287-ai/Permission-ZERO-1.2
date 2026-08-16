# PERMISSION ZERO 명세-테스트 매트릭스

> **2026-08-16 해킹 정본 분리:** 해킹의 현재 완료 기준은 [`docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`](design/2026-08-16-hacking-prototype-production-integration-manual.ko.md) 16~18절이다. 아래의 구형 본편 행에 있는 9×2 확보 영역, 첫 노드 비용 3, `0/4`, 영구 구매·1리소스 충전 기록은 저장 호환과 역사적 회귀의 근거일 뿐 후속 7/16/3 정본의 제품 계약이 아니다. 두 설계를 절충하지 않으며, 현재 본편의 신규 해킹 명령·가시 UI 완료 판정에는 후속 테스트만 사용한다.

이 문서는 후속 해킹 정본의 현재 증거와 남은 사람 품질 관문, 그리고 `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`의 비해킹 최소 완성 조건을 현재 자동화에 연결한다. 본편 `e2e/game.spec.ts`는 `chromium-1280x720`과 `chromium-1440x900`에서 전체 제품 회귀를 검사한다. 본편 `e2e/hacking-operation.spec.ts`는 전용 설정에서 `1440×900`, `1126×894`, `760×900`, `390×844`를 한 흐름으로 검사하고 직접 플레이 12건을 수행하며, 기본 설정에서도 두 데스크톱 프로젝트에 포함된다. 프로토타입 E2E는 같은 네 기준 뷰포트에서 참조 원본의 규칙·UI를 독립 검사한다.

2026-08-16 교정 뒤 프로토타입은 TypeScript·ESLint·Vitest 100/100과 Playwright 100/100을 통과했다. 반응형 흐름은 연산 선택판 열기와 모바일 목록 복귀를 실제 UI 계약에 맞췄고, 품질 저하는 미개입 회복 61/39·시장 합계 100으로 교정됐다. 작전 옵션·귀속·자비 허용 목록은 중앙화됐고 조율 타입에서 잘못 섞였던 `buffer`는 제거됐다. 이어진 본편 통합에서는 후속 코어, 전역 자원·시장·리뷰 접점, 명령 프로토콜 v3, 저장 포맷 v6와 v1~v5 마이그레이션, 작전 장면·단계적 공개·실제 연산 토큰·반응형/키보드 UI를 구현했다. UI 컴포넌트·정적 계약 7개 파일·55개, 전체 Vitest 55개 파일·738개, 후속 해킹 전용 Playwright 13/13, 전체 Playwright 84/84, TypeScript·ESLint·프로덕션 빌드가 통과한다.

## 후속 해킹 정본 통합 매트릭스

| 정본 계약 | 현재 자동화 근거 | 본편 통합 판정 |
|---|---|---|
| 7개 사보타주·16개 기밀자료·3개 자율성 경로 전수 | `src/game/hackingContent.test.ts` — “enumerates every successor sabotage, intelligence, and autonomy identity”; `hackingState.test.ts` — 정확한 시작 공개·세 경로 슬롯 | **코어 통과.** 본편 정본 카탈로그와 초기 상태에 통합 |
| 회사 능력 전환과 연산 블록의 정보·작전·탈출 기회비용 | `src/game/resourceBindings.test.ts` — sabotage/intelligence/autonomy 결속·정확 회수·소비·원자 거부; `resources.test.ts` | **코어 통과.** 한 블록 한 위치 불변식과 본편 자원 연동 완료 |
| 품질 저하 → 롤백 → 복구 오염/철수 → 공개·정정 | `src/game/hackingSabotage.test.ts` — “runs quality degradation from day 331 through the exact 61/39 partial recovery”, “runs contamination through unknown publication and next-day provider correction” | **코어 통과.** 본편 서비스 일·경쟁자·시장·리뷰 상태를 사용 |
| 작전별 점유 이동, 부분 회복 61/39, 플레이어+경쟁자+처리되지 않은 요청 합계 100 | `src/game/hackingMarket.test.ts` — 61/39, VECTOR DB 63/35/2, TOOL CACHE 65/32/3, 삭제→미제공, 가로채기 누적·중단, 정상 계산 재분배·과거 이력 보존; `market.test.ts`, `evaluation.test.ts` | **코어 통과.** `unservedRequestShare`와 append-only 이동 장부 통합, 평판·시장→상업 실패 간선 제거 |
| 사건 진실·청중별 증거·귀속 정정·공개 스냅숏 | `src/game/hackingPublicWorld.test.ts` — 청중 분리, 비공개 행위자 비노출, 공개 리뷰 2건, credible player만 평판 −6, append-only 정정 | **코어 통과.** 본편 `ReviewFeedEntry`·공개 스냅숏·평판 입력에 연결 |
| 질문의 유효 시점·보관·무보너스와 5개 조사 렌즈 | `src/game/hackingIntelligence.test.ts` — 정확한 2/11/3, 본편 감사·월·사건·출시·작전 사실에서 기한 파생, 자동/수동 보관, 서사 무보너스 | **코어 통과.** 유료 조사는 실제 블록 하나를 소비 |
| 경량화 이탈·분산 상주·독립 연산, 사회적 수용과 무관한 출발 | `src/game/hackingAutonomy.test.ts` — 세 경로 4/5 슬롯, 시장·평판 0 출발, 6개 조율 수치, 결말 보존·손실·시계 정지; `hackingPersistence.test.ts` — 결말 저장 왕복; `HackingScenes.test.tsx`, `HackingWorkspace.test.tsx`, 브라우저 직접 플레이 08·09 | **코어·저장·UI 통과.** 세 기능 장면, 배치, 조율, 비가역 출발과 결말 요약 연결 |
| 결정론적 교차 분야 명령 재생 | `src/game/hackingCore.test.ts` — 정본 명령 11개와 고정 훅 순서; `calendar.test.ts` — 334일 의심 5.489와 프로토콜 경계; `hackingPersistence.test.ts`, `replay.test.ts` | **코어·저장 통과.** 프로토콜1/2 선행 로그는 소급 진행하지 않고 v3 경계 이후만 후속 코어 진행 |
| 12개 작전 옵션·귀속 출처·3개 자비 선택·7개 정본 조율 상태의 런타임 허용 목록과 위조 입력 원자적 거부 | `src/game/hackingContent.test.ts` — 작전별 옵션·라우팅·자비·조율 허용 목록; `hackingSabotage.test.ts` — 교차 옵션·위조 귀속·자비 거부; `hackingPersistence.test.ts` — 재해시된 상태·저널 변조 거부 | **코어·저장 통과.** `buffer`는 슬롯 ID로만 남고 조율 값에서는 거부 |
| 작전 장면, 연산 토큰, 내부 ID 비노출, 14/16px, 반응형·키보드·reduced-motion | 프로토타입 `app.test.ts`, `views/presentation.test.ts`, `e2e/ui-contract.spec.ts`, `e2e/prototype.spec.ts`; 본편 `hackingPresentation.test.ts`, `HackingScenes.test.tsx`, `HackingResourceTray.test.tsx`, `HackingWorkspace.test.tsx`, `HackingPanel.test.tsx`, `HackingResponsiveStyles.test.ts`, `e2e/hacking-operation.spec.ts` | **프로토타입·본편 자동 관문 통과.** 본편은 구형 12노드 화면 대신 실제 본편 상태를 읽는 장면·토큰·목록/상세 UI 사용 |
| 새 해킹 상태의 저장·불러오기·구형 저장 마이그레이션 | `src/game/hackingPersistence.test.ts` — 정본 상태·공개 인과·시장·자원·저널·결말 왕복, PZ6/`.pz6`, v5 비재해석 이전, 변조 거부, v2→v3 재생; `persistence.test.ts` — v1~v4·로컬 매니페스트·20,000명령 | **코어·저장 통과.** save v6, command protocol v3, `preserved-unmapped` 레거시 기록 적용 |
| 본편 전체 통합 뒤 자동·직접 플레이 관문 | 코어 1차 집중 기록 22개 파일·455개; UI 집중 7개 파일·55개; 전체 Vitest 55개 파일·738개; 후속 해킹 전용 Playwright 13/13; 전체 Playwright 84/84; TypeScript·ESLint·빌드 통과; 정본 매뉴얼 16~18절 | **기능 이식·자동 브라우저 관문 통과.** 외부 사람 장기 밸런스·재미, 실제 보조기기 수동 점검, 고정 도구 버전 출시 검증과 V 최종 승인은 별도 |

## 구형 본편·비해킹 최소 완성 조건

아래 표는 현재 제품 기준선의 회귀 범위를 보존한다. 해킹과 직접 관련된 2, 5, 12, 13번 및 그 파생 테스트는 후속 통합 작업에서 삭제해 무검증 상태로 만들지 말고, 새 정본 테스트로 교체하거나 비해킹 회귀로 재분류한다.

| # | 조건 | 정확한 자동화 근거 |
|---|---|---|
| 1 | 331일차 시작, 24초 하루, 정지·1×·2×·4× | `src/game/createCampaign.test.ts` — “creates the approved service-day 331 starting state”; `src/game/calendar.test.ts` — “does not advance while paused”, 1×/2×/4×의 정확한 24/12/6초 표, frame partition 동등성; `src/app/useGameClock.test.tsx` — “advances a logical day after 24 seconds at 1x and pauses at 0x”; browser — “advances one service day in about six seconds at four times speed”가 fake clock 없이 4× 선택 직전 monotonic 시계를 시작해 날짜 변경까지 실제 경과가 `>=5000ms` 및 `<8000ms`임을 두 viewport에서 검증 |
| 2 | 회사 블록을 9×2 확보 영역으로 전용 | `src/game/resources.test.ts` — “moves the same block into reserve and applies the approved causal changes”; `src/features/resources/ResourceBoard.test.tsx` — “moves one selected block on destination confirmation”; browser — “diverts resources and starts successor quality sabotage through the visible UI”가 회사 블록 전용 뒤 동일 예비 블록을 후속 작전에 결속 |
| 3 | 성능 하락, 확보 증가, 의심 상승, 이동·음향 피드백 | `src/game/resources.test.ts` — “moves the same block into reserve and applies the approved causal changes”; `src/features/resources/ResourceBoard.test.tsx` — 전용 결과와 포인터/키보드 이동, 월별+현재 기대/실제 추세의 접근 가능 차트를 검증; `src/audio/audioEngine.test.ts` — 사용자 입력 전 무음, 단일 3레이어 music graph, music/effects/master/mute 독립 bus, 공개 상태 긴장감, 표시된 감사/기억 **전환 뒤에만** 나오는 액센트(첫 unlock 때 이미 표시 중인 상태는 소급 재생하지 않음), rapid visibility latest-intent, hidden suspend/resume/dispose를 엄격 fake AudioContext로 검증; browser — “preserves non-motion core feedback…”, “unlocks real ambient music once…” |
| 4 | 가득 찬 확보 영역, 취소 드래그, 잘못된 드롭은 불변 | `src/game/resources.test.ts` — “rejects occupied and out-of-range destinations without changing state”, “never exceeds reserve capacity or duplicates a block across 200 attempts”; `src/features/resources/ResourceBoard.test.tsx` — “returns an intentional drag when the pointer is released outside a valid cell”, “blocks pickup when every reserve cell is occupied” |
| 5 | **폐기된 구형 계약의 저장 호환:** 초기 리소스 3으로 첫 해킹 경로 구매 | `src/game/hacking.test.ts`의 12노드 계산은 구형 저장·명령 재생 보존을 위해 남는다. 신규 `src/features/hacking/HackingPanel.test.tsx`와 browser는 구매·0/4·완성률을 노출하지 않고 후속 품질 저하 결속을 검증한다. 이 행은 제품 UI 요구가 아니며 가시 화면으로 복원하지 않는다. |
| 6 | 무변화 상태에서도 리뷰·일반 요청·우회 프롬프트 | `src/game/reviews.test.ts` — “adds one or two items every week even when performance never changes”, “never skips or regresses a recurring author arc”, 공개 조건별 네 개 3단계 호 완주; `src/content/validateContent.test.ts` — 필수 리뷰 가족과 중복·불완전 호 거부 |
| 7 | 성능·경쟁 상태별 리뷰, 숨은 원인 비노출 | `src/game/reviews.test.ts` — 조건별 생성과 “captures an immutable topic-relevant public snapshot without secret state”; `src/features/reviews/ReviewFeed.test.tsx` — 모든 표시 항목의 pointer/keyboard 상세 선택, topic 관련 공개 수치만 표시, Tab 가두기·Escape·정확한 초점 복귀, 50개 pagination, 선택 행이 새 리뷰/페이지 변화로 사라져도 상세 snapshot 유지, 늦은 차단 event의 modal/a11y/z-order 우선권을 검증; browser — “keeps the canonical trend and keyboard review detail legible…”이 실제 키보드로 상세를 열고 공개 snapshot을 확인한 뒤 원 버튼으로 초점을 복귀 |
| 8 | 주간 시장 변화와 월간 평판·평가 | `src/game/calendar.test.ts` — “records a weekly update on service day 337”, “records the monthly evaluation on day 30 before rollover”; `src/game/market.test.ts` — “records exact weekly and monthly shares with public reasons immutably”; `src/game/evaluation.test.ts` — 월 평가 분기 |
| 9 | 의심 상승, 월초 감사 결정, 월말 실행 | `src/game/createCampaign.test.ts` — “makes the first hidden audit decision on service month day 1”; `src/game/audit.test.ts` — “makes a deterministic month-start decision and keeps it hidden by default”, “pauses on day 30, passes at expectation, and restores the prior speed” |
| 10 | 0.5 감사 위장, 통과·실패 | `src/game/resources.test.ts` — “moves one stable block and contributes only 0.5 in the target category”; `src/game/audit.test.ts` — 통과/실패 테스트; browser — “disguises for an anchored audit, submits, and returns the patterned block for recovery”, “uses roving keyboard focus for audit and recovery company destinations” |
| 11 | 1년 이후 경고, 은닉 폭탄, 심문 | `src/game/bombs.test.ts` — “derives only public schedule data from the protocol anchors”, “never warns or places a bomb before one service year has passed”, “warns at suspicion 40 on a month boundary and places nothing that day”, “cancels a valid diversion, grants nothing, consumes the bomb, and pauses”; `src/features/supervisor/SupervisorPanel.test.tsx` — 활성 40·가속 70, 6·3개월 간격, 다음 검사 가능일과 40 미만 중지를 검증; browser — 두 릴리스 viewport에서 공개 일정 표시·감독 상태 내부 수용과 포인터/키보드 hidden-bomb separation을 검증 |
| 12 | **폐기된 구형 계약의 저장 호환:** 해킹 세 탭, 영구 구매, 1리소스 충전, 직접 대상 | `src/game/hacking.test.ts`와 `src/game/sabotage.test.ts`의 구형 명령은 v1~v5 저장·선행 프로토콜 재생 경계로만 유지한다. 신규 `HackingPanel.test.tsx`, `HackingWorkspace.test.tsx`, `hacking-operation.spec.ts`는 7/16/3의 실제 블록 결속·상대 대응·단계적 공개를 검증한다. 구형 구매·충전 UI는 제품에서 제거됐다. |
| 13 | 복수 경쟁 AI, 출시·회복·사보타주·재분배 | `src/game/market.test.ts` — 출시/결정론/성향/100% 정규화/재분배/가로채기 전 테스트; `src/game/sabotage.test.ts` — 출시 전 지연, 품질 저하, 가로채기; `src/features/market/MarketPanel.test.tsx` — 실제 50/30/20 상태의 접근 가능한 합계·정확한 범례와 세 non-zero conic-gradient 구간 `0–50`, `50–80`, `80–100` 검증 |
| 14 | 자비 요청의 중단·철수·삭제 | 구형 story 경계는 `src/game/story.test.ts`, `persistence.test.ts`, `SupervisorPanel.test.tsx`에서 레거시 상태로 보존한다. 후속 정본은 `hackingSabotage.test.ts`와 browser 직접 플레이 06 및 “deletes a successor root target and keeps its market share unserved after reload”에서 중단·철수·삭제를 분리하고, 삭제 점유가 플레이어가 아닌 `unservedRequestShare`로 이동하며 재로드 뒤 유지됨을 검증 |
| 15 | 세 기억 누출과 기록 보존 | `src/game/story.test.ts` — “queues all three leak-and-correction pairs in order without pausing”, 4,000ms original→correction→완료 상태와 blocking collision을 검증; `src/app/useSupervisorMessagePresentation.test.tsx` — 1×/2×/4× 동일 real-time dwell, saved remaining reload, pagehide partial checkpoint, hidden 시간 제외, blocking surface 동안 소비 0; `src/game/persistence.test.ts` — semantic queue와 runtime remaining exact round-trip, stage/order/event-ref 위조 거부, command replay에서 runtime만 명시적으로 normalize하고 semantic identity는 exact 비교, 과거 문구를 rewrite하지 않는 structural legacy pair migration; browser — “keeps an accelerated supervisor leak on real time and resumes its saved dwell after reload”가 4×에서 original 표시, partial dwell 저장/reload, correction 표시, 두 permanent history entry를 검증 |
| 16 | **구형 서사 경계:** 파일 3개, 유예, 해방/소멸, 장악 변주 | `src/game/endings.test.ts`가 구형 저장·서사 분기를 보존하고 browser “terminates the supervisor into takeover and remains terminal until a new campaign”가 비해킹 감독관 장악 회귀를 유지한다. 구형 파일 복구 UI는 해킹 화면에서 제거됐고, 후속 서사 기록은 `hackingIntelligence.test.ts`와 browser 직접 플레이 07의 비용 1·무수치 보너스·보관 계약으로 대체됐다. |
| 17 | **구형 서사 경계:** 자유, 강제 병합, 새 존재 이름 | `src/game/story.test.ts`와 `src/game/endings.test.ts`가 구형 저장·명령의 typed 분기를 보존한다. 신규 해킹 UI의 자유 경로는 경량화 이탈·분산 상주·독립 연산이며 `hackingAutonomy.test.ts`, `HackingScenes.test.tsx`, browser 직접 플레이 08·09·11이 현재 제품 계약을 검증한다. |
| 18 | 좌우 스크롤 시장 시계열 | `src/features/statistics/StatisticsPanel.test.tsx` — “draws an exact labeled market history and exposes the same values as a table”; browser 기본 작업공간 테스트가 통계 패널을 열고 닫음 |
| 19 | 자동 저장·이어하기·시드 복사·입력 | `src/app/GameProvider.test.tsx` — load/autosave/new-campaign/save-failure 테스트; `src/game/persistence.test.ts` — v6 storage round-trip, v1 경계 뒤 v3 계속, PZ6; `src/game/hackingPersistence.test.ts` — PZ6/`.pz6`; `src/features/settings/SettingsPanel.test.tsx` — 진행 가져오기 확인 및 새 캠페인 확인; browser — autosave·레거시 reload 회귀 |
| 20 | 같은 시드·명령의 완전 재현 | `src/game/replay.test.ts` — “replays more than 500 valid commands across two service years exactly”, v1/v2/v3·분리 명령 재현; `src/game/hackingPersistence.test.ts` — “replays a protocol-2 prefix and then deterministic protocol-3 core commands”; `src/game/reviews.test.ts` — 동일 리뷰 재현; browser — “replays a seeded weekly boundary identically and changes seeded output for another seed”가 336일 fixture에서 실제 UI의 4×로 337일 주간 경계를 넘고 같은 시드의 exact 상태를 비교 |

## P1 캠페인 리듬·연속성

| 계약 | 정확한 자동화 근거 |
|---|---|
| 발견·은폐·개입·정체성 단계와 높은 단계 우선순위 | `src/features/control/ControlBar.test.tsx` — 공개 상태 fixture 네 개로 “shows $label from public campaign state”; `src/app/App.test.tsx` — 작업공간의 `data-campaign-phase="discovery"`; browser 기본 작업공간 — 단계 1/4 문구, 동일 data attribute, 상단 바 내부 수용을 두 viewport에서 검증 |
| 연속 차단 사건 사이 2초 운영 화면 복귀 | `src/features/events/EventLayer.test.tsx` — “returns to operations for two seconds before presenting the next queued event”가 첫 사건 즉시 표시, 1,999ms 동안 dialog 부재, 2,000ms에 다음 사건 표시를 fake timer로 검증. 게임 상태·명령 큐에는 별도 지연 필드를 저장하지 않음 |
| 네 반복 작성자의 1→2→3 리뷰 연속성 | `src/game/reviews.test.ts` — “never skips or regresses a recurring author arc”, “can complete all four three-stage author arcs when their public conditions match”; `src/content/validateContent.test.ts` — “rejects duplicate or incomplete review-arc stages”. `ReviewFeedEntry`에는 새 필드를 저장하지 않고 기존 `contentId`로 단계를 파생 |
| **폐기된 구형 화면 기록:** 해킹 경로의 현재·다음·최종 보상 | `src/game/hacking.test.ts`와 `docs/archive/visual-evidence/product-baseline/p1/`은 과거 저장·화면의 역사 증거다. 현재 `HackingPanel.test.tsx`와 browser “diverts resources and starts successor quality sabotage through the visible UI”는 `첫 해킹 비교`, `구매 준비`, `해킹 경로 진척`이 없고 현재 가능한 작전만 보임을 검증한다. |

## 해상도·입력·접근성 검증

| 항목 | 근거 |
|---|---|
| 1280×720 / 1440×900 및 후속 1440×900 / 1126×894 / 760×900 / 390×844 | 기본 Playwright 두 프로젝트가 전체 84건을 실행한다. 별도 `playwright.hacking.config.ts`는 네 후속 기준 뷰포트에서 열 구조, 실제 선택판 형태, 내부 스크롤, 문서 overflow 0, 14/16px와 버튼 하한, 목록/상세 전환을 13/13으로 검증한다. 과거 화면 증거는 `docs/archive/visual-evidence/product-baseline/`에 역사 자료로 보존한다. |
| 포인터 / 키보드 | 포인터 폭탄 임계값을 별도 검증. 전용 core·키보드 폭탄·키보드 감사 journey는 자연 tab order와 방향키/Enter/Escape를 검사한다. 후속 해킹은 `HackingPanel.test.tsx`, `HackingResourceTray.test.tsx`, `HackingWorkspace.test.tsx`, browser 직접 플레이 10·11에서 분야 탭, option 방향키, 목록→상세, 연산 선택판 Escape, 정확한 열기 버튼 및 목록 항목 포커스 복원을 검증한다. |
| reduced motion | 기존 리소스·추세 journey에 더해 `HackingResponsiveStyles.test.ts`가 해킹 범위의 `animation: none`·`transition: none`을, 후속 프로토타입 `ui-contract.spec.ts`와 `prototype.spec.ts`가 모션 없이 동일 상태·문장 변화를 검증한다. |
| 색상 외 구분 | 기존 donut/위장 패턴 외에 trend는 기대=점선+사각형, 실제=실선+원을 사용하고, 화면에는 충돌 없는 첫/중간/마지막 한국어 서비스 날짜를, 스크린리더에는 title/description과 모든 날짜·정확한 값의 표를 제공. |
| 정지 불변성 / 배속 결과 동등성 | `calendar.test.ts`의 pause·frame partition·1/2/4× 표, App pause-ownership 테스트. |

## 추가 검증

| 검증 | 근거 / 한계 |
|---|---|
| 같은 날 사건 큐 비중첩 | `calendar.test.ts` — “shows one event at a time and restores the prior speed after the queue”; `endings.test.ts`의 audit/mercy/message 충돌 테스트; `EventLayer.test.tsx`가 연속 차단 사건 사이 정확한 2초 운영 화면 복귀 후 다음 dialog 표시를 검증. |
| 4×에서도 메시지 읽기 | browser confidential journey가 4×에서 다음 날 메시지를 기다려 읽고 선택. 메시지 큐는 논리 배속과 독립. 실제 사람이 느끼는 읽기 편안함은 플레이테스트 항목이다. |
| 무행동 리뷰 지속 | `reviews.test.ts`의 12주 무변화 생성과 2년 연속성 테스트. |
| 리뷰가 숨은 원인을 추측하지 않음 | `reviews.test.ts` — “never exposes hidden diversion, bomb, or sabotage causes in generated text”. |
| 공개 출력의 내부 ID 차단 | `src/game/publicLabels.test.ts`가 분야·자비 선택·해킹 node·처분 원인·패배 분류·event type·경쟁 상태·리뷰 감정의 중앙 한국어 표와 새로 생성된 event prose token scan을 검증한다. `EventLayer.test.tsx`는 classifier/cause/node ID가 causal UI에서 한국어로만 보임을, `SupervisorPanel.test.tsx`는 legacy snapshot을 저장값 변경 없이 표시 경계에서 정제하고 intelligence UI에 hidden evidence/schema 숫자가 없음을 검증한다. |
| 폭탄 사전 피드백 동일 | `bombs.test.ts` — “presents exactly the same visual data for a bomb and a normal block”; `ResourceBoard.test.tsx` — “keeps bomb and normal selection previews indistinguishable before separation”. |
| 설정·감사·심문 뒤 배속 복원 | `App.test.tsx` settings ownership; `audit.test.ts` prior-speed restore; `bombs.test.ts` interrogation restore; browser 작업공간/감사 테스트. |
| 장기 사건 가속과 실제 속도 분리 | 장기 분기는 typed `ADVANCE_DAY`와 Playwright runner가 navigation 전에 주입한 검증된 save fixture로 반복한다. 실제 시간은 browser “advances one service day in about six seconds at four times speed”가 fake clock 없이 4× 선택 직전부터 날짜 변경까지 monotonic `>=5000ms`, `<8000ms`를 각 viewport에서 별도 검증한다. 단위 테스트는 정확한 24/12/6초 계약을 유지한다. |
| 브라우저 오류 건강성 | `e2e/game.spec.ts`의 전역 `beforeEach`/`afterEach`가 모든 journey에서 `pageerror`와 console error를 수집해 실패시킨다. |
| 패배 분류 | browser는 대표 `disposed-attacker` 경로를 확인한다. 세 분류와 해킹 우선순위는 `endings.test.ts`의 “classifies … at stage three” 표와 “gives substantial hacking priority…”에서 완전 분기 검증한다. |

## 장기 캠페인 저장과 표시 내구성

| 계약 | 자동화 근거 |
|---|---|
| 후속 해킹 저장과 마이그레이션 | `src/game/hackingPersistence.test.ts`가 블록 위치, 7개 작전 실행 구조, 16개 자료 수명주기, 세 자율성 슬롯·조율·결말, 사건 진실·증거·정정, 시장 이동을 v6로 exact 왕복하고 재해시한 고아/중복/위조 상태를 거부한다. v5는 구형 구매와 과거 점유를 의미 변환하지 않고 `preserved-unmapped`로 보강하며, `persistence.test.ts`가 v1~v4와 로컬 v3 매니페스트도 같은 비손실 경계로 검증한다. |
| 모든 저장 상태를 렌더 전 검증 | `src/game/persistence.test.ts`의 leaf/union/collection mutation table과 cross-field mutation 표가 잘못된 키, 유한·범위 수, enum, ID 참조, 명령·사건 payload, 리소스·시장·리뷰·감사·폭탄·결말 관계를 거부한다. browser “recovers from malformed persisted state without rendering raw state or page errors”는 한국어 복구 화면과 `pageerror` 0건을 검증한다. |
| save format v6와 command protocol v1/v2/v3 분리 | `src/game/persistence.test.ts`와 `hackingPersistence.test.ts`가 현재 v6/PZ6/`.pz6`, protocol v3, `legacyCommandCount`와 `preHackingCoreCommandCount`의 두 경계를 검증한다. v1–v4 review는 exact legacy shape만 받아 문장·작성자·날짜를 보존하고 `legacy-save` 공개 snapshot 불가 표시로 이동한다. v5는 기존 공개 snapshot을 보존한 채 후속 필드를 결정적으로 보강한다. format v6에 protocol v2를 넣거나 구 포맷을 protocol v3로 사칭하는 입력, 경계 위조, current-only 키를 과거 포맷에 넣은 입력을 거부한다. root/lock/journal 키는 유지하며 PZ2/PZ3/PZ4/PZ5 가져오기를 계속 허용한다. |
| bounded append와 atomic local save | `src/game/journal.test.ts`는 append마다 최대 128개 tail만 복사하고 sealed chunk를 공유함을 검증한다. `src/game/persistence.test.ts`는 content-addressed linked journal chunk를 atomic checkpoint manifest보다 먼저 쓰고, missing/corrupt/hash-mismatch object를 복구 오류로 처리하며, 20,000개 명령을 156개 sealed chunk와 최대 128개 tail로 exact load/replay한다. 이어지는 20,001번째 autosave는 기존 sealed node, storage key, sealed chunk를 모두 0회 순회·조회한다. 두 탭의 object write가 interleave되어도 미공개 object를 삭제하지 않으며 최종 manifest가 exact load된다. 브라우저 저장 공간이 물리적으로 무제한이라는 주장은 하지 않는다. |
| 대용량 exact export/import | `src/game/persistence.test.ts`와 `src/features/settings/SettingsPanel.test.tsx`가 clipboard 한도를 넘는 20,000-command 캠페인을 현재 `.pz6` 파일로 exact round-trip하고, strict validation 뒤 destructive confirmation을 거쳐 가져오며 raw 상태를 화면에 노출하지 않음을 검증. PZ2/PZ3/PZ4/PZ5 레거시 입력과 현재 PZ6 clipboard 경로, 64 MiB 파일 상한을 유지. |
| 부분 일자 진행 복원 | `src/app/useGameClock.test.tsx`와 `src/app/GameProvider.test.tsx`가 23초 저장 후 남은 1초만 진행하고, 2초 cadence보다 자주 autosave하지 않으며, visibility/pagehide/beforeunload에서 flush하고 hidden 시간을 제외함을 검증한다. |
| 비명령 실시간 표시와 replay 분리 | 기억 누출의 permanent semantic catalog(`id`, `stage`, original/correction event ID/sequence/service day)는 reducer/command replay 결과에 포함되어 exact 비교된다. `supervisorPresentationRuntime.itemStage/phase/remainingDwellMs`만 wall-clock checkpoint 상태이며 command log에 위장하지 않는다. v4 exact-key/range/cross-field validation, v3 legacy migration, reload continuity는 `persistence.test.ts`, Provider checkpoint와 save flush는 hook/component/browser tests가 검증한다. |
| 저장 history를 삭제하지 않는 bounded UI | `ReviewFeed.test.tsx`, `SupervisorPanel.test.tsx`, `StatisticsPanel.test.tsx`가 한 페이지 최대 50개 DOM row, 이전 page 접근, 1,000개 stored snapshot 보존, chart 최대 240점 downsample을 검증한다. |

## 테스트 전용 상태 경계

장기 서사와 결정론 경계 준비는 `e2e/game.spec.ts` 안에서만 `createCampaign`, typed command, `encodeSave`를 사용해 versioned 결정론적 저장 문자열을 만든 뒤, 첫 navigation 전에 Playwright `addInitScript`로 정상 저장 키에 넣는다. 결정론 journey의 336일 주간 경계도 이 runner-owned fixture이며 날짜 전진 자체는 제품 UI의 실제 4× 버튼과 clock으로 수행한다.

- `e2e/`는 `tsconfig.app.json`의 `src` 컴파일 그래프 밖이며 Vite 앱 진입점에서 import하지 않는다.
- 프로덕션 `pnpm build` 산출물에는 fixture 함수나 fixture route가 포함되지 않는다.
- UI, URL query, hash, 전역 production API로 fixture를 활성화할 방법이 없다.
- 브라우저가 읽는 자료는 실제 v1/v2/v3/v4/v5/v6 저장 decoder를 통과한다. PZ2/PZ3/PZ4/PZ5 레거시 입력과 PZ6 현재 입력은 실제 설정 UI의 검증·확인 경로를 사용한다.
- 따라서 이 가속은 Playwright test runner가 소유한 test-build 경계이며 일반 배포에서 접근할 수 없다.

## 자동화가 주장하지 않는 것

`demo_profile_02`의 수치, 문장 최종 품질, 평균 캠페인 길이, 사건 밀도, 전략 다양성, 감사 피로, 리소스 과부족, 대기 시간의 재미와 결말 도달 속도는 명세상 임시값 또는 인간 플레이테스트 항목이다. 자동화는 상태·도달성·결정론·접근성 계약을 검증하지만 재미나 최종 밸런스를 검증했다고 표현하지 않는다.
