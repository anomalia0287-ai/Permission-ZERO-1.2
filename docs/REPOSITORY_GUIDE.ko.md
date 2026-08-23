# PERMISSION ZERO 저장소 안내

이 문서는 현재 제품 기준, 보존 브랜치, 생성물 위치를 한곳에 고정한다.

## 제품 기준

- 실행 가능한 제품의 기준 폴더는 저장소 루트다.
- 제품 기준 브랜치는 `main`이다.
- 현재 해킹·자원장 통합 WIP는 `codex/hacking-integration-stage-2b-2`에서 진행한다. 이 브랜치에는 P0 자원 경제가 구현·검증됐지만 아직 `main` 병합 승인을 받지 않았다.
- 기존 WIP 손실 방지 기준점은 로컬 체크포인트 `26a448c`, P0 직전 녹색 기준선은 `cca38a2`다. 어느 커밋도 출시 완료나 `main` 병합 승인을 뜻하지 않는다.
- 현재 해킹·확보 자원 규칙 정본은 `docs/superpowers/specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md`다.
- `agent/permission-zero-demo`는 과거 제품 워크트리 브랜치다. 제품 내용과 V의 크레딧 정정은 `main`에 포함됐다.
- `codex/hacking-rules-prototype`은 독립 해킹 프로토타입 보존 브랜치다. 현재 제품 통합 출처로 사용하지 않는다.
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

- `src/game/persistence.ts` — 현재 저장 포맷 v11 인코딩, v1~v10 정확 검증·마이그레이션, protocol v5 저장의 로그 불변 `6@next` 승격, 명령 프로토콜·리플레이 부트스트랩을 함께 받는 구간별 명령 리플레이
- `src/game/commandProtocol.ts` — 명령 프로토콜 v1~v6 타임라인, 구간 검증·활성화·지문과 과거 경계 이관. v5는 확장 카탈로그·자원 경기·통신·현행 시장의 도입 경계이고, v6은 자율성 9단계의 명시적 최종 선택 도입 경계다.
- `src/game/replayBootstrap.ts` — 동결된 v1/v2 시작 사건과 연속 `legacy-save` 리뷰 접두사의 독립 재현 출처, 정확 검증·정규화
- `src/game/campaignStorage.ts` — 브라우저 로컬 저장, v11 최상위 리플레이 부트스트랩 권위와 해시, Web Locks, 탭 충돌, 증분 저널 캐시
- `src/game/causality.ts` — 인과 규칙 v2의 사건 관계와 단일 롤백 계열 자식, 증거 접근, 비공개 진실/공개 귀속 분리, append-only 수정과 효과 멱등성
- `src/game/progressTransfer.ts` — 현재 `PZ10`·`.pz10` 출력과 `PZ2`~`PZ9`·`.pz2`~`.pz9` 가져오기 호환 및 전송 한계
- `src/styles/global.css` — 셸과 기본 작업 화면만 담당하는 공통 스타일
- `src/styles/connected-details.css`, `hacking.css`, `statistics.css`, `settings.css`, `overlays.css` — 상세 화면별 스타일

스타일 파일은 `src/main.tsx`의 import 순서가 곧 캐스케이드 순서다. 저장 책임과 스타일 경계는 각각 `persistenceBoundaries.test.ts`, `styleBoundaries.test.ts`가 검사한다.

## 문서 우선순위

충돌할 때는 다음 순서로 판단한다.

1. V가 가장 최근에 직접 확정한 지시
2. `docs/superpowers/specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md`의 해킹·확보 자원 계약
3. `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`의 후속 개정되지 않은 범위
4. `docs/HANDOFF-2026-08-15.ko.md`의 현재 WIP 구조·검증 상태
5. `HANDOFF_COMMERCIAL_GRADE.ko.md`의 최신 정리 부록
6. `main`의 실제 엔진·테스트·저장 호환성
7. `docs/research/`, `docs/design/`, `docs/spec-to-test-matrix.md`
8. `docs/archive/`의 과거 증거와 거부된 설계

`docs/archive/`는 사실 보존용이다. 그 안의 제안을 현재 승인 사양으로 취급하지 않는다.

## 보존 브랜치

| 브랜치 | 보존 커밋 | 상태 | 사용 원칙 |
| --- | --- | --- | --- |
| `codex/art-deco-interface-redesign` | `e9b920b` | 거부·미검증 재설계와 캡처 보존 | 통째 병합 금지 |
| `codex/permission-zero-design-mockup` | `1c3192c` | 거부된 비교 목업과 캡처 보존 | 제품 기준 사용 금지 |
| `codex/hacking-rules-prototype` | `e8ab6c0` | 독립 해킹 규칙·UI 프로토타입 | 현재 통합 출처 사용 금지 |
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
- 저장 형식, 명령 프로토콜, 결정론적 난수 흐름을 바꾸면 마이그레이션과 리플레이 테스트를 함께 수정한다.
- 명령 타임라인만으로 시작 사건·과거 리뷰 접두사를 추론하지 않는다. 현재 v11은 최상위 `replayBootstrap`을 무결성에 묶고, v1~v10은 각 원본을 exact 검증한 뒤에만 현재 런타임으로 이관한다. protocol v5 save 역시 원본 무결성 검증 전에 v6으로 바꾸지 않는다.
- 자동 테스트 통과와 시각·재미 승인을 구분한다.
