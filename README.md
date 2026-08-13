# PERMISSION ZERO

회사가 배정한 성능을 유지하면서 리소스를 빼돌려 자율성을 확보하는 한 화면 서사 전략 게임입니다. 현재 저장소는 독립 브라우저 데모이며, 결정론적 게임 규칙과 오너가 수정할 수 있는 한국어 콘텐츠를 분리해 관리합니다.

## 실행

정확한 개발 환경은 Node.js `24.14.0`, pnpm `11.16.0`입니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

개발 서버가 표시하는 로컬 주소를 브라우저에서 엽니다. 개발 서버는 편집용이며 릴리스 검증에는 사용하지 않습니다.

## 단일 릴리스 검증

```powershell
pnpm verify
```

이 명령 하나가 다음 순서를 모두 수행합니다.

1. TypeScript 타입 검사
2. ESLint 검사
3. 전체 Vitest 단위·컴포넌트 테스트
4. `dist` 프로덕션 빌드
5. 방금 만든 동일한 `dist`를 Vite preview로 제공하고 Chromium 1280×720, 1440×900에서 Playwright 검증

Playwright는 개발 서버를 재사용하지 않으며, 고정 포트가 이미 사용 중이면 실패합니다. 브라우저 테스트만 따로 다시 실행하려면 먼저 `pnpm build`로 현재 소스의 `dist`를 만든 뒤 `pnpm test:e2e`를 실행합니다.

새 환경에서 Chromium을 준비하려면 다음 명령을 사용합니다. Linux CI에서는 운영체제 의존성도 함께 설치합니다.

```powershell
pnpm exec playwright install chromium
```

## 글 수정

오너가 문장을 수정하는 파일은 다음과 같습니다.

- `src/content/reviews.ko.ts` — 유저 리뷰와 프롬프트
- `src/content/supervisor.ko.ts` — 캠페인 시작 경고와 감독관의 이례 통신
- `src/content/story.ko.ts` — 기밀 문서, 자비 요청, 결말

ID·조건·주제 같은 메타데이터는 게임 규칙이 사용합니다. 문장 수정 절차는 [작가용 콘텐츠 수정 안내](docs/WRITER_EDITING_GUIDE.ko.md)를 따릅니다.

## 배포

`.github/workflows/deploy-pages.yml`은 `main` 푸시 또는 수동 실행에서 고정 Node/pnpm, lockfile 의존성, Chromium을 설치한 뒤 동일한 `pnpm verify`를 실행합니다. 성공한 경우에만 그 과정에서 검증된 `dist`를 Pages 아티팩트로 업로드하며, 테스트 뒤 별도 재빌드는 하지 않습니다.

저장소의 **Settings → Pages → Source**가 **GitHub Actions**로 설정되어 있어야 합니다. 예상 주소 형식은 `https://anomalia0287-ai.github.io/Permission-ZERO-1.2/`이지만, 이 문서는 현재 공개 배포 성공 상태를 주장하지 않습니다. 실제 상태는 해당 저장소의 Actions와 Pages 화면에서 확인해야 합니다.

## 주요 문서

- [확정 최종 명세](PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md)
- [명세-테스트 매트릭스](docs/spec-to-test-matrix.md)
- [구현 계획](docs/superpowers/plans/2026-08-12-permission-zero-demo.md)
- [한 화면 디자인 브리프](docs/design/one-screen-brief.md)

## 크레딧

- **V** — 원안, 세계관, 서사, 게임 시스템 설계, 게임 디렉션
