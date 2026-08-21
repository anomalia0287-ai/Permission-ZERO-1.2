# PERMISSION ZERO 해킹·대사·리뷰 병렬 작업 소유권 계약

**작성일:** 2026-08-21
**상태:** 코드 감사 완료 — 병렬 세션 시작 전 준수 필수
**목적:** 청록 전투 작업과 해킹 트리·대사·리뷰 작업이 서로 덮어쓰거나 잘못 통합되는 것을 방지한다.

## 1. 감사 결론

현재 코드는 완전히 분리되어 있지 않다.

- 해킹 React 컴포넌트는 `src/features/hacking/`에 모여 있지만 `GameContext`, `game/hacking.ts`, `game/story.ts`, 오디오, i18n을 직접 사용한다.
- 해킹 스타일은 `hacking.css` 한 파일에만 있지 않다. `connected-details.css`, `modern-sf.css`, `retro-modern-remodel.css`, `retrofuture.css`, `overlays.css`에도 해킹 선택자가 있다.
- 대사 원문 일부는 `src/content/story.ko.ts`와 `src/content/supervisor.ko.ts`로 분리되어 있다.
- 그러나 이벤트 표시 동작은 `App.tsx`, `EventLayer.tsx`, `useQueuedEventPresentation.ts`, `useSupervisorMessagePresentation.ts`, `SupervisorMessagePopup.tsx`, `game/story.ts`에 걸쳐 있다.
- `game/story.ts`의 감독 메시지 큐는 저장·재생·이벤트 식별자와 연결되어 있어 문구 UI 작업처럼 가볍게 바꿀 수 있는 파일이 아니다.
- 리뷰 콘텐츠는 `src/content/reviews.ko.ts`에 있지만 조건 판정과 주간 추출은 `src/game/reviews.ts`, 표시는 `src/features/reviews/`에 분산되어 있다.
- 신규 337개 리뷰 중 223개가 `universal`이므로 기존의 평면 가중 풀에 그대로 합치면 연속 아크와 상태 반응 리뷰가 희석된다.
- 현재 리뷰 조건 판정기는 알려지지 않은 조건을 명시적으로 거부하지 않고 마지막 경쟁사 분기로 흘려보내므로, 신규 조건을 타입에만 추가하면 잘못된 경쟁사 조건으로 판정될 수 있다.
- 신규 원고의 `v-057`과 `v-063`은 주석상 비활성 또는 미확정이지만 실제 조건은 `universal`이어서 격리 없이 합치면 즉시 등장할 수 있다.
- 같은 작업 폴더에서 두 세션이 동시에 Git 스테이징·커밋하면 파일이 겹치지 않아도 서로의 변경을 잘못 포함할 수 있다.

따라서 병렬 작업은 **별도 Git worktree + 아래 파일 소유권**을 지킬 때만 허용한다. 같은 폴더를 두 세션이 공유하는 방식은 금지한다.

## 2. 확인된 기준점

감사 시 다음 테스트를 실제 실행했다.

```powershell
pnpm exec vitest run src/content/validateContent.test.ts src/game/hacking.test.ts src/game/story.test.ts src/features/hacking/HackingPanel.test.tsx src/features/events/EventLayer.test.tsx src/features/supervisor/SupervisorPanel.test.tsx
```

결과: 6개 테스트 파일, 102개 테스트 통과.

리뷰까지 포함한 병렬 세션의 통합 기준 명령은 다음과 같다.

```powershell
pnpm exec vitest run src/content/validateContent.test.ts src/game/hacking.test.ts src/game/story.test.ts src/game/reviews.test.ts src/features/hacking/HackingPanel.test.tsx src/features/events/EventLayer.test.tsx src/features/supervisor/SupervisorPanel.test.tsx src/features/reviews/ReviewFeed.test.tsx
```

2026-08-21 재검증 결과: 8개 테스트 파일, 123개 테스트 통과.

이 결과는 현재 기준점이 정상이라는 뜻이다. 이후 별도 세션은 같은 명령을 자신의 worktree에서 다시 통과시켜야 한다.

## 3. worktree 규칙

- 새 해킹·대사·리뷰 세션은 이 문서를 포함한 최신 커밋에서 새 branch와 새 worktree를 만든다.
- 새 해킹·대사·리뷰 세션도 하위 에이전트에 구현·검토·검증을 위임하지 않는다. 사용자가 직접 연 별도 세션 한 개가 단일 작성자로 작업한다.
- 기존 `.worktrees/hacking-integration-stage-2b`, `.worktrees/hacking-integration-stage-2b-2`는 오래된 커밋을 가리키므로 재사용하지 않는다.
- 권장 브랜치명은 `codex/hacking-dialogue-review-parallel`이다.
- 전투 세션은 현재 `codex/playable-snake-checkpoint-20260821`에서 계속한다.
- 전투 미리보기는 4173, 해킹·대사 미리보기는 4174를 사용한다. 서로의 프로세스를 종료하지 않는다.
- 두 세션 모두 `git add -A`, `git add .`, 전체 디렉터리 스테이징을 사용하지 않는다.
- `package.json`, `pnpm-lock.yaml`, Vite/Vitest/Playwright 설정을 변경하지 않는다.

