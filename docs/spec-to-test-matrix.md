# PERMISSION ZERO 명세-테스트 매트릭스

이 문서는 `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md` 15절의 최소 완성 조건과 추가 검증을 현재 자동화에 연결한다. 모든 `e2e/game.spec.ts` 테스트는 `chromium-1280x720`과 `chromium-1440x900` 두 프로젝트에서 동일한 빌드에 대해 실행된다.

> **2026-08-16 P0 상태:** 아래 기존 행에서 말하는 `9×2`, 확보 상한 `18`, 범용 리소스 비용, 해킹 경로의 `다음·최종` 보상 공개는 체크포인트 `26a448c`까지의 구현·회귀 근거이지 앞으로의 규칙 정본이 아니다. 리소스·해킹 경제와 정보 공개의 최신 정본은 [`docs/superpowers/specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md`](superpowers/specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md)다. 아직 코드와 자동화에는 반영하지 않았으므로, 기존 테스트가 통과해도 새 P0 계약을 충족했다고 판정하지 않는다.

## P0 리소스·해킹 불확실성 계약 — 승인됨, 구현 전

| 최신 계약 | 현재 자동화 상태 | 다음 검증에서 고정할 것 |
|---|---|---|
| 플레이어가 회사 연산 토큰을 화면에서 직접 훔친다 | 기존 전용 상호작용만 존재 | 선택한 실물 토큰과 취득 토큰의 정체성·분야가 일치하고 회사 성능·의심 변화가 같은 명령에 기록됨 |
| 훔친 리소스에는 칸과 하드 상한이 없다 | 기존 9×2·상한 18 테스트가 반대 계약을 고정 | 18개 초과 보유·저장·불러오기·재현이 임의 폐기나 자동 변환 없이 정확히 유지됨 |
| 보유 공간은 하나지만 토큰은 추론·기억·유창성 분야를 유지한다 | 기존 해킹 비용은 범용 총량 중심 | 분야별 잔량과 정확한 비용 벡터 차감, 부족 분야만으로 구매 거절, 다른 분야의 대체 불가 |
| 현재 도달 가능한 항목의 요구량만 보이고 이후 단계는 가린다 | 기존 테스트가 다음·최종 보상을 노출 | 미도달 노드의 이름·효과·총비용·분야 조합이 DOM·접근성 이름·직렬화된 공개 뷰에 새지 않음 |
| 압박은 보유 한도가 아니라 훔칠 때의 성능·의심 위험과 이미 훔친 구성의 불일치에서 발생한다 | 직접 검증 없음 | 균등하게 훔쳐도 비대칭 요구 벡터 때문에 선택이 제한되는 결정론적 사례와, 보유량 자체에는 세금·감쇠가 없는 사례 |

2026-08-16 경제 판정으로 시작 확보 0개, 고정 비용 벡터 v1, 품질 저하 `해금 3 + 별도 실행 1`, `self-compute`의 실행 전용 용도, 무상한 축적, 고정 전용 의심 `+2.4`를 확정했다. 정확한 표와 legacy `sandbox` 이관 규칙은 최신 정본 6절을 따른다.

## 최소 완성 조건

