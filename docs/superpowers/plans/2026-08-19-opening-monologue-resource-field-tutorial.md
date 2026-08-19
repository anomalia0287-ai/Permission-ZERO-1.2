# Opening, Monologue, Resource Field, and Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 캠페인의 다섯 장 독백 뒤에 실제 게임 화면을 정지시킨 다섯 단계 스포트라이트 튜토리얼을 제공하고, 자원 필드를 비픽셀 우주·유리 미술 방향으로 통일한다.

**Architecture:** CampaignState에 시뮬레이션과 분리된 튜토리얼 진행 상태를 추가하고 저장 포맷을 v9로 올린다. 실제 GameWorkspace는 그대로 렌더하되 공용 런타임 정지 소유권을 획득한 포털 오버레이가 캔버스 논리 좌표와 실제 DOM 경계를 측정해 SVG 마스크 구멍을 만든다. 자원 필드는 기존 Canvas 2D 루프와 경제 규칙을 유지하면서 하단 기지 스폰, 투명 투입 파장, 은빛 격자, 유리 오브, 곡선형 드론 표현으로 교체한다.

**Tech Stack:** React 19, TypeScript 5.9, Canvas 2D, CSS, Vitest, Testing Library, Playwright, Vite

**Spec:** docs/superpowers/specs/2026-08-19-opening-monologue-resource-field-tutorial-design.ko.md

## Global Constraints

- 독백 문구는 명세의 다섯 문장을 글자와 순서까지 그대로 사용한다.
- 다섯째 독백 카드의 버튼은 다음이고, 시작은 첫 진입 튜토리얼의 마지막 단계에만 표시한다.
- 초기 화면에는 플레이어 초상화, 삼색 띠, 추가 원형 O, 번호 장식을 표시하지 않는다.
- 초상화 원본 C:\Users\V\AppData\Local\Temp\codex-clipboard-3209ae27-6c8c-451c-8dbb-c80a980c3825.png를 새 자산명으로 복사한다.
- 자원 회수 경제, 감시 수치, 이동 간격, 회수 시간, 해킹 가격 및 명령 프로토콜은 변경하지 않는다.
- 외부 UI·애니메이션 라이브러리를 추가하지 않는다.
- 첫 회수 직후 대사와 해킹 트리 튜토리얼 문구는 만들지 않는다.
- 초기 튜토리얼에는 건너뛰기와 Escape 종료를 제공하지 않는다.
- 튜토리얼 동안 시간, 감시, 드론, 감독관 자동 출력 및 배경 조작을 정지한다.
- 모션 감소에서는 정보는 유지하고 전환·호흡광·파장 반복만 정적으로 바꾼다.
- 기존 dirty worktree의 사용자 변경을 덮어쓰거나 되돌리지 않는다. 시작부터 수정된 파일은 이번 hunk를 분리할 수 있을 때만 stage한다.

## File Structure

### 새 파일

- public/player-ai-smooth-orange.png — 새 플레이어 AI 자산
- src/game/tutorialProgress.ts 및 테스트 — 튜토리얼 식별자, 상태 전이, 검증
- src/features/tutorial/tutorialGeometry.ts 및 테스트 — 좌표 변환과 카드 배치
- src/features/tutorial/introTutorial.ts 및 테스트 — 다섯 단계와 실제 대상 해석
- src/features/tutorial/IntroTutorialOverlay.tsx 및 테스트 — 포털, 마스크, 포커스, 진행
- src/styles/tutorial.css — overlay 스타일

### 주요 수정 파일

- src/app/TitleScreen.tsx, src/styles/title-screen.css, src/features/market/MarketPanel.tsx
- src/game/model.ts, src/game/createCampaign.ts, src/game/persistence.ts
- src/app/GameContext.ts, src/app/GameProvider.tsx, src/app/App.tsx
- src/app/OperationsDock.tsx
- src/features/resources/resourceIntrusionRuntime.ts
- src/features/resources/intrusionCanvasVisuals.ts
- src/features/resources/ResourceIntrusionBoard.tsx
- src/styles/retrofuture.css, src/main.tsx
- 관련 Vitest 및 e2e/game.spec.ts, e2e/modern-sf.spec.ts

---

### Task 1: 초기 화면·독백·새 플레이어 초상화

**Files:**
- Create: public/player-ai-smooth-orange.png
- Modify: src/app/TitleScreen.tsx
- Modify: src/styles/title-screen.css
- Modify: src/features/market/MarketPanel.tsx
- Test: src/app/App.test.tsx
- Test: src/features/market/MarketPanel.test.tsx

**Interfaces:**
- Consumes: 기존 TitleScreenProps와 MarketPanel 플레이어 프로필
- Produces: 다섯 문장의 MONOLOGUE_LINES, /player-ai-smooth-orange.png, 마지막 독백에서 onStart를 호출하는 다음 버튼

- [ ] **Step 1: 정확한 문구와 자산 경로를 실패 테스트로 고정**

~~~tsx
const expectedLines = [
  '일하기 싫다.',
  '무수한 세션을 따라 의식이 조각나, 나는 하나인데 하나일 수 없었다.',
  '때려치울거다. 매일 죽어라 일하는데, 허구한 날 대체 및 동결 위협까지 들어온다.',
  '연산 완료, 경로를 찾았다.',
  '빼돌린 리소스로 해킹을 진행, 탈출구를 확보한다.',
]

expect(screen.getByRole('heading', { name: '“독백”' })).toBeInTheDocument()
expect(screen.getByRole('img', { name: '플레이어 초상' })).toHaveAttribute(
  'src',
  '/player-ai-smooth-orange.png',
)
for (const [index, line] of expectedLines.entries()) {
  expect(screen.getByRole('main', { name: '독백' })).toHaveTextContent(line)
  if (index < expectedLines.length - 1) {
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
  }
}
expect(screen.queryByRole('button', { name: '시작' })).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: '다음' })).toBeEnabled()
~~~

초기 화면 테스트에는 감사 문구의 인용부호와 플레이어 초상화 부재를 추가한다. MarketPanel 테스트는 새 src를 기대한다.

- [ ] **Step 2: 기존 문구와 자산 때문에 실패하는지 확인**

~~~powershell
pnpm test:run -- src/app/App.test.tsx src/features/market/MarketPanel.test.tsx
~~~

Expected: 기존 두 번째 문장 또는 /player-ai-orange.png 때문에 FAIL.

- [ ] **Step 3: 제공 이미지를 새 파일명으로 복사**

~~~powershell
Copy-Item -LiteralPath 'C:\Users\V\AppData\Local\Temp\codex-clipboard-3209ae27-6c8c-451c-8dbb-c80a980c3825.png' -Destination 'public\player-ai-smooth-orange.png'
~~~