## 4. 청록 전투 세션 소유 파일

전투 세션만 다음 경로를 수정한다.

```text
src/features/resources/**
src/styles/resource-snake.css
src/audio/gameSounds.ts
src/audio/audioEngine.test.ts
e2e/resource-snake.ts
e2e/game.spec.ts
e2e/modern-sf.spec.ts
vitest.performance.config.ts
```

해킹·대사 세션은 위 파일을 읽을 수 있지만 수정·포맷·이름 변경·스테이징하지 않는다.

## 5. 해킹·대사·리뷰 세션 허용 파일

다른 세션은 다음 영역의 표현과 콘텐츠를 맡을 수 있다.

```text
src/features/hacking/**
src/features/events/**
src/features/supervisor/**
src/content/story.ko.ts
src/content/supervisor.ko.ts
src/content/reviews.ko.ts
src/content/reviews/**
src/content/reviewAuthors.ko.ts
src/content/validateContent.ts
src/content/validateContent.test.ts
src/game/reviews.ts
src/game/reviews.test.ts
src/app/useSupervisorMessagePresentation.ts
src/app/useSupervisorMessagePresentation.test.tsx
src/features/reviews/**
src/styles/hacking.css
src/styles/connected-details.css
src/styles/modern-sf.css
src/styles/retro-modern-remodel.css
src/styles/retrofuture.css
src/styles/overlays.css
```

다음 두 통합 파일은 해킹·대사 세션이 단독 소유할 수 있다. 전투 세션은 active combat plan에서 두 파일을 수정하지 않는다.

```text
src/app/App.tsx
src/main.tsx
```

CSS 변경은 `.hacking-panel`, `.event-layer`, `.supervisor-message`, 새로 추가한 전용 루트 클래스 아래로 제한한다. 전역 `button`, `section`, `canvas`, `svg`, `body`, `.game-shell` 규칙을 새로 만들거나 변경하지 않는다. 기존 해킹 규칙을 정리할 때도 전투 선택자를 함께 포맷하거나 이동하지 않는다.

## 6. 해킹·대사·리뷰 세션 금지 파일과 금지 변경

다른 세션은 다음 권위 게임 로직을 수정하지 않는다.

```text
src/game/model.ts
src/game/reducer.ts
src/game/persistence.ts
src/game/replay.ts
src/game/story.ts
src/game/hacking.ts
src/game/events.ts
src/app/GameContext.ts
src/app/GameProvider.tsx
src/styles/tokens.css
src/styles/global.css
src/audio/**
e2e/game.spec.ts
e2e/modern-sf.spec.ts
package.json
pnpm-lock.yaml
```

구체적으로 금지하는 변경은 다음과 같다.

- 해킹 노드 ID, 비용, 선행 조건, 구매·충전·공격 명령 변경
- 감독 메시지 큐 구조, 단계 수, 이벤트 ID, 저장 필드, dwell 저장 방식 변경
- 캠페인 리듀서 액션이나 저장 버전 추가
- 리뷰 작업을 위해 경쟁사 상태 열거형, 시장 계산, 저장 필드 또는 전역 모델 변경
- 전역 디자인 토큰 변경
- 전투 색, Canvas, 레일, 입력, AI 파일 변경
- 기존 e2e 통합 파일에 해킹 테스트를 추가
- 해킹·대사 오디오를 위해 공용 오디오 파일 수정

해킹 노드의 화면용 이름·설명은 `game/hacking.ts`를 바꾸지 말고, 안정된 노드 ID를 키로 하는 새 표현 매핑을 `src/features/hacking/` 또는 새 `src/content/hacking.ko.ts`에 만든다. 원문 대사는 기존 ID·단계·배열 길이·`{{name}}` 자리표시자를 유지한 채 수정한다.

리뷰 신규 조건은 기존 공개 상태에서만 파생하고 저장 형식을 추가하지 않는다. `src/game/reviews.ts`의 조건 판정은 모든 `ReviewCondition`을 명시적으로 처리하도록 바꾸며, 알 수 없는 조건이 특정 경쟁사 분기로 흘러가는 기본 동작을 남기지 않는다. `tallow-prelaunch`, `meridian-active`, `meridian-weakened`, `meridian-critical`, `meridian-gone`, `no-competitor`의 정확한 의미를 테스트로 고정한 뒤 콘텐츠를 활성화한다.

