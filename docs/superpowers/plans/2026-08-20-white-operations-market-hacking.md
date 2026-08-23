# 화이트 운영 화면·시장 색상·해킹 회귀 구현 계획

> 승인 명세: `docs/superpowers/specs/2026-08-20-target-lock-ranged-combat-white-operations-design.ko.md`

**목표:** 메인 운영 화면을 흰색/연회색 중심으로 재정리하고 실제 상단 헤더를 주황색으로 만든다. 컴팩트 시장 도넛의 중복 문구를 제거하고 참가자별 안정 색상을 적용한다. 감독관 메시지는 아이보리로 바꾸며, 자원 전투 캔버스와 해킹 트리는 기존 어두운 시각 영역으로 격리한다.

**구조:** 의미/상태는 React 컴포넌트가 제공하고, 최종 시각 우선순위는 가장 마지막에 로드되는 `retro-modern-remodel.css`의 `.game-shell` 범위 안에서 결정한다. 해킹 로직과 경제 수치는 변경하지 않고 회귀 테스트와 실제 브라우저 검사만 수행한다.

**기술:** React 19, CSS, Vitest, Testing Library, Playwright.

---

## 작업 1: 참가자 ID 기반 시장 색상 계약을 실패 테스트로 고정

**파일**

- 수정: `src/features/market/MarketPanel.test.tsx`

1. 컴팩트 시장에서 `.market-share-donut__center`와 `.market-compact-summary`가 렌더되지 않는다고 기대한다.
2. 컴팩트 범례에는 참가자 이름/점유율만 있고 상태 설명 문구는 없다고 기대한다.
3. 동일 참가자 ID는 입력 배열 순서가 달라도 동일 색을 받는다고 기대한다.
4. 다음 색 계약을 DOM style과 도넛 gradient 양쪽에서 검증한다.

```ts
player: '#ff6b3d'
meridian: '#16b8b0'
tallow: '#796cff'
fallback: ['#3f7cff', '#ec5f9a', '#31a66a']
```

5. 범례의 색상 표식 패턴/기호가 유지되어 색각 보조 정보를 잃지 않는다고 검증한다.
6. 상세 시장에서는 기존 헤더/상태 정보가 남는다고 검증한다.
7. 실행: `pnpm exec vitest run src/features/market/MarketPanel.test.tsx` 후 신규 기대 때문에 실패하는지 확인한다.

## 작업 2: 시장 컴포넌트의 중복 문구와 순서 의존 색상을 제거

**파일**

- 수정: `src/features/market/MarketPanel.tsx`

1. 배열 인덱스 기반 `MARKET_COLORS`를 `marketColorForParticipant(id, fallbackIndex)` 함수로 교체한다.
2. 플레이어/meridian/tallow는 고정 색을 받고, 나머지는 안정된 ID 해시를 이용해 fallback 색 중 하나를 받도록 한다.
3. `MarketChartEntry`에 계산된 `color`를 포함시켜 도넛, 마커, 이름이 같은 값을 사용하게 한다.
4. `MarketShareDonut`은 시각적 중앙 문구 없이 구멍을 CSS pseudo-element로만 만든다. `role="img"`과 전체 참가자 점유율을 설명하는 `aria-label`은 유지한다.
5. `MarketShareLegend`에 `compact` 플래그를 추가해 컴팩트 모드에서 상태 `<small>`만 생략한다.
6. 컴팩트 분기의 `market-compact-summary`를 삭제한다.
7. 작업 1 테스트를 다시 실행해 통과시킨다.

## 작업 3: 화이트/연회색/주황 시각 토큰을 회귀 테스트로 고정

**파일**

- 수정: `src/styles/styleBoundaries.test.ts`
- 수정: `e2e/modern-sf.spec.ts`

1. 정적 CSS 경계 테스트에 다음을 추가한다.
   - `.game-shell`과 주 운영 패널은 흰색/연회색 배경을 사용한다.
   - `.control-bar` 실제 면은 주황색이다.
   - 컴팩트 시장은 연회색이며 도넛은 약 148px다.
   - `.supervisor-message-popup`은 아이보리 배경이다.
   - `.resource-panel`, `.intrusion-grid-frame`, `.hacking-panel`은 어두운 배경을 유지한다.
2. 실제 브라우저 테스트에서 계산 스타일을 확인한다.
   - 운영 패널 배경 RGB가 각 채널 238 이상인 밝은 톤이다.
   - 헤더는 주황 계열(R이 G와 B보다 충분히 높음)이다.
   - 감독관 팝업은 아이보리 계열이다.
   - 자원 캔버스와 해킹 패널은 RGB 각 채널 45 미만의 어두운 톤이다.
