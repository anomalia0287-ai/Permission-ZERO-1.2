# PERMISSION ZERO 해킹·대사·리뷰 병렬 세션 인수인계

**작성일:** 2026-08-21
**상태:** worktree 준비 후 대기 — 사용자 시작 지시 전 구현 금지
**브랜치:** `codex/hacking-dialogue-review-parallel`
**미리보기 포트:** `4174`

## 임무

이 세션은 다음 세 영역을 한 작성자가 맡는다.

1. 기존 게임 명령과 저장 의미를 보존한 해킹 트리 표현 재설계
2. 감독관·이벤트·관련 대사의 문체와 표시 경험 개선
3. 신규 337개 리뷰의 조건·노출 균형을 포함한 안전한 통합

현재 단계에서는 아무 파일도 수정하지 않는다. 이 문서와 `docs/superpowers/specs/2026-08-21-parallel-work-ownership.ko.md`를 읽고, 사용자가 이 세션에서 명시적으로 시작하라고 지시할 때까지 대기한다.

## 권위 문서와 입력

- 파일 소유권과 병합 계약: `docs/superpowers/specs/2026-08-21-parallel-work-ownership.ko.md`
- 리뷰 원고: `C:\Users\V\.codex\attachments\8fe024b9-5343-441b-810e-dd6f2a0e41e0\pasted-text.txt`
- 현재 게임 보존 계약: `docs/MAINLINE_STATUS.ko.md`

## 절대 경계

- 하위 에이전트를 사용하지 않는다.
- 청록 전투 파일과 `src/audio/**`를 수정하지 않는다.
- `src/game/model.ts`, `reducer.ts`, `persistence.ts`, `story.ts`, `hacking.ts`, `events.ts`를 수정하지 않는다.
- 저장 버전, 캠페인 액션, 해킹 노드 ID·비용·선행 조건, 감독 메시지 큐 구조를 바꾸지 않는다.
- `git add .` 또는 `git add -A`를 사용하지 않는다.
- 포트 `4173`의 전투 미리보기를 종료하지 않는다.

## 시작 뒤 첫 검증

구현을 시작하라는 지시를 받은 뒤에도 먼저 다음 기준 테스트를 실행한다.

```powershell
pnpm exec vitest run src/content/validateContent.test.ts src/game/hacking.test.ts src/game/story.test.ts src/game/reviews.test.ts src/features/hacking/HackingPanel.test.tsx src/features/events/EventLayer.test.tsx src/features/supervisor/SupervisorPanel.test.tsx src/features/reviews/ReviewFeed.test.tsx
```

기준점은 8개 파일, 123개 테스트 통과다. 기준점이 다르면 구현하지 말고 차이를 보고한다.

## 리뷰 통합 필수 조건

- 신규 원고 337개를 단일 평면 배열에 그대로 붙이지 않는다.
- 신규 조건 6개를 공개 경쟁사 상태에서 명시적으로 판정하고 저장 형식을 추가하지 않는다.
- `conditionMatches`에 알 수 없는 조건이 특정 경쟁사 조건으로 처리되는 기본 분기를 남기지 않는다.
- `v-057`, `v-063`은 조건과 화자가 확정될 때까지 활성 풀에서 제외한다.
- 기존 3단계 아크와 상태 반응 콘텐츠가 223개 `universal` 리뷰에 묻히지 않도록 노출 계층과 테스트를 둔다.
- 작성자 말투를 나타내는 의도된 오탈자와 띄어쓰기를 일괄 교정하지 않는다.

## 완료 보고 형식

완료 시 다음을 한 번에 보고한다.

- 커밋 목록과 변경 파일
- 실행한 테스트와 정확한 통과 수
- 4174 브라우저 검증 결과
- 금지 파일을 수정하지 않았다는 diff 증거
- 현재 전투 브랜치로 가져올 커밋과 남은 통합 위험