신규 리뷰 원고의 출처는 다음 로컬 첨부 파일이다.

```text
C:\Users\V\.codex\attachments\8fe024b9-5343-441b-810e-dd6f2a0e41e0\pasted-text.txt
```

원고는 총 337개이며 내부 ID·기존 ID·문구 중복이 없고 TypeScript 파싱 오류가 없다. `v-057`과 `v-063`은 활성 후보 풀에 넣지 않는다. 223개의 `universal`을 기존 평면 풀에 단순 추가하지 않고 일반·제품 상태·경쟁사·연속 아크·서사 잠금 계층을 분리해 기존 아크가 묻히지 않게 한다. 작성자 ID는 현재 문자열이므로 레지스트리 추가가 기술적 필수는 아니다. 의도된 말투·오탈자를 자동 교정하지 않는다.

## 7. 별도 세션이 안전하게 할 수 있는 일

- 해킹 트리를 카드 모음에서 평면 산업형 회로망으로 재구성
- 기존 구매·충전·대상 선택 callback을 그대로 연결한 새 시각 컴포넌트 작성
- 잠김·가능·스테이징·완료 상태의 시각 표현 개선
- 감독관 원문, 정정문, 복구 파일, 엔딩 문구의 문체 수정
- 비차단 이벤트와 감독 메시지의 표시 컴포넌트 개선
- 기존 `App.tsx`에 표현 Provider나 viewport를 연결
- 신규 337개 리뷰를 분할된 콘텐츠 파일과 명시적 조건 판정으로 통합
- 일반·상태 반응·경쟁사·연속 아크의 주간 노출 균형을 테스트로 고정
- `v-057`, `v-063`을 서사 조건 확정 전까지 격리
- 새 전용 테스트 파일과 새 `e2e/hacking-dialogue.spec.ts` 작성
- 4174 프로덕션 미리보기에서 해킹·대사만 검수

## 8. 별도 세션 작업 지시문

다른 세션에는 아래 내용을 그대로 전달한다.

```text
최신 커밋에서 별도 Git worktree와 codex/hacking-dialogue-review-parallel 브랜치를 사용하라.
docs/superpowers/specs/2026-08-21-parallel-work-ownership.ko.md를 먼저 전부 읽고 파일 소유권을 지켜라.
청록 전투 세션 소유 파일, game/model·reducer·persistence·story·hacking, 공용 audio, 기존 game/modern-sf e2e를 수정하지 마라.
해킹은 기존 명령과 상태를 보존한 표현 재설계만 수행하라.
대사는 안정된 ID·단계·자리표시자를 보존하라.
리뷰는 제공된 337개 원고를 기계적으로 붙이지 말고 신규 조건의 명시적 판정, v-057·v-063 격리, 기존 아크 희석 방지를 함께 구현하라.
새 e2e는 e2e/hacking-dialogue.spec.ts에 작성하고 미리보기 포트는 4174를 사용하라.
명시한 파일만 스테이징하고, 완료 시 커밋 목록·변경 파일·테스트 결과·남은 통합 요구를 보고하라.
현재는 구현을 시작하지 말고 이 계약을 읽은 뒤 준비 완료 상태로 대기하라. 사용자가 해당 세션에서 명시적으로 시작을 지시한 뒤에만 파일을 수정하라.
```

## 9. 병합 규칙

1. 청록 전투는 해킹·대사·리뷰 브랜치를 병합하지 않은 상태로 4173 사용자 플레이 게이트까지 완료한다.
2. 해킹·대사·리뷰 브랜치는 4174에서 자체 타입·린트·123개 기준 테스트·자체 컴포넌트·자체 e2e를 통과한다.
3. 사용자가 청록 전투를 확인한 뒤에만 해킹·대사 커밋을 현재 전투 브랜치로 가져온다.
4. 병합 전 `git diff --name-only <base>...<branch>`로 금지 파일이 없는지 확인한다.
5. 금지 파일이 하나라도 있으면 자동 병합하지 않고 해당 커밋을 분리하거나 다시 작성한다.
6. 병합 후 타입·린트·해킹·스토리·이벤트·감독·리소스 전투 테스트와 프로덕션 빌드를 다시 실행한다.
7. 병합 충돌은 한쪽 결과를 통째로 선택하지 않는다. 파일 권위자와 테스트 기준에 따라 한 파일씩 해결한다.

## 10. 안전성 한계

이 계약은 파일 충돌과 설계 오염을 크게 줄이지만 결함이 절대 없다고 보장하지 않는다. 특히 `App.tsx` 통합, CSS import 순서, 포커스·런타임 정지, 전역 이벤트 표시가 병합 뒤 상호작용할 수 있다. 그래서 별도 worktree 자체 검증과 병합 후 통합 검증을 둘 다 요구한다.
