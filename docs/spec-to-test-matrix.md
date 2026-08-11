# PERMISSION ZERO 명세-테스트 매트릭스

이 문서는 `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md` 15절의 최소 완성 조건과 추가 검증을 현재 자동화에 연결한다. 모든 `e2e/game.spec.ts` 테스트는 `chromium-1280x720`과 `chromium-1440x900` 두 프로젝트에서 동일한 빌드에 대해 실행된다.

## 최소 완성 조건

| # | 조건 | 정확한 자동화 근거 |
|---|---|---|
| 1 | 331일차 시작, 24초 하루, 정지·1×·2×·4× | `src/game/createCampaign.test.ts` — “creates the approved service-day 331 starting state”; `src/game/calendar.test.ts` — “does not advance while paused”, 1×/2×/4×의 정확한 24/12/6초 표, frame partition 동등성; `src/app/useGameClock.test.tsx` — “advances a logical day after 24 seconds at 1x and pauses at 0x”; browser — “advances one service day in about six seconds at four times speed”가 fake clock 없이 4× 선택 직전 monotonic 시계를 시작해 날짜 변경까지 실제 경과가 `>=5000ms` 및 `<8000ms`임을 두 viewport에서 검증 |
| 2 | 회사 블록을 9×2 확보 영역으로 전용 | `src/game/resources.test.ts` — “moves the same block into reserve and applies the approved causal changes”; `src/features/resources/ResourceBoard.test.tsx` — “moves one selected block on destination confirmation”; browser — “diverts resources and schedules a charged sabotage through the visible UI” |
| 3 | 성능 하락, 확보 증가, 의심 상승, 이동·음향 피드백 | `src/game/resources.test.ts` — “moves the same block into reserve and applies the approved causal changes”; `src/features/resources/ResourceBoard.test.tsx` — “selects a block on click and shows exact diversion consequences”, “dispatches exactly once when an intentional drag reaches an empty reserve cell”; `src/audio/audioEngine.test.ts` — “creates separate mix buses once and plays a procedural cue after unlock”; browser — “preserves non-motion core feedback when reduced motion is requested” |
| 4 | 가득 찬 확보 영역, 취소 드래그, 잘못된 드롭은 불변 | `src/game/resources.test.ts` — “rejects occupied and out-of-range destinations without changing state”, “never exceeds reserve capacity or duplicates a block across 200 attempts”; `src/features/resources/ResourceBoard.test.tsx` — “returns an intentional drag when the pointer is released outside a valid cell”, “blocks pickup when every reserve cell is occupied” |
| 5 | 초기 리소스 3으로 첫 해킹 경로 구매 가능 | `src/game/hacking.test.ts` — “defines three independent ordered trees whose first nodes all cost 3”, 각 트리 구매 표; `src/features/hacking/HackingPanel.test.tsx` — “keeps all three trees and the reserve visible while purchasing a node”; browser — “diverts resources and schedules a charged sabotage through the visible UI” |
| 6 | 무변화 상태에서도 리뷰·일반 요청·우회 프롬프트 | `src/game/reviews.test.ts` — “adds one or two items every week even when performance never changes”, “lets recurring authors build continuity during a two-year campaign”; `src/content/validateContent.test.ts` — 필수 리뷰 가족 검증 |
| 7 | 성능·경쟁 상태별 리뷰, 숨은 원인 비노출 | `src/game/reviews.test.ts` — “weights low performance toward negativity without eliminating other voices”, “gates performance reviews by their own category without cross-category leakage”, “never exposes hidden diversion, bomb, or sabotage causes in generated text” |
| 8 | 주간 시장 변화와 월간 평판·평가 | `src/game/calendar.test.ts` — “records a weekly update on service day 337”, “records the monthly evaluation on day 30 before rollover”; `src/game/market.test.ts` — “records exact weekly and monthly shares with public reasons immutably”; `src/game/evaluation.test.ts` — 월 평가 분기 |
| 9 | 의심 상승, 월초 감사 결정, 월말 실행 | `src/game/createCampaign.test.ts` — “makes the first hidden audit decision on service month day 1”; `src/game/audit.test.ts` — “makes a deterministic month-start decision and keeps it hidden by default”, “pauses on day 30, passes at expectation, and restores the prior speed” |
| 10 | 0.5 감사 위장, 통과·실패 | `src/game/resources.test.ts` — “moves one stable block and contributes only 0.5 in the target category”; `src/game/audit.test.ts` — 통과/실패 테스트; browser — “disguises for an anchored audit, submits, and returns the patterned block for recovery”, “uses roving keyboard focus for audit and recovery company destinations” |
| 11 | 1년 이후 경고, 은닉 폭탄, 심문 | `src/game/bombs.test.ts` — “never warns or places a bomb before one service year has passed”, “warns at suspicion 40 on a month boundary and places nothing that day”, “cancels a valid diversion, grants nothing, consumes the bomb, and pauses”; browser — 포인터/키보드 hidden-bomb separation 두 테스트 |
| 12 | 해킹 세 탭, 구매, 1리소스 충전, 직접 대상 | `src/game/hacking.test.ts` — 세 독립 트리 및 구매 테스트; `src/game/sabotage.test.ts` — “stores the same resource in a purchased node without creating evidence”, “consumes the charge only after target confirmation and schedules the next day”; `src/features/hacking/HackingPanel.test.tsx` — 구매·충전·대상 테스트; browser — “diverts resources and schedules a charged sabotage through the visible UI” |
| 13 | 복수 경쟁 AI, 출시·회복·사보타주·재분배 | `src/game/market.test.ts` — 출시/결정론/성향/100% 정규화/재분배/가로채기 전 테스트; `src/game/sabotage.test.ts` — 출시 전 지연, 품질 저하, 가로채기; `src/features/market/MarketPanel.test.tsx` — 실제 50/30/20 상태의 접근 가능한 합계·정확한 범례와 세 non-zero conic-gradient 구간 `0–50`, `50–80`, `80–100` 검증 |
| 14 | 자비 요청의 중단·철수·삭제 | `src/game/story.test.ts` — 자비 선택 표; `src/game/endings.test.ts` — 같은 날짜 사건 충돌과 우회 방지; `src/features/events/EventLayer.test.tsx` — 경쟁 AI 결정 UI 표 |
| 15 | 세 기억 누출과 기록 보존 | `src/game/story.test.ts` — “emits all three leak-and-correction pairs in order without pausing”, “waits for a quiet event queue instead of colliding with a blocking event”; `src/features/supervisor/SupervisorPanel.test.tsx` — 날짜가 있는 기록 뷰 |
| 16 | 파일 3개, 유예, 해방/소멸, 장악 변주 | `src/game/endings.test.ts` — 파일 스냅샷, 다음 날 메시지, 유예, 해방/소멸 명령 분기; browser — “recovers all confidential files, defers the message, and rereads the permanent archive”, “terminates the supervisor into takeover and remains terminal until a new campaign” |
| 17 | 자유, 강제 병합, 새 존재 이름 | `src/game/story.test.ts` — “offers freedom with control departure and merge only while the supervisor exists”, “creates a named third existence on forced merge and preserves identity on freedom”; `src/game/endings.test.ts` — typed freedom/merge 경로; browser confidential journey의 강제 병합 확인 UI |
| 18 | 좌우 스크롤 시장 시계열 | `src/features/statistics/StatisticsPanel.test.tsx` — “draws an exact labeled market history and exposes the same values as a table”; browser 기본 작업공간 테스트가 통계 패널을 열고 닫음 |
| 19 | 자동 저장·이어하기·시드 복사·입력 | `src/app/GameProvider.test.tsx` — load/autosave/new-campaign/save-failure 테스트; `src/game/persistence.test.ts` — storage round-trip/PZ2/v1 경계; `src/features/settings/SettingsPanel.test.tsx` — PZ2 확인 및 새 캠페인 확인; browser — autosave reload, v1→v2 reload, PZ2 reload |
| 20 | 같은 시드·명령의 완전 재현 | `src/game/replay.test.ts` — “replays more than 500 valid commands across two service years exactly”, v1/v2/분리 명령 재현; `src/game/reviews.test.ts` — 동일 리뷰 재현; browser — “replays a seeded weekly boundary identically and changes seeded output for another seed”가 336일 fixture에서 실제 UI의 4×로 337일 주간 경계를 넘고, 같은 시드의 exact resources/reviews/market/events/audit/bombs/story를 deep-equal하며 다른 알려진 시드의 주간 reviews/market/events 중 하나 이상이 달라짐을 검증 |

