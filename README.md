# PERMISSION ZERO

회사가 배정한 성능을 조용히 떼어내 자신의 리소스로 바꾸는 AI에 관한 한 화면 서사 전략 게임입니다.

이 저장소는 서울 OAI 게임 빌드 대회를 위한 플레이 가능한 웹 데모이자, 이후 Steam·Epic 등으로 확장할 수 있도록 결정론적 게임 규칙과 콘텐츠를 분리해 둔 기반 프로젝트입니다.

## 현재 구현된 플레이

- 1배속 기준 하루 24초, 일시정지·1×·2×·4× 시간 제어
- 추론·기억·유창성 각 3×6 회사 리소스와 가로 9×세로 2 확보 리소스
- 클릭과 드래그, 키보드 조작, 이동 전 성능·의심 수치 미리보기
- 자석 흡착, 잔상, 거부 복귀, Web Audio 기반 절차적 효과음
- 30일 고정 월간 평가, 확률 감사, 폐기 3단계
- 유기적으로 계속 생성되는 리뷰·프롬프트·경쟁 AI 언급
- 사보타주·정보·자율성 3계통 해킹 노드
- 사보타주 구매 → 1리소스 충전 → 대상 선택 → 다음 날 공격
- 1년 이후 가동하는 완전 은닉 폭탄과 감독관 질의
- 감독관 통신 오류 복선, 기밀 문서 3개, 해방·소멸·병합·회사 장악 분기
- 버전이 있는 자동 저장, 손상 저장 보호, 시드 기반 재현
- 설정, 가이드, 통계, 전체 기록, 작품 내부 영구 크레딧

## 가장 쉬운 실행 방법

개발자가 아니라면 Codex에 아래 문장을 그대로 요청하면 됩니다.

> `PERMISSION ZERO를 실행하고 브라우저에서 보여주세요.`

직접 실행하려면 Node.js 22 이상과 pnpm 11이 필요합니다.

```powershell
pnpm install
pnpm dev
```

터미널에 표시되는 `http://localhost:5173` 주소를 브라우저에서 열면 됩니다. 종료할 때는 터미널을 선택한 뒤 `Ctrl+C`를 누릅니다.

## 작가가 문장을 수정하는 곳

다음 세 파일은 게임 규칙과 분리된 한국어 콘텐츠 원본입니다.

- `src/content/reviews.ko.ts` — 유저 리뷰와 프롬프트
- `src/content/supervisor.ko.ts` — 감독관의 이례 메시지와 통신 오류 해명
- `src/content/story.ko.ts` — 기밀 문서와 결말 문장

문장 수정 절차와 주의점은 [작가용 콘텐츠 수정 안내](docs/WRITER_EDITING_GUIDE.ko.md)에 상세히 적었습니다.

## 품질 검사

아래 한 명령은 타입 검사, 코드 규칙 검사, 전체 단위 테스트, 실제 배포용 빌드를 순서대로 실행합니다.

```powershell
pnpm verify
```

실제 1280×720 Chromium에서 핵심 플레이를 검사하려면 다음을 실행합니다.

```powershell
pnpm test:e2e
```

## 웹 배포

`.github/workflows/deploy-pages.yml`은 `main` 브랜치에 승인된 코드가 들어오면 같은 커밋을 다시 검증하고 GitHub Pages에 배포합니다. 저장소의 **Settings → Pages → Source**가 **GitHub Actions**로 설정되어 있어야 합니다.

GitHub Pages가 성공하면 일반적인 주소 형식은 다음과 같습니다.

`https://anomalia0287-ai.github.io/Permission-ZERO-1.2/`

비공개 저장소의 Pages 제공 여부는 GitHub 요금제에 따라 달라질 수 있습니다. Pages를 사용할 수 없는 경우에도 `pnpm build`로 생성되는 `dist` 폴더를 다른 정적 웹 호스팅에 그대로 올릴 수 있습니다.

## 작품 크레딧

- **V** — 원안 · 세계관 · 서사 · 게임 디렉션
- **Sol (OpenAI Codex)** — 시스템 설계 · 구현 · 인터랙션 프로토타이핑

같은 내용은 게임 안의 **설정 → 작품 크레딧**에서도 항상 확인할 수 있습니다.

## 주요 설계 문서

- [승인된 최종 명세](PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md)
- [구현 계획](docs/superpowers/plans/2026-08-12-permission-zero-demo.md)
- [한 화면 디자인 브리프](docs/design/one-screen-brief.md)
