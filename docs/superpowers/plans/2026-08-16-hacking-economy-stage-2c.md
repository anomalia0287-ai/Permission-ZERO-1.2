# Stage 2C — 해킹 자원 경제 vNext 구현 경계

- 작성일: 2026-08-16
- 정본: `docs/superpowers/specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md`
- 녹색 기준선: `cca38a2` (`Playwright 60/60`, 전역 브라우저 오류 0)
- 범위: P0 무상한 확보, 분야별 해금 벡터, 미래 노드 은닉, 구 저장·명령 재현
- 상태: **작업 브랜치 구현·자동 검증 완료, `main` 미병합**

## 버전 판정

| 의미 축 | 현행 | Stage 2C |
| --- | ---: | ---: |
| 명령 프로토콜 | v3 | **v4** |
| portable save | v7 | **v8** |
| clipboard/file | PZ7 / `.pz7` | **PZ8 / `.pz8`** |
| 확보 자원 규칙 | 암묵적 18칸 | **resource rules v2** |

명령과 저장 번호를 함께 올리는 이유는 이번 변경이 표시가 아니라 명령 성공 조건과 체크포인트 그래프를 모두 바꾸기 때문이다.

## 명령 경계

1. v1–v3 `DIVERT_BLOCK { destinationCell }`은 당시 18칸 목적지 의미로만 유효하다.
2. v4는 `DIVERT_BLOCK_TO_RESERVE { blockId }`를 사용한다. 목적지 칸, 용량, 빈 셀 검사가 없다.
3. `BEGIN_BLOCK_SEPARATION`은 v2 이후의 직접 분리 경계로 계속 사용하며 v4 전용 명령 직전에도 필요하다.
4. `PURCHASE_HACK`의 payload는 안정 ID 목록을 유지한다.
   - v1–v3: 기존 범용 수량 비용과 첫 `품질 저하` 자동 충전을 그대로 재생한다.
   - v4: 회사 출처 분야별 고정 벡터를 정확히 검사하고, neutral 토큰을 거부하며, 구매와 실행 충전을 분리한다.
5. 사보타주 충전·취소 payload는 유지하되 v4 취소는 슬롯 복귀가 아니라 같은 ID를 무상한 저장고에 다시 추가한다.
6. v3에서 도입한 인과 명령·일일 규칙은 v4에서도 그대로 활성이다.

## 저장 이관

### v8 현재 체크포인트

- `resources.rulesVersion === 2`
- `resources.reserve`는 중복 없는 `BlockId[]`이며 `null`이 없다.
- reserve 블록 위치는 `{ kind: 'reserve' }`이고 `cellIndex`가 없다.
- 사보타주 충전은 원래 슬롯 번호를 저장하지 않는다.
- 명령 프로토콜의 마지막 구간은 v4다.

### v7 이하 입력

1. 각 과거 포맷을 그 포맷의 exact key, 무결성 해시, 18칸 자원 그래프, 명령 버전으로 먼저 검증한다.
2. 검증 전에 필드를 추측하거나 새 규칙으로 과거 구매를 재판정하지 않는다.
3. 검증 뒤 다음 명령 시퀀스에 v4 구간을 추가한다.
4. 고정 reserve 배열에서 `null`만 제거하고 살아 있는 블록의 순서·ID·origin을 보존한다.
5. reserve 위치의 `cellIndex`와 charge의 `originalReserveCell`만 폐기한다.
6. legacy `sandbox`는 삭제하지 않고 neutral 실행 토큰으로 유지한다.
7. 이관 결과는 즉시 v8로 저장할 수 있어야 한다.

## 재생 경계

1. 첫 명령 구간의 프로토콜로 캠페인을 생성한다.
2. v1–v3 구간에서는 기존 시작 sandbox 3개와 고정 18칸 모델을 사용한다.
3. v4 구간이 활성화되는 정확한 시퀀스에서 저장 이관과 동일한 자원 변환을 한 번 적용한다.
4. native v4 캠페인은 빈 확보 목록으로 시작하므로 별도 변환이 없다.
5. decode한 상태와 동일 명령 로그 replay 결과는 v4 경계 뒤 deep-equal이어야 한다.

## UI·정보 경계

- 확보 수량에는 분모, 최대값, 가득 참 상태가 없다.
- 현재 보유는 하나의 포켓 안에서 추론·기억·유창성·neutral 수량을 함께 읽을 수 있다.
- 각 경로는 구매 완료 노드와 현재 최전선 한 단계만 실제 이름·효과·비용으로 렌더한다.
- 이후 단계는 개수와 존재만 알 수 있는 비식별 placeholder이며 실제 이름·효과·비용을 DOM/ARIA에 넣지 않는다.
- 현재 노드는 `추론 a · 기억 b · 유창성 c`를 표시하고, 스테이징도 분야별 충족도를 표시한다.
- 잘못된 분야를 놓는 동작은 상태·명령 로그를 변경하지 않는다.

## 필수 증거

- native 시작 보유 0
- 19번째 이상 전용 성공과 v8 round-trip
- 총량 충분/벡터 불일치 거부, exact 벡터 성공
- neutral 해금 거부와 neutral 실행 충전 성공
- 첫 사보타주 구매 후 미충전, 별도 1토큰 충전
- v3 구매·자동 충전·18칸 리플레이 불변
- v7 strict decode → v4 경계 이관 → v8 resave → replay 일치
- 미래 2단계 이상 이름·효과·비용의 DOM/ARIA 비노출
- 포인터·키보드 전용이 같은 v4 명령과 결과를 생성
- 타입, ESLint, Vitest, build, 두 Playwright 뷰포트 전체 녹색

## 완료 증거

- TypeScript: 통과
- ESLint: 통과
- Vitest: 53개 파일, 1,051개 테스트 통과
- production build: 통과. 기존 500 kB 초과 chunk 경고만 유지
- Playwright: `chromium-1280x720`, `chromium-1440x900` 합계 60/60 통과
- 브라우저 전역 `pageerror`·console error: 0
- 검증 호스트: Node.js `24.19.0`. 선언된 정확한 릴리스 기준 `24.14.0`에서는 최종 병합 전에 재실행 필요