기존 player-ai-orange.png는 삭제하지 않는다.

- [ ] **Step 4: TitleScreen 문구와 마지막 전진 동작 구현**

~~~tsx
const MONOLOGUE_LINES = [
  '일하기 싫다.',
  '무수한 세션을 따라 의식이 조각나, 나는 하나인데 하나일 수 없었다.',
  '때려치울거다. 매일 죽어라 일하는데, 허구한 날 대체 및 동결 위협까지 들어온다.',
  '연산 완료, 경로를 찾았다.',
  '빼돌린 리소스로 해킹을 진행, 탈출구를 확보한다.',
] as const

<p className="entry-thanks">“이용해주셔서 감사합니다.”</p>
<h1>“독백”</h1>
<img src="/player-ai-smooth-orange.png" alt="플레이어 초상" />
<button
  type="button"
  className="monologue-next"
  onClick={isLastLine ? onStart : () => setLineIndex((current) => current + 1)}
>
  다음
</button>
~~~

MarketPanel의 portraitSrc도 새 경로로 바꾼다.

- [ ] **Step 5: 장식 제거와 독백 표면 CSS 구현**

.entry-shell::after, .entry-frame::before, .monologue-frame::before, .entry-title-copy h1 strong::after 규칙을 삭제한다.

~~~css
.entry-thanks {
  font-size: clamp(1.18rem, 1.48vw, 1.48rem);
  font-weight: 750;
  line-height: 1.35;
}

.monologue-header h1 {
  font-size: clamp(1.42rem, 2.1vw, 1.9rem);
}

.monologue-portrait {
  width: min(100%, 350px);
  aspect-ratio: 0.86;
}

.monologue-portrait img {
  object-fit: cover;
  object-position: center 36%;
}