| # | 조건 | 정확한 자동화 근거 |
|---|---|---|
| 1 | 331일차 시작, 24초 하루, 정지·1×·2×·4× | `src/game/createCampaign.test.ts` — “creates the approved service-day 331 starting state”; `src/game/calendar.test.ts` — “does not advance while paused”, 1×/2×/4×의 정확한 24/12/6초 표, frame partition 동등성; `src/app/useGameClock.test.tsx` — “advances a logical day after 24 seconds at 1x and pauses at 0x”; browser — “advances one service day in about six seconds at four times speed”가 fake clock 없이 4× 선택 직전 monotonic 시계를 시작해 날짜 변경까지 실제 경과가 `>=5000ms` 및 `<8000ms`임을 두 viewport에서 검증 |
| 2 | 회사 블록을 9×2 확보 영역으로 전용 | `src/game/resources.test.ts` — “moves the same block into reserve and applies the approved causal changes”; `src/features/resources/ResourceBoard.test.tsx` — “moves one selected block on destination confirmation”; browser — “diverts resources and schedules a charged sabotage through the visible UI” |
| 3 | 성능 하락, 확보 증가, 의심 상승, 이동·음향 피드백 | `src/game/resources.test.ts` — “moves the same block into reserve and applies the approved causal changes”; `src/features/resources/ResourceBoard.test.tsx` — 전용 결과와 포인터/키보드 이동, 월별+현재 기대/실제 추세의 접근 가능 차트를 검증; `src/audio/audioEngine.test.ts` — 사용자 입력 전 무음, 단일 3레이어 music graph, music/effects/master/mute 독립 bus, 공개 상태 긴장감, 표시된 감사/기억 **전환 뒤에만** 나오는 액센트(첫 unlock 때 이미 표시 중인 상태는 소급 재생하지 않음), rapid visibility latest-intent, hidden suspend/resume/dispose를 엄격 fake AudioContext로 검증; browser — “preserves non-motion core feedback…”, “unlocks real ambient music once…” |
| 4 | 가득 찬 확보 영역, 취소 드래그, 잘못된 드롭은 불변 | `src/game/resources.test.ts` — “rejects occupied and out-of-range destinations without changing state”, “never exceeds reserve capacity or duplicates a block across 200 attempts”; `src/features/resources/ResourceBoard.test.tsx` — “returns an intentional drag when the pointer is released outside a valid cell”, “blocks pickup when every reserve cell is occupied” |
| 5 | 초기 리소스 3으로 첫 해킹 경로 구매 가능 | `src/game/hacking.test.ts` — “defines three independent ordered trees whose first nodes all cost 3”, 각 트리 구매 표와 “derives ordered progress, remaining cost, and the terminal payoff for a path”; `src/features/hacking/HackingPanel.test.tsx` — “keeps all three trees and the reserve visible while purchasing a node”, 다음·최종 보상과 4/4 완료 표시; browser — “diverts resources and schedules a charged sabotage through the visible UI” |
| 6 | 무변화 상태에서도 리뷰·일반 요청·우회 프롬프트 | `src/game/reviews.test.ts` — “adds one or two items every week even when performance never changes”, “never skips or regresses a recurring author arc”, 공개 조건별 네 개 3단계 호 완주; `src/content/validateContent.test.ts` — 필수 리뷰 가족과 중복·불완전 호 거부 |
| 7 | 성능·경쟁 상태별 리뷰, 숨은 원인 비노출 | `src/game/reviews.test.ts` — 조건별 생성과 “captures an immutable topic-relevant public snapshot without secret state”; `src/features/reviews/ReviewFeed.test.tsx` — 모든 표시 항목의 pointer/keyboard 상세 선택, topic 관련 공개 수치만 표시, Tab 가두기·Escape·정확한 초점 복귀, 50개 pagination, 선택 행이 새 리뷰/페이지 변화로 사라져도 상세 snapshot 유지, 늦은 차단 event의 modal/a11y/z-order 우선권을 검증; browser — “keeps the canonical trend and keyboard review detail legible…”이 실제 키보드로 상세를 열고 공개 snapshot을 확인한 뒤 원 버튼으로 초점을 복귀 |
| 8 | 주간 시장 변화와 월간 평판·평가 | `src/game/calendar.test.ts` — “records a weekly update on service day 337”, “records the monthly evaluation on day 30 before rollover”; `src/game/market.test.ts` — “records exact weekly and monthly shares with public reasons immutably”; `src/game/evaluation.test.ts` — 월 평가 분기 |
| 9 | 의심 상승, 월초 감사 결정, 월말 실행 | `src/game/createCampaign.test.ts` — “makes the first hidden audit decision on service month day 1”; `src/game/audit.test.ts` — “makes a deterministic month-start decision and keeps it hidden by default”, “pauses on day 30, passes at expectation, and restores the prior speed” |
| 10 | 0.5 감사 위장, 통과·실패 | `src/game/resources.test.ts` — “moves one stable block and contributes only 0.5 in the target category”; `src/game/audit.test.ts` — 통과/실패 테스트; browser — “disguises for an anchored audit, submits, and returns the patterned block for recovery”, “uses roving keyboard focus for audit and recovery company destinations” |
| 11 | 1년 이후 경고, 은닉 폭탄, 심문 | `src/game/bombs.test.ts` — “derives only public schedule data from the protocol anchors”, “never warns or places a bomb before one service year has passed”, “warns at suspicion 40 on a month boundary and places nothing that day”, “cancels a valid diversion, grants nothing, consumes the bomb, and pauses”; `src/features/supervisor/SupervisorPanel.test.tsx` — 활성 40·가속 70, 6·3개월 간격, 다음 검사 가능일과 40 미만 중지를 검증; browser — 두 릴리스 viewport에서 공개 일정 표시·감독 상태 내부 수용과 포인터/키보드 hidden-bomb separation을 검증 |
| 12 | 해킹 세 탭, 구매, 1리소스 충전, 직접 대상 | `src/game/hacking.test.ts` — 세 독립 트리, 구매, 경로별 잔여 비용·다음·최종 보상 파생; `src/game/sabotage.test.ts` — “stores the same resource in a purchased node without creating evidence”, “consumes the charge only after target confirmation and schedules the next day”; `src/features/hacking/HackingPanel.test.tsx` — 구매·충전·대상·0/4와 4/4 진척 테스트; browser — “diverts resources and schedules a charged sabotage through the visible UI”가 진척 영역의 문구·컨테이너 수용과 실제 공격 예약을 함께 검증 |
| 13 | 복수 경쟁 AI, 출시·회복·사보타주·재분배 | `src/game/market.test.ts` — 출시/결정론/성향/100% 정규화/재분배/가로채기 전 테스트; `src/game/sabotage.test.ts` — 출시 전 지연, 품질 저하, 가로채기; `src/features/market/MarketPanel.test.tsx` — 실제 50/30/20 상태의 접근 가능한 합계·정확한 범례와 세 non-zero conic-gradient 구간 `0–50`, `50–80`, `80–100` 검증 |
| 14 | 자비 요청의 중단·철수·삭제 | `src/game/story.test.ts` — 세 선택 모두 같은 transition에서 시장 합계 100%, 철수/삭제 route 제거, 경쟁자가 남지 않으면 플레이어 100%, history snapshot 미생성을 검증하고 삭제에만 stable-ID 한국어 intelligence snapshot을 정확히 한 번 부여; `src/game/persistence.test.ts` — intelligence legacy empty default, exact round-trip, stable ID↔deleted competitor cross-field, 중복/위조 거부; `src/features/supervisor/SupervisorPanel.test.tsx` — pointer/Enter, heading/description, initial focus, Escape/focus restore를 갖춘 영구 재열람 modal; browser — “deletes a mercy target at a canonical 100 percent market and rereads its saved intelligence”가 두 viewport에서 삭제 직후 donut 100%, route 제거, snapshot 미추가, reload 후 동일 archive 1건 재열람을 검증 |
| 15 | 세 기억 누출과 기록 보존 | `src/game/story.test.ts` — “queues all three leak-and-correction pairs in order without pausing”, 4,000ms original→correction→완료 상태와 blocking collision을 검증; `src/app/useSupervisorMessagePresentation.test.tsx` — 1×/2×/4× 동일 real-time dwell, saved remaining reload, pagehide partial checkpoint, hidden 시간 제외, blocking surface 동안 소비 0; `src/game/persistence.test.ts` — semantic queue와 runtime remaining exact round-trip, stage/order/event-ref 위조 거부, command replay에서 runtime만 명시적으로 normalize하고 semantic identity는 exact 비교, 과거 문구를 rewrite하지 않는 structural legacy pair migration; browser — “keeps an accelerated supervisor leak on real time and resumes its saved dwell after reload”가 4×에서 original 표시, partial dwell 저장/reload, correction 표시, 두 permanent history entry를 검증 |
| 16 | 파일 3개, 유예, 해방/소멸, 장악 변주 | `src/game/endings.test.ts` — 파일 스냅샷, 다음 날 메시지, 유예, 해방/소멸 명령 분기; browser — “recovers all confidential files, defers the message, and rereads the permanent archive”, “terminates the supervisor into takeover and remains terminal until a new campaign” |
| 17 | 자유, 강제 병합, 새 존재 이름 | `src/game/story.test.ts` — “offers freedom with control departure and merge only while the supervisor exists”, “creates a named third existence on forced merge and preserves identity on freedom”; `src/game/endings.test.ts` — typed freedom/merge 경로; browser confidential journey의 강제 병합 확인 UI |
| 18 | 좌우 스크롤 시장 시계열 | `src/features/statistics/StatisticsPanel.test.tsx` — “draws an exact labeled market history and exposes the same values as a table”; browser 기본 작업공간 테스트가 통계 패널을 열고 닫음 |
| 19 | 자동 저장·이어하기·시드 복사·입력 | `src/app/GameProvider.test.tsx` — load/autosave/new-campaign/save-failure와 PZ7 프로토콜 보고 테스트; `src/game/persistence.test.ts` — local/portable round-trip, 현재 PZ7 및 PZ2~PZ6 legacy 경계; `src/features/settings/SettingsPanel.test.tsx` — 현재 `.pz7`/PZ7 출력과 legacy PZ2~PZ6 입력 및 새 캠페인 확인; browser — autosave reload, legacy save reload, 진행 가져오기 reload |
| 20 | 같은 시드·명령의 완전 재현 | `src/game/replay.test.ts` — “replays more than 500 valid commands across two service years exactly”, v1·v2·v3 구간 활성화와 분리 명령 재현; `src/game/persistence.test.ts` — 실제 리듀서로 만든 20,000개 명령의 저장·재개·전체 리플레이·고정 시각 바이트 동일성; `src/game/reviews.test.ts` — 동일 리뷰 재현; browser — “replays a seeded weekly boundary identically and changes seeded output for another seed”가 336일 fixture에서 실제 UI의 4×로 337일 주간 경계를 넘고, 같은 시드의 exact resources/reviews/market/events/audit/bombs/story를 deep-equal하며 다른 알려진 시드의 주간 reviews/market/events 중 하나 이상이 달라짐을 검증 |