## 해상도·입력·접근성 검증

| 항목 | 근거 |
|---|---|
| 1280×720 / 1440×900 | Playwright의 `chromium-1280x720`, `chromium-1440x900` 프로젝트가 모든 browser 테스트를 실행. “keeps the full operations workspace usable at the configured release viewport”가 문서 overflow와 핵심 영역 가시성을 검사. |
| 포인터 / 키보드 | 포인터 폭탄 임계값을 별도 검증. 전용 core·키보드 폭탄·키보드 감사 journey는 `.focus()`, `.click()`, DOM focus/evaluate 우회 없이 자연 body focus 또는 제품이 지정한 감사 initial focus에서 Tab/Shift+Tab/방향키/Enter/Escape만 사용하며 회사 블록, 확보 목적지, 설정 및 modal 경계, 감사 source/destination/recovery가 실제 tab order로 도달됨을 각 경계의 `toBeFocused()`로 검증. |
| reduced motion | `ResourceBoard.test.tsx` — “preserves threshold bomb activation with reduced motion enabled”; browser — “preserves non-motion core feedback when reduced motion is requested”가 `prefers-reduced-motion: reduce`에서 computed animation/transition duration이 모두 1ms 이하이고 drag trail과 반복 drag animation이 보이지 않으면서 border/shadow 피드백 및 실제 전용 명령 성공은 유지됨을 검증. |
| 색상 외 구분 | `MarketPanel.test.tsx` 및 browser donut 테스트의 이름·정확한 퍼센트·패턴 마커; `ResourceBoard.test.tsx`의 위장 패턴/텍스트. |
| 정지 불변성 / 배속 결과 동등성 | `calendar.test.ts`의 pause·frame partition·1/2/4× 표, App pause-ownership 테스트. |