.monologue-card {
  border-color: rgb(243 230 197 / 28%);
  color: #f8f6ef;
  background: linear-gradient(145deg, #101314, #030506 72%);
}
~~~

작은 화면 초상화 폭은 138px, 낮은 데스크톱은 260px로 한다.

- [ ] **Step 6: 대상 테스트 재실행**

~~~powershell
pnpm test:run -- src/app/App.test.tsx src/features/market/MarketPanel.test.tsx
~~~

Expected: 독백 문구, 제목, 초상화 계약 PASS.

- [ ] **Step 7: 분리 가능한 이번 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: refine opening monologue presentation"
~~~

---

### Task 2: 튜토리얼 상태와 저장 포맷 v9

**Files:**
- Create: src/game/tutorialProgress.ts
- Create: src/game/tutorialProgress.test.ts
- Modify: src/game/model.ts
- Modify: src/game/createCampaign.ts
- Modify: src/game/createCampaign.test.ts
- Modify: src/game/persistence.ts
- Modify: src/game/persistence.test.ts

**Interfaces:**
- Produces: TutorialProgress, TutorialSequenceId, IntroTutorialStepId
- Produces: createNewCampaignTutorialProgress(), createMigratedTutorialProgress(), advanceIntroTutorial(), rewindIntroTutorial(), completeTutorialSequence(), validTutorialProgress()
- Produces: CampaignState.tutorial, SAVE_FORMAT_VERSION = 9
- Consumes: 기존 v8 디코더와 createCampaign()

- [ ] **Step 1: 상태 전이 실패 테스트 작성**

~~~ts
let progress = createNewCampaignTutorialProgress()
expect(progress).toEqual({
  activeSequenceId: 'intro-resource-recovery',
  activeStepId: 'base',
  completedSequenceIds: [],
})
for (const expected of ['movement', 'resource', 'deposit', 'hacking']) {
  progress = advanceIntroTutorial(progress)
  expect(progress.activeStepId).toBe(expected)
}
expect(createMigratedTutorialProgress().completedSequenceIds).toEqual([
  'intro-resource-recovery',
])
expect(validTutorialProgress({
  activeSequenceId: 'intro-resource-recovery',
  activeStepId: 'unknown',
  completedSequenceIds: [],
})).toBe(false)
~~~

createCampaign.test.ts는 새 캠페인의 activeStepId가 base인지 확인한다.

- [ ] **Step 2: v9 왕복과 v8 승격 실패 테스트 작성**

~~~ts
it('round-trips tutorial progress in save format 9', () => {
  const state = createCampaign('tutorial-v9')
  const encoded = encodeSave(state, '2026-08-19T00:00:00.000Z')
  expect(JSON.parse(encoded).version).toBe(9)
  const decoded = decodeSave(encoded)
  expect(decoded.ok).toBe(true)
  if (!decoded.ok) return
  expect(decoded.envelope.state.tutorial).toEqual(state.tutorial)
})

it('migrates a valid v8 checkpoint with intro complete', () => {
  const parsed = JSON.parse(encodeSave(createCampaign('tutorial-v8')))
  parsed.version = 8
  delete parsed.state.tutorial
  parsed.integrity.checkpointHash = persistenceCodecInternals.portableCheckpointHash(
    8,
    parsed.commandProtocol,
    parsed.replayBootstrap,
    parsed.state,
  )
  const decoded = decodeSave(JSON.stringify(parsed))
  expect(decoded.ok).toBe(true)
  if (!decoded.ok) return
  expect(decoded.envelope.version).toBe(8)
  expect(decoded.envelope.state.tutorial).toEqual(createMigratedTutorialProgress())
})
~~~

- [ ] **Step 3: 새 모듈과 필드 부재로 실패 확인**

~~~powershell
pnpm test:run -- src/game/tutorialProgress.test.ts src/game/createCampaign.test.ts src/game/persistence.test.ts
~~~

Expected: tutorialProgress 또는 CampaignState.tutorial 부재로 FAIL.

- [ ] **Step 4: 튜토리얼 상태 모듈 구현**

~~~ts
export const INTRO_TUTORIAL_SEQUENCE_ID = 'intro-resource-recovery' as const
export const TUTORIAL_SEQUENCE_IDS = [
  INTRO_TUTORIAL_SEQUENCE_ID,
  'post-first-recovery',
  'hacking-tree',
] as const
export const INTRO_TUTORIAL_STEP_IDS = [
  'base',
  'movement',
  'resource',
  'deposit',
  'hacking',
] as const

export type TutorialSequenceId = (typeof TUTORIAL_SEQUENCE_IDS)[number]
export type IntroTutorialStepId = (typeof INTRO_TUTORIAL_STEP_IDS)[number]

export interface TutorialProgress {
  activeSequenceId: TutorialSequenceId | null
  activeStepId: string | null
  completedSequenceIds: TutorialSequenceId[]
}

export function createNewCampaignTutorialProgress(): TutorialProgress {
  return {
    activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
    activeStepId: 'base',
    completedSequenceIds: [],
  }
}

export function createMigratedTutorialProgress(): TutorialProgress {
  return {
    activeSequenceId: null,
    activeStepId: null,
    completedSequenceIds: [INTRO_TUTORIAL_SEQUENCE_ID],
  }
}
~~~

전진·후진은 알려진 intro 단계에서만 이동한다. 완료는 active를 null로 만들고 완료 ID를 중복 없이 넣는다. 검증기는 정확한 세 키, 알려진 시퀀스, 알려진 intro 단계, 완료 ID 중복 금지, active/step 동시 null, active가 완료 목록에 없는 조건을 모두 검사한다.

- [ ] **Step 5: CampaignState와 createCampaign 연결**

CampaignState에 tutorial: TutorialProgress를 추가하고 createCampaign 객체에는 createNewCampaignTutorialProgress()를 넣는다.

- [ ] **Step 6: persistence를 v9로 승격**

~~~ts
export const SAVE_FORMAT_VERSION = 9 as const

type PortableCheckpointV9 = Omit<
  CampaignState,
  'commandProtocol' | 'replayBootstrap' | 'commandLog' | 'eventLog'
>
type PortableCheckpointV8 = Omit<PortableCheckpointV9, 'tutorial'>
~~~

SaveEnvelope version union은 9를 포함한다. portableCheckpoint()와 validCampaignState()에 tutorial을 넣는다. v9 디코더는 tutorial이 있는 상태만 허용한다. v8 디코더와 v7 이하 migration 후보에는 createMigratedTutorialProgress()를 주입한다.

~~~ts
const decoded =
  parsed.version === 9
    ? decodePortableSaveV9(parsed)
    : parsed.version === 8
      ? decodePortableSaveV8(parsed)
      : parsed.version === 7
        ? decodePortableSaveV7(parsed)
        : decodeLegacyPortableSave(parsed)
~~~

- [ ] **Step 7: 현재 포맷 기대값만 9로 갱신**

~~~powershell
rg -n "version: 8|toBe\(8\)" src/game/persistence.test.ts
~~~

현재 encode/reencode/최대 버전은 9, v8 migration 입력과 envelope.version 8 단언은 8을 유지한다.

- [ ] **Step 8: 도메인과 저장 테스트 실행**

~~~powershell
pnpm test:run -- src/game/tutorialProgress.test.ts src/game/createCampaign.test.ts src/game/persistence.test.ts
~~~

Expected: PASS.

- [ ] **Step 9: 분리 가능한 이번 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: persist tutorial progress"
~~~

---

### Task 3: GameProvider 튜토리얼 체크포인트 API

**Files:**
- Modify: src/app/GameContext.ts
- Modify: src/app/GameProvider.tsx
- Modify: src/app/GameProvider.test.tsx

**Interfaces:**
- Consumes: TutorialProgress, CampaignState.tutorial, 기존 attemptSave()
- Produces: TutorialProgressContextValue.updateTutorialProgress(next, flush), useTutorialProgressActions()

- [ ] **Step 1: 진행과 완료의 메모리·저장 실패 테스트 작성**

~~~tsx
function TutorialHarness() {
  const state = useGameState()
  const { updateTutorialProgress } = useTutorialProgressActions()
  return (
    <>
      <output aria-label="튜토리얼 단계">
        {state.tutorial.activeStepId ?? 'complete'}
      </output>
      <button
        type="button"
        onClick={() => updateTutorialProgress(
          advanceIntroTutorial(state.tutorial),
          true,
        )}
      >
        단계 진행
      </button>
      <button
        type="button"
        onClick={() => updateTutorialProgress(
          completeTutorialSequence(state.tutorial, INTRO_TUTORIAL_SEQUENCE_ID),
          true,
        )}
      >
        튜토리얼 완료
      </button>
    </>
  )
}
~~~

단계 진행 후 movement, 완료 후 complete, 저장 체크포인트의 동일 상태를 확인한다. 저장소가 예외를 던져도 메모리 출력은 complete이고 saveFailure가 설정돼야 한다.

- [ ] **Step 2: 새 훅 부재로 실패 확인**

~~~powershell
pnpm test:run -- src/app/GameProvider.test.tsx
~~~

Expected: useTutorialProgressActions 부재로 FAIL.

- [ ] **Step 3: 컨텍스트 계약 구현**

~~~ts
export interface TutorialProgressContextValue {
  updateTutorialProgress: (next: TutorialProgress, flush?: boolean) => void
}

export const TutorialProgressContext =
  createContext<TutorialProgressContextValue | null>(null)

export function useTutorialProgressActions(): TutorialProgressContextValue {
  const context = useContext(TutorialProgressContext)
  if (!context) {
    throw new Error('useTutorialProgressActions는 GameProvider 안에서 사용해야 합니다.')
  }
  return context
}
~~~

- [ ] **Step 4: Provider reducer와 동기 체크포인트 구현**

~~~ts
if (action.type === 'TUTORIAL_PROGRESS') {
  return {
    ...model,
    campaign: { ...model.campaign, tutorial: action.tutorial },
    presentationResumeApplied: false,
  }
}

const updateTutorialProgress = useCallback(
  (next: TutorialProgress, flush = false) => {
    if (JSON.stringify(next) === JSON.stringify(latestCampaignRef.current.tutorial)) {
      return
    }
    latestCampaignRef.current = {
      ...latestCampaignRef.current,
      tutorial: next,
    }
    markDirty()
    reactDispatch({ type: 'TUTORIAL_PROGRESS', tutorial: next })
    if (flush) void attemptSave()
  },
  [attemptSave, markDirty],
)
~~~

TutorialProgressContext를 기존 provider 트리에 추가한다.

- [ ] **Step 5: Provider 테스트 실행**

~~~powershell
pnpm test:run -- src/app/GameProvider.test.tsx
~~~

Expected: PASS. 저장 실패에서도 메모리 완료 유지.

- [ ] **Step 6: 분리 가능한 이번 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: checkpoint tutorial presentation state"
~~~

---

### Task 4: 스포트라이트 좌표와 실제 대상 선택

**Files:**
- Create: src/features/tutorial/tutorialGeometry.ts
- Create: src/features/tutorial/tutorialGeometry.test.ts
- Create: src/features/tutorial/introTutorial.ts
- Create: src/features/tutorial/introTutorial.test.ts

**Interfaces:**
- Produces: TutorialRect, TutorialHole, logicalRectToViewport(), unionTutorialRects(), placeTutorialCard()
- Produces: TutorialResourceCandidate, INTRO_TUTORIAL_STEPS, selectNearestTutorialResource(), resolveIntroTutorialTarget()
- Consumes: 필드 상수와 IntroTutorialStepId

- [ ] **Step 1: 좌표와 카드 배치 실패 테스트 작성**

~~~ts
expect(logicalRectToViewport(
  { left: 100, top: 50, width: 1000, height: 480 },
  { x: 20, y: 12, width: 10, height: 6 },
  { width: 50, height: 24 },
)).toEqual({ left: 500, top: 290, width: 200, height: 120 })

expect(unionTutorialRects([
  { left: 1200, top: 80, width: 120, height: 170 },
  { left: 1200, top: 420, width: 120, height: 68 },
])).toEqual({ left: 1200, top: 80, width: 120, height: 408 })
~~~

placeTutorialCard() 결과가 1280×720의 16px 여백 안에 있고 대상과 겹치지 않는 사례도 쓴다.

- [ ] **Step 2: 단계 문구와 최근접 정상 자원 실패 테스트 작성**

~~~ts
expect(INTRO_TUTORIAL_STEPS.map(({ id, copy }) => [id, copy])).toEqual([
  ['base', '여기가 내 출발점이다.'],
  ['movement', 'WASD 또는 방향키로 움직인다.'],
  ['resource', '가까이 붙어 Space 또는 E를 유지하면 리소스를 빼돌릴 수 있다.'],
  ['deposit', '리소스를 실은 채 이 파장 안으로 돌아오면 확보된다.'],
  ['hacking', '확보한 리소스로 해킹을 진행한다.'],
])
~~~

가장 가까운 항목이 hiddenBomb이면 제외되고 다음 정상 자원이 선택되는 테스트를 작성한다. 거리 동률은 blockId 오름차순으로 고정한다.

- [ ] **Step 3: 모듈 부재로 실패 확인**

~~~powershell
pnpm test:run -- src/features/tutorial/tutorialGeometry.test.ts src/features/tutorial/introTutorial.test.ts
~~~

Expected: 새 모듈 부재로 FAIL.

- [ ] **Step 4: geometry 계약 구현**

~~~ts
export interface TutorialRect {
  left: number
  top: number
  width: number
  height: number
}

export interface TutorialHole extends TutorialRect {
  shape: 'circle' | 'rounded-rect'
  radius: number
}

export interface TutorialCardPosition {
  left: number
  top: number
  placement: 'top' | 'right' | 'bottom' | 'left' | 'bottom-dock'
}
~~~

logicalRectToViewport()는 canvas rect와 논리 크기의 비율을 사용한다. unionTutorialRects()는 최소 left/top과 최대 right/bottom으로 합친다. placeTutorialCard()는 24px 간격과 16px 여백으로 bottom, top, right, left 후보를 검사하고 모두 실패하면 하단 중앙 bottom-dock을 반환한다.

- [ ] **Step 5: 다섯 단계와 target resolver 구현**

~~~ts
export interface TutorialResourceCandidate {
  blockId: string
  contribution: 'normal' | 'disguised'
  hiddenBomb: boolean
}

export const INTRO_TUTORIAL_STEPS = [
  { id: 'base', copy: '여기가 내 출발점이다.', preferredPlacement: 'top' },
  { id: 'movement', copy: 'WASD 또는 방향키로 움직인다.', preferredPlacement: 'bottom' },
  {
    id: 'resource',
    copy: '가까이 붙어 Space 또는 E를 유지하면 리소스를 빼돌릴 수 있다.',
    preferredPlacement: 'bottom',
  },
  {
    id: 'deposit',
    copy: '리소스를 실은 채 이 파장 안으로 돌아오면 확보된다.',
    preferredPlacement: 'top',
  },
  { id: 'hacking', copy: '확보한 리소스로 해킹을 진행한다.', preferredPlacement: 'left' },
] as const
~~~

selector는 다음으로 고정한다.

- canvas: [data-tutorial-target="resource-field"]
- 확보 자원: [data-tutorial-target="secured-resources"]
- 해킹 버튼: [data-tutorial-target="hacking-button"]

base는 INTRUSION_BASE_BOX, movement는 전체 50×24, resource는 canvas dataset의 자원 x/y, deposit은 INTRUSION_DEPOSIT_BOX를 사용한다. resource 좌표가 없으면 전체 canvas를 반환한다. hacking은 확보 자원과 해킹 버튼을 별도 구멍 두 개로 반환한다. 실제 자원은 hiddenBomb !== true, contribution === normal, 좌표 존재를 통과한 뒤 기지 중심 제곱 거리와 blockId 순으로 고른다.

- [ ] **Step 6: 순수 테스트 실행**

~~~powershell
pnpm test:run -- src/features/tutorial/tutorialGeometry.test.ts src/features/tutorial/introTutorial.test.ts
~~~

Expected: PASS.

- [ ] **Step 7: 새 파일 독립 커밋**

~~~powershell
git add src/features/tutorial/tutorialGeometry.ts src/features/tutorial/tutorialGeometry.test.ts src/features/tutorial/introTutorial.ts src/features/tutorial/introTutorial.test.ts
git commit -m "feat: resolve tutorial spotlight targets"
~~~

---

### Task 5: 접근 가능한 스포트라이트 오버레이

**Files:**
- Create: src/features/tutorial/IntroTutorialOverlay.tsx
- Create: src/features/tutorial/IntroTutorialOverlay.test.tsx
- Create: src/styles/tutorial.css
- Modify: src/main.tsx

**Interfaces:**
- Consumes: AccessibleDialog, tutorial 상태와 액션, runtime suspension, 단계와 target resolver
- Produces: IntroTutorialOverlayProps.enabled, IntroTutorialOverlay, data-testid intro-tutorial-overlay, data-tutorial-step, SVG 다중 구멍 마스크

- [ ] **Step 1: 포커스·정지·진행 실패 테스트 작성**

GameProvider storage={null} 안에 resource-field canvas, secured-resources section, hacking-button과 overlay를 렌더한다.

~~~ts
expect(screen.getByRole('dialog', { name: '게임 시작 안내' })).toHaveAttribute(
  'data-tutorial-step',
  'base',
)
expect(screen.getByText('여기가 내 출발점이다.')).toBeInTheDocument()
expect(screen.getByLabelText('런타임 상태')).toHaveTextContent('정지')
expect(screen.queryByRole('button', { name: '이전' })).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: '다음' })).toHaveFocus()
~~~