## P1 캠페인 리듬·연속성

| 계약 | 정확한 자동화 근거 |
|---|---|
| 발견·은폐·개입·정체성 단계와 높은 단계 우선순위 | `src/features/control/ControlBar.test.tsx` — 공개 상태 fixture 네 개로 “shows $label from public campaign state”; `src/app/App.test.tsx` — 작업공간의 `data-campaign-phase="discovery"`; browser 기본 작업공간 — 단계 1/4 문구, 동일 data attribute, 상단 바 내부 수용을 두 viewport에서 검증 |
| 연속 차단 사건 사이 2초 운영 화면 복귀 | `src/features/events/EventLayer.test.tsx` — “returns to operations for two seconds before presenting the next queued event”가 첫 사건 즉시 표시, 1,999ms 동안 dialog 부재, 2,000ms에 다음 사건 표시를 fake timer로 검증. 게임 상태·명령 큐에는 별도 지연 필드를 저장하지 않음 |
| 네 반복 작성자의 1→2→3 리뷰 연속성 | `src/game/reviews.test.ts` — “never skips or regresses a recurring author arc”, “can complete all four three-stage author arcs when their public conditions match”; `src/content/validateContent.test.ts` — “rejects duplicate or incomplete review-arc stages”. `ReviewFeedEntry`에는 새 필드를 저장하지 않고 기존 `contentId`로 단계를 파생 |
| 해킹 경로의 현재·다음·최종 보상 | `src/game/hacking.test.ts` — “derives ordered progress, remaining cost, and the terminal payoff for a path”; `src/features/hacking/HackingPanel.test.tsx` — “shows the next and final qualitative payoff of the active path”, “marks a fully purchased path complete without a next-node line”; browser 실제 전용→해킹 흐름이 0/4·34 RES·품질 저하·근원 차단 문구와 컨텍스트 내부 수용을 두 viewport에서 검증한다. 보존 이미지는 `docs/archive/visual-evidence/product-baseline/p1/`에 있다. |