## 추가 검증

| 검증 | 근거 / 한계 |
|---|---|
| 같은 날 사건 큐 비중첩 | `calendar.test.ts` — “shows one event at a time and restores the prior speed after the queue”; `endings.test.ts`의 audit/mercy/message 충돌 테스트. |
| 4×에서도 메시지 읽기 | browser confidential journey가 4×에서 다음 날 메시지를 기다려 읽고 선택. 메시지 큐는 논리 배속과 독립. 실제 사람이 느끼는 읽기 편안함은 플레이테스트 항목이다. |
| 무행동 리뷰 지속 | `reviews.test.ts`의 12주 무변화 생성과 2년 연속성 테스트. |
| 리뷰가 숨은 원인을 추측하지 않음 | `reviews.test.ts` — “never exposes hidden diversion, bomb, or sabotage causes in generated text”. |
| 폭탄 사전 피드백 동일 | `bombs.test.ts` — “presents exactly the same visual data for a bomb and a normal block”; `ResourceBoard.test.tsx` — “keeps bomb and normal selection previews indistinguishable before separation”. |
| 설정·감사·심문 뒤 배속 복원 | `App.test.tsx` settings ownership; `audit.test.ts` prior-speed restore; `bombs.test.ts` interrogation restore; browser 작업공간/감사 테스트. |
| 장기 사건 가속과 실제 속도 분리 | 장기 분기는 typed `ADVANCE_DAY`와 Playwright runner가 navigation 전에 주입한 검증된 save fixture로 반복한다. 실제 시간은 browser “advances one service day in about six seconds at four times speed”가 fake clock 없이 4× 선택 직전부터 날짜 변경까지 monotonic `>=5000ms`, `<8000ms`를 각 viewport에서 별도 검증한다. 단위 테스트는 정확한 24/12/6초 계약을 유지한다. |
| 브라우저 오류 건강성 | `e2e/game.spec.ts`의 전역 `beforeEach`/`afterEach`가 모든 24개 journey에서 `pageerror`와 console error를 수집해 실패시킨다. |
| 패배 분류 | browser는 대표 `disposed-attacker` 경로를 확인한다. 세 분류와 해킹 우선순위는 `endings.test.ts`의 “classifies … at stage three” 표와 “gives substantial hacking priority…”에서 완전 분기 검증한다. |

## 테스트 전용 상태 경계

장기 서사와 결정론 경계 준비는 `e2e/game.spec.ts` 안에서만 `createCampaign`, typed command, `encodeSave`를 사용해 versioned 결정론적 저장 문자열을 만든 뒤, 첫 navigation 전에 Playwright `addInitScript`로 정상 저장 키에 넣는다. 결정론 journey의 336일 주간 경계도 이 runner-owned fixture이며 날짜 전진 자체는 제품 UI의 실제 4× 버튼과 clock으로 수행한다.

- `e2e/`는 `tsconfig.app.json`의 `src` 컴파일 그래프 밖이며 Vite 앱 진입점에서 import하지 않는다.
- 프로덕션 `pnpm build` 산출물에는 fixture 함수나 fixture route가 포함되지 않는다.
- UI, URL query, hash, 전역 production API로 fixture를 활성화할 방법이 없다.
- 브라우저가 읽는 자료는 실제 v1/v2 저장 decoder를 통과한다. PZ2는 실제 설정 UI의 검증·확인 경로를 사용한다.
- 따라서 이 가속은 Playwright test runner가 소유한 test-build 경계이며 일반 배포에서 접근할 수 없다.

## 자동화가 주장하지 않는 것

`demo_profile_02`의 수치, 문장 최종 품질, 평균 캠페인 길이, 사건 밀도, 전략 다양성, 감사 피로, 리소스 과부족, 대기 시간의 재미와 결말 도달 속도는 명세상 임시값 또는 인간 플레이테스트 항목이다. 자동화는 상태·도달성·결정론·접근성 계약을 검증하지만 재미나 최종 밸런스를 검증했다고 표현하지 않는다.