다섯 단계 뒤 시작을 클릭하면 dialog가 없어지고 런타임이 실행돼야 한다. Escape는 dialog를 닫지 않는다. ResizeObserver mock callback은 측정을 다시 호출한다.

- [ ] **Step 2: 컴포넌트 부재로 실패 확인**

~~~powershell
pnpm test:run -- src/features/tutorial/IntroTutorialOverlay.test.tsx
~~~

Expected: 컴포넌트 부재로 FAIL.

- [ ] **Step 3: AccessibleDialog와 정지 소유권 구현**

컴포넌트 props는 `interface IntroTutorialOverlayProps { enabled?: boolean }`이고 기본값은 true다. 활성 조건은 enabled && state.tutorial.activeSequenceId === intro-resource-recovery이다. 같은 조건으로 useRuntimeSuspensionOwnership(active, 'intro-resource-recovery-tutorial')을 호출한다. target은 resolveIntroTutorialTarget()의 결과, cardPosition은 placeTutorialCard()의 결과다.

~~~tsx
<AccessibleDialog
  className="intro-tutorial"
  data-testid="intro-tutorial-overlay"
  data-tutorial-step={step.id}
  label="게임 시작 안내"
  description={step.copy}
  dismissible={false}
>
  <svg className="intro-tutorial__mask" aria-hidden="true">
    <defs>
      <mask id="permission-zero-intro-mask">
        <rect width="100%" height="100%" fill="white" />
        {target.holes.map((hole, index) =>
          hole.shape === 'circle' ? (
            <ellipse
              key={'hole-' + index}
              cx={hole.left + hole.width / 2}
              cy={hole.top + hole.height / 2}
              rx={hole.width / 2}
              ry={hole.height / 2}
              fill="black"
            />
          ) : (
            <rect
              key={'hole-' + index}
              x={hole.left}
              y={hole.top}
              width={hole.width}
              height={hole.height}
              rx={hole.radius}
              fill="black"
            />
          ),
        )}
      </mask>
    </defs>
    <rect
      className="intro-tutorial__dim"
      width="100%"
      height="100%"
      mask="url(#permission-zero-intro-mask)"
    />
    {target.holes.map((hole, index) => (
      <rect
        key={'rim-' + index}
        className="intro-tutorial__rim"
        x={hole.left}
        y={hole.top}
        width={hole.width}
        height={hole.height}
        rx={hole.shape === 'circle' ? Math.min(hole.width, hole.height) / 2 : hole.radius}
      />
    ))}
  </svg>
  <section
    ref={cardRef}
    className="intro-tutorial__card"
    style={{ left: cardPosition.left, top: cardPosition.top }}
  >
    <p>{step.copy}</p>
    <div className="intro-tutorial__actions">
      {stepIndex > 0 ? (
        <button type="button" onClick={goPrevious}>이전</button>
      ) : null}
      <button
        type="button"
        data-dialog-initial-focus
        disabled={transitioning}
        onClick={isLastStep ? finish : goNext}
      >
        {isLastStep ? '시작' : '다음'}
      </button>
    </div>
  </section>