3. 컴팩트 도넛 직경이 140~154px이고 왼쪽 레일을 넘지 않는다고 검증한다.
4. 1280×720, 1366×650, 1440×900에서 주 작업 영역/도넛/오른쪽 도크가 겹치지 않는다고 검증한다.
5. 실행: `pnpm exec vitest run src/styles/styleBoundaries.test.ts`와 `pnpm exec playwright test e2e/modern-sf.spec.ts --project=chromium`; 새 기대의 RED를 확인한다.

## 작업 4: 최종 로드 CSS에서 시각 체계를 적용

**파일**

- 수정: `src/styles/retro-modern-remodel.css`

1. `.game-shell` 배경과 패널 배경을 `#ffffff`, `#f5f6f7`, 경계를 `#d7d9dc` 계열로 바꾼다. 베이지/아이보리는 주 운영 화면에서 제거한다.
2. `.control-bar`의 실제 배경을 `#ff6b3d` 중심 주황으로 바꾸고 텍스트 대비를 확보한다.
3. `.review-panel > .market-watch--compact`를 `#eceef0` 연회색으로 바꾸고 레이아웃을 도넛→범례 세로 흐름으로 정리한다.
4. 컴팩트 도넛을 148×148px로 키우고 중앙 구멍은 배경색만 보이게 한다. 상세 도넛 크기는 별도로 유지한다.
5. 범례 이름/마커가 React에서 전달한 `--market-color`를 사용하게 하고 숫자는 중립색으로 유지한다.
6. `.supervisor-message-popup`만 아이보리 `#f3ead7` 계열로 덮어쓴다.
7. 보드의 제거된 헤더/푸터 높이를 없애고 `.intrusion-grid-frame`이 `min-height: 0; height: 100%`로 가용 공간을 사용하게 한다. 체력 오버레이는 우상단 절대 배치한다.
8. `.resource-panel`, `.intrusion-grid-frame`, `.hacking-panel`, 해킹 노드/인스펙터에 명시적인 어두운 배경을 마지막 규칙으로 재확인해 화이트 토큰의 누수를 막는다.
9. 작업 3 테스트를 재실행해 통과시킨다.

## 작업 5: 해킹 트리와 핵심 게임 흐름 회귀 감사

**파일**

- 필요할 때만 수정: `src/features/hacking/HackingPanel.test.tsx`
- 필요할 때만 수정: `src/features/hacking/HackingPanel.tsx`
- 필요할 때만 수정: `src/features/hacking/HackNodePath.tsx`
- 필요할 때만 수정: `src/features/hacking/HackNodeInspector.tsx`
- 수정: `e2e/modern-sf.spec.ts`
- 수정: `e2e/game.spec.ts`

1. 기존 해킹 단위 테스트를 실행한다: `pnpm exec vitest run src/features/hacking/HackingPanel.test.tsx src/game/hacking.test.ts`.
2. 실제 브라우저에서 모든 노드/연결선이 패널 경계 안에 있고, 선택/잠금/구매 가능 상태가 식별되며, 스크롤 없이 핵심 트리가 보이는지 확인한다.
3. 기존 구매, 충전, 일정 진행, 튜토리얼, 저장/복구 E2E 시나리오를 실행한다. 실패하면 이번 변경이 만든 회귀인지 먼저 분리한다.
4. 해킹 동작/경제/콘텐츠는 테스트가 실제 회귀를 증명할 때만 최소 수정한다. 단순 미관 선호로 로직을 변경하지 않는다.

## 작업 6: 전체 제품 검증과 시각 증거

1. 실행: `pnpm typecheck`
2. 실행: `pnpm lint`
3. 실행: `pnpm test:run`
4. 실행: `pnpm build`
5. 실행: `pnpm test:e2e`
6. 1440×900에서 자원 화면과 해킹 화면 스크린샷을 새로 캡처해 다음을 육안 확인한다.
   - 작아진 자원/플레이어/적과 넓어진 전장 인상
   - 보라색 원형 적과 직선 탄환
   - 흰색 운영 화면, 주황 상단 헤더, 연회색 도넛 영역, 아이보리 메시지
   - 해킹 트리의 어두운 격리와 노드 가독성
7. 실패가 하나라도 있으면 완료로 보고하지 않고 원인 테스트로 돌아가 수정 후 1~6을 반복한다.

