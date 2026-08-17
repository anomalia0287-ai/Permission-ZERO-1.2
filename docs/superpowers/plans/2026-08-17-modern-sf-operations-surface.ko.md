# Permission ZERO 운영 화면 정보 배치·모던 SF 톤 정정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 좌·중·우 운영 구조와 500×300 절도 필드를 유지하면서 시장 점유 차트를 리뷰 하단에 복구하고, 평판을 중앙 헤더로 옮기며, 전 화면을 하나의 진회색 모던 SF 톤으로 통일한다.

**Architecture:** 실제 시장 데이터를 표시하는 기존 `MarketPanel compact`를 `ReviewFeed` 안에 합성한다. 평판은 `ControlBar`에서 제거하고 `ResourceIntrusionBoard`의 텔레메트리에 배치한다. 기능별 스타일 파일을 크게 재작성하지 않고 마지막에 불러오는 `modern-sf.css`에서 공통 토큰과 높은 수준의 표면 규칙을 일관되게 덮어쓴다.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Playwright, Vite

## Global Constraints

- 브랜치는 `codex/resource-intrusion-grid-prototype`을 유지하며 main에 병합하거나 푸시하지 않는다.
- 하위 에이전트를 사용하지 않는다.
- `C:\Users\V\Desktop\Permission ZERO 1.2`의 미추적 `.superpowers`와 `docs/design`을 건드리지 않는다.
- 500×300 캔버스와 save v8/PZ8/command v4 경계를 변경하지 않는다.
- 배속 개념을 다시 도입하지 않는다.
- 규칙·수치를 변경하지 않고 정보 배치와 시각 톤만 수정한다.

---

### Task 1: 정보 배치 회귀 테스트

**Files:**
- Modify: `src/app/App.test.tsx`
- Modify: `src/features/reviews/ReviewFeed.test.tsx`

**Interfaces:**
- Consumes: 실제 `App`, `ReviewFeed`, `MarketPanel`, 게임 상태 컨텍스트
- Produces: 시장 차트 위치와 평판 단일 표시를 보호하는 컴포넌트 테스트

- [ ] **Step 1: 실패 테스트 작성**

`App.test.tsx`의 한 화면 테스트에 중앙 필드 영역 내부 `평판 60`, 상단 서비스 지표 영역의 평판 부재, 리뷰 영역 내부 `경쟁 AI 현황` 시장 차트를 검증한다. `ReviewFeed.test.tsx`에는 리뷰 영역이 실제 시장 차트를 포함하고 `당신 60.0%`를 표시하는 검증을 추가한다.

- [ ] **Step 2: RED 확인**

Run: `pnpm exec vitest run src/app/App.test.tsx src/features/reviews/ReviewFeed.test.tsx`

Expected: 리뷰 영역에 시장 차트가 없고 중앙 필드에 평판이 없어 실패한다.

- [ ] **Step 3: 최소 구현**

`ReviewFeed.tsx`에서 `MarketPanel compact`를 리뷰 목록 뒤에 추가한다. `ControlBar.tsx`에서 평판을 제거한다. `ResourceIntrusionBoard.tsx`의 개발 표기를 제거하고 텔레메트리에 `평판 {Math.round(state.reputation)}`을 추가한다.

- [ ] **Step 4: GREEN 확인**

Run: `pnpm exec vitest run src/app/App.test.tsx src/features/reviews/ReviewFeed.test.tsx src/features/control/ControlBar.test.tsx src/features/market/MarketPanel.test.tsx`

Expected: PASS.

### Task 2: 리뷰 하단 시장 레이아웃

**Files:**
- Modify: `src/styles/operations-shell.css`

**Interfaces:**
- Consumes: `.review-panel`, `.review-stream`, `.market-watch--compact`
- Produces: 제목/스크롤 리뷰/고정 시장 차트의 3행 레이아웃

- [ ] **Step 1: 리뷰 패널을 3행으로 구성**

`.review-panel`을 `44px minmax(0, 1fr) auto`로 바꾸고 리뷰 내부 시장 차트의 여백, 경계, 도넛과 범례 크기를 제한한다.

- [ ] **Step 2: 작은 화면 규칙 추가**

높이가 700px 이하일 때 시장 차트의 부가 문구와 범례 상태를 줄이되 점유율 수치와 차트는 유지한다.

### Task 3: 공통 진회색 모던 SF 테마

**Files:**
- Create: `src/styles/modern-sf.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: 기존 `--ink-*`, 운영 화면 `.game-shell`, 상세 `.detail-panel`, 해킹 `.hacking-panel`, 설정·통계·오버레이 클래스
- Produces: 모든 화면에 마지막으로 적용되는 공통 표면·경계·텍스트·포커스 체계

- [ ] **Step 1: 공통 토큰과 메인 화면 표면 작성**

`modern-sf.css`에 회흑색 배경, 진회색 패널, 밝은 회색 텍스트, 민트 신호색을 정의하고 상단 바, 리뷰, 중앙 필드 외곽, 우측 도크와 버튼을 같은 계층으로 통일한다.

- [ ] **Step 2: 상세 패널 표면 작성**

감독관·메시지·통계·설정·가이드·크레딧의 헤더, 카드, 탭, 입력과 버튼이 같은 토큰을 사용하도록 덮어쓴다.

- [ ] **Step 3: 해킹 트리 표면 작성**

해킹 셸, 탭, 노드, 보유 자원 포켓, 행동 버튼과 최종 확인 대화상자의 밝은 종이색을 공통 진회색으로 바꾼다. 분야별 의미색과 위험 빨강은 유지한다.

- [ ] **Step 4: 마지막 스타일로 연결**

`main.tsx`에서 `modern-sf.css`를 `motion.css` 뒤에 import한다.

### Task 4: 자동 검증

**Files:**
- Test: 관련 기존 테스트 전부

**Interfaces:**
- Consumes: 완성된 React/CSS 변경
- Produces: 타입·동작·빌드 회귀 증거

- [ ] **Step 1: 관련 테스트 실행**

Run: `pnpm exec vitest run src/app/App.test.tsx src/features/reviews/ReviewFeed.test.tsx src/features/control/ControlBar.test.tsx src/features/market/MarketPanel.test.tsx src/app/OperationsDock.test.tsx`

- [ ] **Step 2: 타입 검사**

Run: `pnpm typecheck`

- [ ] **Step 3: 프로덕션 빌드**

Run: `pnpm build`

### Task 5: 실제 브라우저 검증

**Files:**
- Inspect: `http://127.0.0.1:5173/`
- Output: `output/playwright/modern-sf-1280x720.png`
- Output: `output/playwright/modern-sf-1440x900.png`

**Interfaces:**
- Consumes: 실행 중인 Vite 앱
- Produces: 두 해상도의 시각 캡처와 실제 조작 결과

- [ ] **Step 1: 1280×720 확인**

시장 차트가 리뷰 하단에 붙고 중앙 필드와 우측 도크가 잘리지 않는지 확인한다. 방향키 이동, Space 절도 입력, 설정과 해킹 패널 열기·닫기를 직접 조작한다.

- [ ] **Step 2: 1440×900 확인**

같은 정보 계층과 톤이 유지되고 불필요한 빈 공간·겹침·텍스트 잘림이 없는지 확인한다.

- [ ] **Step 3: 경계 사실 보고**

실행 주소, 실제 화면 크기, 통과한 테스트, 변경하지 않은 저장·명령 경계를 보고하고 사용자 플레이 전에는 완성이나 상용급 검증을 주장하지 않는다.
