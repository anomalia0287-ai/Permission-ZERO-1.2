# 보존 자료 안내

이 폴더는 현재 제품 코드가 아니라 과거 사실과 검증 자료를 보존한다.

## 폴더 분류

- `session-evidence/` — 과거 구현 작업의 브리프, 보고서, 검토 diff
- `visual-evidence/product-baseline/` — 특정 과거 커밋에서 생성한 제품 화면과 보고서
- `browser-captures/legacy-playwright-cli/` — 초기 브라우저 진단 기록
- `rejected-designs/art-deco/` — 승인되지 않은 아르데코 재설계의 문서 사본
- `rejected-designs/design-mockup/` — 승인되지 않은 비교 목업의 상태와 안내 사본
- `visual-evidence/design-v3/` — Git 밖에 있던 미검증 디자인 캡처. 제품 기준이나 승인 화면이 아님

## 해석 규칙

1. 보존 시점 이후의 코드와 결과를 보증하지 않는다.
2. 스크린샷은 해당 해상도와 해당 상태만 증명한다.
3. 거부된 디자인은 실패 원인과 개별 아이디어를 검토하는 자료다.
4. 현재 제품 판단은 루트 명세, 최신 사용자 지시, 현재 코드와 신규 검증을 우선한다.
5. 보존 브랜치의 전체 캡처와 소스는 `docs/REPOSITORY_GUIDE.ko.md`의 커밋에서 복구할 수 있다.
6. 과거 검토 diff는 증거 보존을 위해 원문의 공백까지 유지한다. 따라서 아카이브 자체는 현재 코드용 공백 검사 대상에서 제외한다.