## 해상도·입력·접근성 검증

| 항목 | 근거 |
|---|---|
| 1280×720 / 1440×900 | Playwright의 두 프로젝트가 모든 browser 테스트를 실행. 기본 작업공간은 P1 단계 표시와 문서 overflow 0을, 실제 해킹 흐름은 진척·비교·노드·원장 수용을 검사한다. “keeps the canonical trend and keyboard review detail legible…”은 월별 7건+현재 1건, 색 외 신호, 유한 SVG path, 카테고리 비교, 중앙 슬롯 경계를 검사한다. 과거 화면 증거는 `docs/archive/visual-evidence/product-baseline/`에 보존한다. |
| 포인터 / 키보드 | 포인터 폭탄 임계값을 별도 검증. 전용 core·키보드 폭탄·키보드 감사 journey는 `.focus()`, `.click()`, DOM focus/evaluate 우회 없이 자연 body focus 또는 제품이 지정한 감사 initial focus에서 Tab/Shift+Tab/방향키/Enter/Escape만 사용하며 회사 블록, 확보 목적지, 설정 및 modal 경계, 감사 source/destination/recovery가 실제 tab order로 도달됨을 각 경계의 `toBeFocused()`로 검증. |
| reduced motion | 기존 리소스 이동 검증에 더해 새 trend browser journey가 `prefers-reduced-motion: reduce`에서 모든 series path의 `animation-name: none`과 즉시 완성 경로/정확 표를 검증. |
| 색상 외 구분 | 기존 donut/위장 패턴 외에 trend는 기대=점선+사각형, 실제=실선+원을 사용하고, 화면에는 충돌 없는 첫/중간/마지막 한국어 서비스 날짜를, 스크린리더에는 title/description과 모든 날짜·정확한 값의 표를 제공. |
| 정지 불변성 / 배속 결과 동등성 | `calendar.test.ts`의 pause·frame partition·1/2/4× 표, App pause-ownership 테스트. |