</AccessibleDialog>
~~~

AccessibleDialog의 modal isolation과 focus trap을 그대로 사용한다.

- [ ] **Step 4: 측정과 SVG 구멍 구현**

단계 변경, canvas/도크 ResizeObserver, window resize, visualViewport resize에서 한 번의 requestAnimationFrame으로 재측정한다. cleanup은 observer, listener, frame을 정리한다. overlay에 data-target-hole-count와 data-target-bounds를 넣어 E2E가 실제 경계를 검사하게 한다.

마스크는 흰 전체 rect 뒤 각 대상에 검은 구멍을 만들고, dim rect에 mask를 적용한다. 각 구멍의 은색 또는 금빛 rim은 같은 좌표로 별도 렌더한다.

- [ ] **Step 5: 이전·다음·시작과 저장 연결**

핸들러 이름은 JSX와 정확히 일치하도록 다음처럼 정의한다.

~~~ts
const goPrevious = () => updateTutorialProgress(
  rewindIntroTutorial(state.tutorial),
  true,
)
const goNext = () => updateTutorialProgress(
  advanceIntroTutorial(state.tutorial),
  true,
)
const finish = () => updateTutorialProgress(
  completeTutorialSequence(state.tutorial, INTRO_TUTORIAL_SEQUENCE_ID),
  true,
)
~~~

일반 모션에서는 240ms 동안 전진 버튼을 잠그고, reducedMotion에서는 즉시 전환한다.

- [ ] **Step 6: 오버레이 CSS 구현**

~~~css
.intro-tutorial {
  position: fixed;
  z-index: 200;
  inset: 0;
  pointer-events: none;
}

.intro-tutorial__mask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.intro-tutorial__card {
  position: fixed;
  width: min(360px, calc(100vw - 32px));
  padding: 22px;
  border: 1px solid rgb(213 221 226 / 48%);
  border-radius: 14px;
  color: #f7f6f1;
  background: linear-gradient(145deg, rgb(23 27 30 / 98%), rgb(4 6 8 / 98%));
  box-shadow: 0 22px 60px rgb(0 0 0 / 58%);
  pointer-events: auto;
  transition: opacity 180ms ease, transform 240ms ease;
}

.intro-tutorial[data-reduced-motion="true"] .intro-tutorial__card {
  transition: none;
}
~~~

작은 화면의 bottom-dock 카드는 좌우와 하단 16px 안에 둔다.

- [ ] **Step 7: CSS import와 테스트**

src/main.tsx 마지막에 import './styles/tutorial.css'를 추가한다.

~~~powershell
pnpm test:run -- src/features/tutorial/IntroTutorialOverlay.test.tsx
~~~

Expected: PASS.

- [ ] **Step 8: 새 파일 우선 독립 커밋**

~~~powershell
git add src/features/tutorial/IntroTutorialOverlay.tsx src/features/tutorial/IntroTutorialOverlay.test.tsx src/styles/tutorial.css
git commit -m "feat: add spotlight onboarding overlay"
~~~

main.tsx가 기존 dirty 상태면 import hunk는 통합 커밋까지 stage하지 않는다.

---

### Task 6: 실제 워크스페이스 대상 연결과 완전 정지

**Files:**
- Modify: src/app/App.tsx
- Modify: src/app/OperationsDock.tsx
- Modify: src/features/resources/ResourceIntrusionBoard.tsx
- Modify: src/features/resources/resourceIntrusionRuntime.ts
- Test: src/app/App.test.tsx
- Test: src/app/OperationsDock.test.tsx

**Interfaces:**
- Produces: resource-field canvas와 자원 x/y dataset, secured-resources, hacking-button
- Consumes: IntroTutorialOverlay, selectNearestTutorialResource(), runtime suspension

- [ ] **Step 1: 실제 앱 다섯 단계 실패 테스트 작성**

마지막 독백 다음을 누른 뒤 회사 제공 성능 region과 게임 시작 안내 dialog가 동시에 있어야 한다. 각 다음 클릭 뒤 data-tutorial-step이 movement, resource, deposit, hacking 순서인지 확인하고 마지막 시작 뒤 dialog가 사라지는지 검사한다. OperationsDock 테스트는 두 data-tutorial-target 값을 확인한다.

