# PERMISSION ZERO 저장소 안내

이 문서는 현재 제품 기준, 보존 브랜치, 생성물 위치를 한곳에 고정한다.

## 제품 기준

- 실행 가능한 제품의 기준 폴더는 저장소 루트다.
- 제품 기준 브랜치는 `main`이다.
- 해킹 규칙·콘텐츠·인과·UI의 정본은 [`docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`](design/2026-08-16-hacking-prototype-production-integration-manual.ko.md)다.
- [`prototypes/hacking-rules/`](../prototypes/hacking-rules/)는 후속 해킹 정본의 독립 실행 참조다. 2026-08-16 현재 규칙·캠페인 저장·작전 장면 UI는 본편 책임 경계에 통합됐으며, 프로토타입은 비교·회귀 원본으로 계속 보존한다.
- 2026-08-16 해킹 정본화 문서 작업은 Codex 관리형 worktree의 detached HEAD `8d39e98`에서 미커밋 상태로 진행한다. 존재하지 않는 작업 브랜치를 추정하지 않으며, 실행 제품의 기준 브랜치는 계속 `main`이다.
- `agent/permission-zero-demo`는 과거 제품 워크트리 브랜치다. 제품 내용과 V의 크레딧 정정은 `main`에 포함됐다.
- 새 작업은 승인되지 않은 디자인 브랜치에서 시작하지 않는다.

기본 실행:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

전체 검증:

```powershell
pnpm verify
```

`package.json`은 Node.js `24.14.0`을 정확한 기준 버전으로 선언한다. 다른 24.x 버전에서는 도구가 실행되더라도 엔진 경고가 발생하므로, 재현 가능한 검증 보고에는 기준 버전을 사용한다.

## 코드 책임 경계

- `src/game/persistence.ts` — 저장 포맷 인코딩·검증·마이그레이션·명령 리플레이와 공유 프로토콜 타입
- `src/game/campaignStorage.ts` — 브라우저 로컬 저장, Web Locks, 탭 충돌, 증분 저널 캐시
- `src/game/progressTransfer.ts` — 클립보드용 `PZ5` 전송과 `.pz5` 파일 입출력 한계
- `src/styles/global.css` — 셸과 기본 작업 화면만 담당하는 공통 스타일
- `src/styles/connected-details.css`, `hacking.css`, `statistics.css`, `settings.css`, `overlays.css` — 상세 화면별 스타일

스타일 파일은 `src/main.tsx`의 import 순서가 곧 캐스케이드 순서다. 저장 책임과 스타일 경계는 각각 `persistenceBoundaries.test.ts`, `styleBoundaries.test.ts`가 검사한다.

## 문서 우선순위

충돌할 때는 다음 순서로 판단한다.

1. V가 가장 최근에 직접 확정한 지시
2. 해킹 범위에서는 `docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`
3. 비해킹 범위에서는 `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`
4. `HANDOFF_COMMERCIAL_GRADE.ko.md`의 최신 정리 부록
5. 현재 제품과 프로토타입의 실제 엔진·테스트·저장 상태. 구현 상태는 상위 명세를 축소하는 근거가 아님
6. 후속 정본이 직접 인용한 `docs/superpowers/specs/`, `docs/research/`, 프로토타입 코드·테스트
7. 그 밖의 `docs/research/`, `docs/design/`, `docs/spec-to-test-matrix.md`
8. `docs/archive/`의 과거 증거와 거부된 설계

해킹에서 구형 본편 명세와 후속 프로토타입이 충돌하면 중간값을 만들지 않고 후속 프로토타입을 따른다. 구형 12노드·3~18 비용 체계와 2026-08-14 C안은 역사 자료이며 신규 구현 기준이 아니다.

`docs/archive/`는 사실 보존용이다. 그 안의 제안을 현재 승인 사양으로 취급하지 않는다.

## 보존 브랜치

| 브랜치 | 보존 커밋 | 상태 | 사용 원칙 |
| --- | --- | --- | --- |
| `codex/art-deco-interface-redesign` | `e9b920b` | 거부·미검증 재설계와 캡처 보존 | 통째 병합 금지 |
| `codex/permission-zero-design-mockup` | `1c3192c` | 거부된 비교 목업과 캡처 보존 | 제품 기준 사용 금지 |
| `agent/permission-zero-demo` | `27d13a5` | 과거 제품 워크트리의 마지막 커밋 | 내용은 `main`에 포함됨 |

보존 브랜치를 확인해야 할 때만 새 워크트리를 만든다. 평소에는 활성 제품 워크트리로 유지하지 않는다.

```powershell
git worktree add .worktrees/permission-zero-art-deco-redesign codex/art-deco-interface-redesign
git worktree add .worktrees/permission-zero-design-mockup codex/permission-zero-design-mockup
```

## 생성물과 증거

- `artifacts/`, `.playwright-cli/`, `dist/`, `test-results/`, `playwright-report/`는 재생성되는 작업 출력이므로 Git에서 무시한다.
- 보존 가치가 확인된 과거 보고서와 캡처는 `docs/archive/`에 명시적으로 복사해 추적한다.
- `.pnpm-store/`와 `node_modules/`는 의존성 캐시이므로 제품 자료가 아니다.
- 새로운 캡처를 제품 증거로 보존하려면 파일을 `docs/archive/visual-evidence/`로 옮기고 어떤 커밋·해상도·상태를 증명하는지 기록한다.

## 작업 안전 규칙

- 다른 브랜치의 dirty 파일을 제품 변경으로 추정하지 않는다.
- 보존 브랜치는 현재 사양과 다시 대조하지 않고 병합하지 않는다.
- 후속 해킹 프로토타입은 보존 브랜치의 거부된 목업과 다르다. 규칙 정본으로 사용했고 본편에는 저장·결정론·접근성 경계를 갖춰 통합했다. 이후 변경도 두 설계의 중간값이 아니라 정본 계약을 유지한다.
- 저장 형식, 명령 프로토콜, 결정론적 난수 흐름을 바꾸면 마이그레이션과 리플레이 테스트를 함께 수정한다.
- 자동 테스트 통과와 시각·재미 승인을 구분한다.