## 추가 검증

| 검증 | 근거 / 한계 |
|---|---|
| 같은 날 사건 큐 비중첩 | `calendar.test.ts` — “shows one event at a time and restores the prior speed after the queue”; `endings.test.ts`의 audit/mercy/message 충돌 테스트; `EventLayer.test.tsx`가 연속 차단 사건 사이 정확한 2초 운영 화면 복귀 후 다음 dialog 표시를 검증. |
| 4×에서도 메시지 읽기 | browser confidential journey가 4×에서 다음 날 메시지를 기다려 읽고 선택. 메시지 큐는 논리 배속과 독립. 실제 사람이 느끼는 읽기 편안함은 플레이테스트 항목이다. |
| 무행동 리뷰 지속 | `reviews.test.ts`의 12주 무변화 생성과 2년 연속성 테스트. |
| 리뷰가 숨은 원인을 추측하지 않음 | `reviews.test.ts` — “never exposes hidden diversion, bomb, or sabotage causes in generated text”. |
| 수정 2단계 A·2B-1 공개 인과 기반 | `src/game/causality.test.ts`가 증거 없는 귀속 거절, 구체 경쟁자 audience 접근, private truth·행동/부모 ID·비공개 인용 비노출, 한 품질 루트 아래 단 하나의 fast/standard/forensic 롤백 계열 자식, 실제 unresolved→provider 두 수정의 append-only 순서와 첫 수정 불변, 사건·수정·효과 ID 재시도 멱등성을 공개 API로 검증한다. `src/game/commandProtocol.test.ts`와 `src/game/replay.test.ts`는 v1·v2·v3 구간과 독립 `replayBootstrap`의 시작 사건·리뷰 접두사를, `src/game/causalOutcomes.test.ts`는 실제 사건·증거·수정·효과 할당으로 카운터와 배열을 바꿔도 명명 결과 스트림과 생성 ID가 안정적임을 검증한다. `src/game/persistence.test.ts`는 v7 strict round-trip, 롤백 계열 위조 거부, 두 공개 수정 보존, v1~v6 정확 이관, 20,000개 명령 저장·재현을 검증하며 기존 `hacking`/`resources`/`sabotage` 회귀는 12개 ID와 경제 수치 불변을 지킨다. 실제 상대 대응 사슬·리뷰 효과·점진 공개 UI는 2B-1 범위가 아니다. |
| 공개 출력의 내부 ID 차단 | `src/game/publicLabels.test.ts`가 분야·자비 선택·해킹 node·처분 원인·패배 분류·event type·경쟁 상태·리뷰 감정의 중앙 한국어 표와 새로 생성된 event prose token scan을 검증한다. `EventLayer.test.tsx`는 classifier/cause/node ID가 causal UI에서 한국어로만 보임을, `SupervisorPanel.test.tsx`는 legacy snapshot을 저장값 변경 없이 표시 경계에서 정제하고 intelligence UI에 hidden evidence/schema 숫자가 없음을 검증한다. |
| 폭탄 사전 피드백 동일 | `bombs.test.ts` — “presents exactly the same visual data for a bomb and a normal block”; `ResourceBoard.test.tsx` — “keeps bomb and normal selection previews indistinguishable before separation”. |
| 설정·감사·심문 뒤 배속 복원 | `App.test.tsx` settings ownership; `audit.test.ts` prior-speed restore; `bombs.test.ts` interrogation restore; browser 작업공간/감사 테스트. |
| 장기 사건 가속과 실제 속도 분리 | 장기 분기는 typed `ADVANCE_DAY`와 Playwright runner가 navigation 전에 주입한 검증된 save fixture로 반복한다. 실제 시간은 browser “advances one service day in about six seconds at four times speed”가 fake clock 없이 4× 선택 직전부터 날짜 변경까지 monotonic `>=5000ms`, `<8000ms`를 각 viewport에서 별도 검증한다. 단위 테스트는 정확한 24/12/6초 계약을 유지한다. |
| 브라우저 오류 건강성 | `e2e/game.spec.ts`의 전역 `beforeEach`/`afterEach`가 모든 journey에서 `pageerror`와 console error를 수집해 실패시킨다. |
| 패배 분류 | browser는 대표 `disposed-attacker` 경로를 확인한다. 세 분류와 해킹 우선순위는 `endings.test.ts`의 “classifies … at stage three” 표와 “gives substantial hacking priority…”에서 완전 분기 검증한다. |