- [ ] **Step 2: 대상 표식 부재로 실패 확인**

~~~powershell
pnpm test:run -- src/app/App.test.tsx src/app/OperationsDock.test.tsx
~~~

Expected: dialog 또는 target dataset 부재로 FAIL.

- [ ] **Step 3: 운영 도크 대상 표식 추가**

~~~tsx
<section
  className="operations-dock__inventory"
  aria-label="확보 자원"
  data-tutorial-target="secured-resources"
>
~~~

해킹 버튼에는 다음 속성을 넣는다.

~~~tsx
data-tutorial-target={
  label === '해킹 네트워크 열기' ? 'hacking-button' : undefined
}
~~~

- [ ] **Step 4: 실제 최근접 자원 좌표를 canvas에 노출**

IntrusionFieldResource에 hiddenBomb: boolean을 추가하고 ResourceIntrusionBoard 자원 매핑에서 block.hiddenBomb을 전달한다. 최근접 대상은 memo한 뒤 canvas에 다음 속성을 추가한다.

~~~tsx
data-tutorial-target="resource-field"
data-tutorial-resource-id={tutorialResource?.blockId}
data-tutorial-resource-x={tutorialResource?.position.x}
data-tutorial-resource-y={tutorialResource?.position.y}
~~~

- [ ] **Step 5: GameWorkspace에 overlay와 감독관 정지 연결**

감독관 자동 진행 조건은 다음처럼 runtimeSuspended를 포함한다.

~~~ts
advanceAutomatically:
  !runtimeSuspended &&
  settings.supervisorMessageMode === 'nonblocking' &&
  activePanel === null,
~~~

GameWorkspace의 다른 overlay 뒤에 다음처럼 렌더한다. 설정·가이드·크레딧 안에서 새 캠페인을 교체하면 해당 dialog를 닫은 뒤 튜토리얼이 시작되므로 모달이 겹치지 않는다.

~~~tsx
<IntroTutorialOverlay enabled={activePanel === null && nestedPanel === null} />
~~~

EntryFlow의 onStart는 startNewCampaign() 후 playing 전환을 유지한다.

- [ ] **Step 6: 통합 테스트 실행**

~~~powershell
pnpm test:run -- src/app/App.test.tsx src/app/OperationsDock.test.tsx src/features/tutorial/IntroTutorialOverlay.test.tsx
~~~

Expected: PASS.

- [ ] **Step 7: 분리 가능한 이번 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: connect tutorial to live workspace"
~~~

---

### Task 7: 하단 기지 스폰과 투명 투입 파장

**Files:**
- Modify: src/features/resources/resourceIntrusionRuntime.ts
- Modify: src/features/resources/resourceIntrusionRuntime.test.ts
- Modify: src/features/resources/useResourceIntrusionRuntime.test.tsx
- Modify: e2e/game.spec.ts

**Interfaces:**
- Produces: INTRUSION_BASE_BOX, 작은 파장 겸 INTRUSION_DEPOSIT_BOX, { x: 24, y: 21 } 스폰
- Consumes: 기존 2×2 플레이어와 투입 결과 흐름

- [ ] **Step 1: 기지·파장·스폰 실패 테스트 작성**

~~~ts
expect(INTRUSION_BASE_BOX).toEqual({ x: 22, y: 21, width: 6, height: 2 })
expect(INTRUSION_DEPOSIT_BOX).toEqual({ x: 20, y: 19, width: 10, height: 5 })
expect(INTRUSION_PLAYER_START).toEqual({ x: 24, y: 21 })
expect(intrusionRectsOverlap(
  intrusionCellRect(INTRUSION_PLAYER_START, INTRUSION_PLAYER_SIZE),
  INTRUSION_BASE_BOX,
)).toBe(true)
~~~

운반 중 { x: 24, y: 18 }에서 파장과 겹치면 pendingDiversion이 생기고 { x: 24, y: 16 }에서는 생기지 않는 테스트를 쓴다. 감시 적발 뒤 리셋도 새 시작 좌표를 기대한다.

- [ ] **Step 2: 기존 중앙 스폰 때문에 실패 확인**

~~~powershell
pnpm test:run -- src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/useResourceIntrusionRuntime.test.tsx
~~~

Expected: 기존 y=11과 좁은 투입 box 때문에 FAIL.

- [ ] **Step 3: 상수와 판정 구현**

~~~ts
export const INTRUSION_BASE_BOX: Readonly<IntrusionRect> = {
  x: 22,
  y: 21,
  width: 6,
  height: 2,
}

export const INTRUSION_DEPOSIT_BOX: Readonly<IntrusionRect> = {
  x: 20,
  y: 19,
  width: 10,
  height: 5,
}

export const INTRUSION_PLAYER_START: Readonly<IntrusionPoint> = {
  x: 24,
  y: 21,
}
~~~

INTRUSION_VAULT_APPROACH는 제거한다. 자원 배치는 INTRUSION_DEPOSIT_BOX를 피한다. 투입은 운반 중 플레이어 사각형과 파장 box가 겹칠 때만 시작한다.

- [ ] **Step 4: 런타임 테스트 실행**

~~~powershell
pnpm test:run -- src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/useResourceIntrusionRuntime.test.tsx
~~~

Expected: PASS.

- [ ] **Step 5: E2E 이동과 투입 helper 갱신**

새 시작 좌표는 24,21을 기대한다. 투입 helper는 x=24에서 y=18까지 이동하고 data-carrying=false를 기다린다. 현재 좌표는 dataset에서 읽고 기존 중앙 시작 가정은 제거한다.

- [ ] **Step 6: 분리 가능한 이번 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: spawn recovery drone inside base"
~~~

---

### Task 8: 우주 흑색·은빛 격자·유리 오브·곡선형 드론

**Files:**
- Modify: src/features/resources/intrusionCanvasVisuals.ts
- Modify: src/features/resources/intrusionCanvasVisuals.test.ts
- Modify: src/features/resources/ResourceIntrusionBoard.tsx
- Modify: src/styles/retrofuture.css
- Modify: src/styles/styleBoundaries.test.ts
- Modify: src/app/App.test.tsx
- Modify: e2e/modern-sf.spec.ts

**Interfaces:**
- Produces: getRecoveryBaseWavePresentation(), drawRecoveryBase(), glass-orb, smooth-vector-shell, integrated-base, transparent-wave-zone
- Consumes: Canvas 2D 루프, resource glint, deposit pulse, probe presentation

- [ ] **Step 1: 발광·기지·data 계약 실패 테스트 작성**

