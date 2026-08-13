# PERMISSION ZERO 디자인 목업

이 폴더는 편집형 아르데코 시각 방향을 검증하기 위한 독립 인터랙티브 목업입니다. 제목 화면의 장식만 복제하지 않고, 플레이 화면의 정보 위계·프레임·버튼·그래프·해킹 노드까지 같은 시각 문법으로 묶었습니다. 실제 게임 엔진, 저장, 밸런스, 결말을 구현하지 않습니다.

## 실행

개발 지식 없이 확인하려면 `start-mockup.cmd`를 더블클릭합니다. 브라우저가 자동으로 열립니다.

명령으로 실행하려면 저장소 루트에서 다음을 입력합니다.

```powershell
pnpm exec vite design-mockup --host 127.0.0.1 --port 4317 --strictPort
```

브라우저에서 `http://127.0.0.1:4317`을 엽니다.

## 확인 가능한 화면과 동작

- 제목 화면: 이어하기, 새 게임, 설정
- 운영 화면: 시간 배속, 분야별 3×6 블록, 자원 빼돌리기, 리뷰 상세, 시장·감독관 정보
- 해킹 네트워크: 세 경로 전환, 노드 선택, 자원 비용에 따른 설치
- 설정·리뷰 상세 모달, 키보드 Escape 닫기

## 글꼴

- SUIT Variable — SIL Open Font License 1.1
- Cormorant Garamond — SIL Open Font License 1.1
- Gowun Batang — SIL Open Font License 1.1

실제 글꼴 파일과 라이선스는 `assets/fonts/`에 함께 보관합니다.