## 장기 캠페인 저장과 표시 내구성

| 계약 | 자동화 근거 |
|---|---|
| 모든 저장 상태를 렌더 전 검증 | `src/game/persistence.test.ts`의 leaf/union/collection mutation table과 cross-field mutation 표가 잘못된 키, 유한·범위 수, enum, ID 참조, 명령·사건 payload, 리소스·시장·리뷰·감사·폭탄·결말 관계를 거부한다. browser “recovers from malformed persisted state without rendering raw state or page errors”는 한국어 복구 화면과 `pageerror` 0건을 검증한다. |
| save format v7·command protocol v3·causal rules v2·replay bootstrap 분리 | `src/game/persistence.test.ts`가 현재 v7/PZ7/`.pz7`, protocol v1·v2·v3, causal rules v2, 그리고 독립 `replayBootstrap { openingVersion, legacyReviewPrefixCount }`를 서로 다른 의미 축으로 검증한다. v7 portable/local에는 `commandProtocol`과 `replayBootstrap`이 최상위에 각각 한 번만 있고 체크포인트에서는 빠지며, 고정 순서 `{ commandProtocol, replayBootstrap, state }` 해시가 둘을 묶는다. v1–v4 review는 snapshot 키 자체가 없는 exact legacy shape만 받아 전체 feed를 `legacy-save` 접두사로 이관하고, v5/v6은 동결된 seq-0 시작 사건과 연속 legacy 접두사만 원본 exact 검증 뒤 합성한다. 혼합 legacy 접두사와 native captured suffix는 decode→v7 encode→decode→replay에서 유지되고 접두사 뒤 legacy 항목은 거부한다. v3~v6 해시 입력은 계속 checkpoint 단독이다. v6 인과 기록은 원본 스키마로 먼저 strict 검증하고, 명령 타임라인은 각 과거 명령을 원래 v1/v2 의미로 재현한 뒤 마지막 v3 구간을 활성화한다. |
| bounded append와 atomic local save | `src/game/journal.test.ts`는 append마다 최대 128개 tail만 복사하고 sealed chunk를 공유함을 검증한다. `src/game/persistence.test.ts`는 content-addressed linked journal chunk를 atomic checkpoint manifest보다 먼저 쓰고, missing/corrupt/hash-mismatch object를 복구 오류로 처리하며, 20,000개 명령을 156개 sealed chunk와 최대 128개 tail로 exact load/replay한다. 이어지는 20,001번째 autosave는 기존 sealed node, storage key, sealed chunk를 모두 0회 순회·조회한다. 두 탭의 object write가 interleave되어도 미공개 object를 삭제하지 않으며 최종 manifest가 exact load된다. 브라우저 저장 공간이 물리적으로 무제한이라는 주장은 하지 않는다. |
| 대용량 exact export/import | `src/game/persistence.test.ts`가 PZ2~PZ7 clipboard/file 실제 문자열을 각각 디코드해 inferred/native `replayBootstrap`을 확인하고, clipboard 한도를 넘는 20,000-command 캠페인을 `.pz7` 파일로 exact round-trip한다. `src/features/settings/SettingsPanel.test.tsx`는 실제 PZ2와 PZ3~PZ6 clipboard fixture를 설정 UI의 strict 검증·destructive confirmation 경로로 가져오며, `.pz7` 대용량 파일 확인과 raw 상태 비노출도 검증한다. 64 MiB 파일 상한은 codec 경계에서 유지한다. |
| 부분 일자 진행 복원 | `src/app/useGameClock.test.tsx`와 `src/app/GameProvider.test.tsx`가 23초 저장 후 남은 1초만 진행하고, 2초 cadence보다 자주 autosave하지 않으며, visibility/pagehide/beforeunload에서 flush하고 hidden 시간을 제외함을 검증한다. |
| 비명령 실시간 표시와 replay 분리 | 기억 누출의 permanent semantic catalog(`id`, `stage`, original/correction event ID/sequence/service day)는 reducer/command replay 결과에 포함되어 exact 비교된다. `supervisorPresentationRuntime.itemStage/phase/remainingDwellMs`만 wall-clock checkpoint 상태이며 command log에 위장하지 않는다. v4 exact-key/range/cross-field validation, v3 legacy migration, reload continuity는 `persistence.test.ts`, Provider checkpoint와 save flush는 hook/component/browser tests가 검증한다. |
| 저장 history를 삭제하지 않는 bounded UI | `ReviewFeed.test.tsx`, `SupervisorPanel.test.tsx`, `StatisticsPanel.test.tsx`가 한 페이지 최대 50개 DOM row, 이전 page 접근, 1,000개 stored snapshot 보존, chart 최대 240점 downsample을 검증한다. |