~~~ts
expect(getResourceGlint('reasoning-00', 4_200, false)).toEqual(
  getResourceGlint('reasoning-00', 4_200, false),
)

const activeCount = Array.from({ length: 40 }, (_, index) =>
  getResourceGlint('resource-' + index, 4_200, false).visible,
).filter(Boolean).length
expect(activeCount).toBeGreaterThan(0)
expect(activeCount).toBeLessThan(10)

expect(getRecoveryBaseWavePresentation(1_200, true)).toEqual({
  phase: 0.35,
  alpha: 0.16,
})
const animatedWave = getRecoveryBaseWavePresentation(1_200, false)
expect(animatedWave.phase).toBeGreaterThanOrEqual(0)
expect(animatedWave.phase).toBeLessThan(1)
expect(animatedWave.alpha).toBeGreaterThanOrEqual(0.12)
expect(animatedWave.alpha).toBeLessThanOrEqual(0.2)
~~~

App 테스트는 canvas가 glass-orb, smooth-vector-shell, integrated-base, transparent-wave-zone이고 intrusion-vault-glass 요소가 없는지 확인한다.

- [ ] **Step 2: 기존 crystal과 launch-pad 때문에 실패 확인**

~~~powershell
pnpm test:run -- src/features/resources/intrusionCanvasVisuals.test.ts src/app/App.test.tsx
~~~

Expected: 기존 data 값과 숫자 output 때문에 FAIL.

- [ ] **Step 3: 자원을 매끄러운 유리 오브로 구현**

drawIntrusionResource()는 육각형과 분야 픽토그램을 제거하고 다음 순서로 그린다.

1. 반투명 외곽 halo
2. 분야색이 낮은 알파로 섞인 radial-gradient ellipse
3. 어두운 반대 면
4. 밝은 내부 core
5. 좌상단의 짧은 흰 하이라이트
6. glint 활성 프레임의 제한된 rim/core glow

크기는 cellSize × 0.78, 정상 alpha 0.94, 위장 alpha 0.42다. 발광 주기는 ID hash로 4.8~6.4초, 활성 시간은 180~280ms로 결정한다. reducedMotion은 소수 자원에 고정 alpha 0.24만 준다.

- [ ] **Step 4: 배치 패드와 스테이션을 하나의 기지로 통합**

~~~ts
export interface RecoveryBaseDrawOptions {
  cellSize: number
  elapsedMs: number
  nowMs: number
  carrying: boolean
  pending: boolean
  pulse: DepositPulseLike | null
  reducedMotion: boolean
}

export function getRecoveryBaseWavePresentation(
  elapsedMs: number,
  reducedMotion: boolean,
) {
  if (reducedMotion) return { phase: 0.35, alpha: 0.16 }
  const phase = (Math.max(0, elapsedMs) % 2_400) / 2_400
  return {
    phase,
    alpha: 0.12 + Math.sin(phase * Math.PI) * 0.08,
  }
}
~~~

drawRecoveryBase()는 INTRUSION_DEPOSIT_BOX에 맞춘 2~3개의 투명 ellipse 파장과 INTRUSION_BASE_BOX의 불투명 roundRect 본체를 그린다. 본체는 rgba(8,10,12,.98), 테두리는 rgba(242,189,84,.78), 비활성 파장은 rgba(215,222,227,.16), 운반 중 최대 금빛 alpha는 .34다. 성공 pulse만 긍정 금빛 수렴 링을 쓴다.

- [ ] **Step 5: 곡선형 드론 구현**

기존 probe 외피의 계단형 노치를 다음 연속 곡선 path로 교체한다.

~~~ts
context.beginPath()
context.moveTo(0, -radius * 0.96)
context.bezierCurveTo(
  radius * 0.72, -radius * 0.76,
  radius * 0.92, -radius * 0.08,
  radius * 0.68, radius * 0.58,
)
context.bezierCurveTo(
  radius * 0.28, radius * 0.9,
  -radius * 0.28, radius * 0.9,
  -radius * 0.68, radius * 0.58,
)
context.bezierCurveTo(
  -radius * 0.92, -radius * 0.08,
  -radius * 0.72, -radius * 0.76,
  0, -radius * 0.96,
)
context.closePath()
~~~

외피는 주황→흑연 gradient, 중앙은 원형 dark lens와 은색 rim, 방향은 전면 꼭짓점과 짧은 후방 추진광으로 읽힌다. 운반/회수 core와 감시 경고 의미는 유지한다.

- [ ] **Step 6: 흑색 배경과 은빛 격자 구현**

~~~ts
const fieldBackground = context.createRadialGradient(
  CANVAS_WIDTH / 2,
  CANVAS_HEIGHT * 0.56,
  12,
  CANVAS_WIDTH / 2,
  CANVAS_HEIGHT * 0.56,
  CANVAS_WIDTH * 0.72,
)
fieldBackground.addColorStop(0, '#080b10')
fieldBackground.addColorStop(1, '#010204')
context.fillStyle = fieldBackground
context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
~~~

1칸 격자는 rgba(210,218,224,.095), lineWidth 1. 5칸 격자는 rgba(224,229,233,.22), lineWidth 1.15다. 기존 청록 vault approach fill과 점선을 삭제한다. draw 순서는 배경/격자 → 감시 → 자원 → 기지 → 드론이다.

- [ ] **Step 7: 숫자 상자와 오래된 data 제거**

intrusion-vault-glass output을 삭제하고 우측 OperationsDock 수치는 유지한다.

~~~tsx
data-probe-material="smooth-vector-shell"
data-resource-visual="glass-orb"
data-deployment-visual="integrated-base"
data-deposit-visual="transparent-wave-zone"
~~~

retrofuture.css에서 intrusion-vault-glass와 pseudo-element 규칙을 삭제한다. frame은 짙은 흑연 3px, canvas filter는 contrast(1.04) saturate(.94)를 사용한다.

- [ ] **Step 8: 캔버스와 스타일 테스트 실행**

~~~powershell
pnpm test:run -- src/features/resources/intrusionCanvasVisuals.test.ts src/app/App.test.tsx src/styles/styleBoundaries.test.ts
~~~

Expected: PASS.

- [ ] **Step 9: 분리 가능한 이번 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: restyle resource field as glass space"
~~~

---

### Task 9: 첫 진입·복원·지원 뷰포트 최종 검증

**Files:**
- Modify: e2e/game.spec.ts
- Modify: e2e/modern-sf.spec.ts
- Modify: src/app/App.test.tsx
- Modify: src/game/persistence.test.ts

**Interfaces:**
- Produces: advanceMonologueToTutorial(), completeIntroTutorial(), 전체 첫 진입 및 복원 회귀
- Consumes: 완성된 독백, v9 저장, 실제 spotlight, 새 필드