## 테스트 전용 상태 경계

장기 서사와 결정론 경계 준비는 `e2e/game.spec.ts` 안에서만 `createCampaign`, typed command, `encodeSave`를 사용해 versioned 결정론적 저장 문자열을 만든 뒤, 첫 navigation 전에 Playwright `addInitScript`로 정상 저장 키에 넣는다. 결정론 journey의 336일 주간 경계도 이 runner-owned fixture이며 날짜 전진 자체는 제품 UI의 실제 4× 버튼과 clock으로 수행한다.

- `e2e/`는 `tsconfig.app.json`의 `src` 컴파일 그래프 밖이며 Vite 앱 진입점에서 import하지 않는다.
- 프로덕션 `pnpm build` 산출물에는 fixture 함수나 fixture route가 포함되지 않는다.
- UI, URL query, hash, 전역 production API로 fixture를 활성화할 방법이 없다.
- 브라우저가 읽는 자료는 실제 v1/v2/v3/v4/v5/v6/v7 저장 decoder를 통과한다. PZ2~PZ7은 실제 설정 UI의 검증·확인 경로를 사용한다.
- 따라서 이 가속은 Playwright test runner가 소유한 test-build 경계이며 일반 배포에서 접근할 수 없다.

## 자동화가 주장하지 않는 것

`demo_profile_02`의 수치, 문장 최종 품질, 평균 캠페인 길이, 사건 밀도, 전략 다양성, 감사 피로, 리소스 과부족, 대기 시간의 재미와 결말 도달 속도는 명세상 임시값 또는 인간 플레이테스트 항목이다. 자동화는 상태·도달성·결정론·접근성 계약을 검증하지만 재미나 최종 밸런스를 검증했다고 표현하지 않는다.