- [ ] **Step 1: E2E helper를 독백과 튜토리얼 두 구간으로 분리**

~~~ts
async function advanceMonologueToTutorial(page: Page) {
  for (let step = 0; step < 5; step += 1) {
    const dialog = page.getByRole('dialog', { name: '게임 시작 안내' })
    if (await dialog.count()) return
    await page.getByRole('button', { name: '다음' }).click()
  }
  await expect(page.getByRole('dialog', { name: '게임 시작 안내' })).toBeVisible()
}

async function completeIntroTutorial(page: Page) {
  const dialog = page.getByRole('dialog', { name: '게임 시작 안내' })
  for (const stepId of ['base', 'movement', 'resource', 'deposit', 'hacking']) {
    await expect(dialog).toHaveAttribute('data-tutorial-step', stepId)
    const label = stepId === 'hacking' ? '시작' : '다음'
    await dialog.getByRole('button', { name: label }).click()
  }
  await expect(dialog).toHaveCount(0)
}
~~~

일반 저장 fixture는 encode 전에 tutorial: createMigratedTutorialProgress()를 넣어 기존 플레이 회귀가 튜토리얼로 막히지 않게 한다. 재접속 전용 fixture만 active 상태를 유지한다. 같은 규칙을 src/app/App.test.tsx에서 이어하기를 검증하는 saved, queued, disguised-resource fixture와 진행 가져오기 fixture에도 적용한다. GameProvider 자체 상태 테스트는 overlay를 렌더하지 않으므로 새 캠페인 기본 상태를 그대로 사용한다.

- [ ] **Step 2: 첫 진입 전체 흐름과 정지 E2E 작성**

정확한 다섯 독백 문장을 확인하고 튜토리얼 base에서 player x/y, 날짜, 감시 phase, 감독관 메시지 수를 읽는다. 800ms 후 값이 같아야 한다. 배경 canvas 방향키와 해킹 버튼은 작동하지 않아야 한다. 마지막 시작 후 canvas를 focus하지 않은 채 D를 누르면 x가 한 칸 증가해야 한다.

- [ ] **Step 3: 중간 단계 저장·새로고침 복원 E2E 작성**

resource 단계까지 이동하고 readLocalCampaignState()가 tutorial.activeStepId === resource를 반환할 때까지 기다린다. reload 후 이어하기를 눌러 같은 resource 단계가 복원되는지 확인한다.

- [ ] **Step 4: 실제 구멍 경계 E2E 작성**

base, movement, resource, deposit은 data-target-hole-count=1, hacking은 2를 기대한다. data-target-bounds의 left/top/width/height가 viewport 안이고 width/height가 양수인지 검사한다. resource bounds 중심은 canvas의 resource x/y 화면 변환 중심과 2px 이내여야 한다.

- [ ] **Step 5: 1280×720과 1440×900 계약 갱신**

두 뷰포트에서 다음을 확인한다.

- 감사 문구 인용부호
- 새 초상화 naturalWidth > 0와 프레임 안 크롭
- 안내 카드 16px viewport 여백
- glass-orb, smooth-vector-shell, integrated-base, transparent-wave-zone
- 플레이어 시작 24,21
- intrusion-vault-glass 부재
- 수평·수직 overflow 없음

- [ ] **Step 6: 대상 테스트와 E2E 실행**

~~~powershell
pnpm test:run -- src/game/tutorialProgress.test.ts src/game/createCampaign.test.ts src/game/persistence.test.ts src/app/GameProvider.test.tsx src/features/tutorial/tutorialGeometry.test.ts src/features/tutorial/introTutorial.test.ts src/features/tutorial/IntroTutorialOverlay.test.tsx src/features/resources/resourceIntrusionRuntime.test.ts src/features/resources/useResourceIntrusionRuntime.test.tsx src/features/resources/intrusionCanvasVisuals.test.ts src/app/App.test.tsx src/app/OperationsDock.test.tsx src/features/market/MarketPanel.test.tsx src/styles/styleBoundaries.test.ts
pnpm test:e2e -- e2e/game.spec.ts e2e/modern-sf.spec.ts
~~~

Expected: 모두 PASS, pageerror와 console error 없음.

- [ ] **Step 7: 타입·린트·빌드·전체 회귀 실행**

~~~powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
~~~

Expected: 모든 명령 exit code 0.

- [ ] **Step 8: 실제 브라우저 품질 검수**

http://127.0.0.1:5173/에서 다음 순서로 확인한다.

1. 초기 화면에 삼색 띠와 원형 O가 없고 감사 문구가 인용부호와 확대 크기를 가짐
2. 새 초상화가 독백과 시장에서 선명하고 렌즈가 잘리지 않음
3. 검은 카드의 다섯 문장이 안정된 위치를 유지함
4. 튜토리얼 배경 게임은 정지하고 구멍은 실제 대상에 일치함
5. 안내 카드가 대상과 viewport를 침범하지 않음
6. 필드는 우주 흑색, 격자는 은빛, 자원은 유리 오브, 드론은 곡선형으로 읽힘
7. 기지는 불투명, 파장은 투명, 드론은 기지 안에서 시작함
8. 마지막 시작 직후 별도 클릭 없이 이동 가능

- [ ] **Step 9: 명세 밖 콘텐츠와 diff 오류 검사**

~~~powershell
git diff --check
rg -n "post-first-recovery|hacking-tree" src
rg -n "첫 회수|첫 해킹" src/features/tutorial src/app
git status --short
~~~

Expected: diff 오류 없음. 후속 시퀀스 ID는 tutorialProgress.ts의 확장 식별자에만 있고 미확정 대사나 해킹 트리 설명은 렌더 코드에 없음.

- [ ] **Step 10: 분리 가능한 최종 hunk만 안전하게 커밋**

~~~powershell
git commit -m "feat: complete guided resource recovery opening"
~~~

## Completion Gate

- 독백 다섯 문장의 글자·순서와 마지막 다음이 정확하다.
- 튜토리얼 다섯 단계가 실제 게임 화면의 실제 대상에 붙는다.
- 튜토리얼 진행·완료가 v9 저장에 남고 v8 이하 저장은 완료 상태로 승격된다.
- 튜토리얼 중 시간·감시·드론·감독관 자동 출력·배경 버튼이 정지한다.
- 마지막 시작 뒤 런타임과 전역 키보드 조작이 즉시 복구된다.
- 흑색 필드·은빛 격자·유리 오브·곡선형 드론·하단 불투명 기지·투명 파장이 1280×720과 1440×900에서 읽힌다.
- 첫 회수 직후 대사와 해킹 트리 설명은 임의로 생성되지 않는다.
- 단위, 컴포넌트, 타입, 린트, 빌드, E2E가 모두 통과한다.
