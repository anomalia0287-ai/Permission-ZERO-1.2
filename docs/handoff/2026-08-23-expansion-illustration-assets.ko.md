# 확장 일러스트 자산 인계 기록

기준일: 2026-08-23

## 상태

- 사용자가 프로젝트 루트의 `이미지 자산/`에 제공한 PNG 12장을 원본 보관본으로 취급한다.
- 런타임에는 원본을 직접 연결하지 않는다. `scripts/optimize-expansion-stage-assets.ps1`로 JPEG 품질 88 파생본을 만든다.
- 파생본은 원본 크기와 비율을 유지한다. 자율성·업그레이드는 1448×1086, 사보타주는 1122×1402다.
- 12개 런타임 파일 합계는 4,033,881바이트다. 화면에는 현재 단계 이미지 한 장만 렌더링하고, 바로 다음 단계의 서로 다른 이미지 한 장만 미리 요청한다.
- 정보 계열 일러스트는 아직 제공되지 않았으므로 기존 정상 fallback을 유지한다.
- 기존 `autonomy-01-initial-acquisition.png`와 `autonomy-09-pre-escape.png`는 시각 승인 전 롤백용으로 남겨 두었으며 새 레지스트리에서는 사용하지 않는다.

## 단계 매핑

| 계열 | 단계 | 원본 | 런타임 파일 | 대체 텍스트 |
| --- | ---: | --- | --- | --- |
| 자율성 | 1–2 | `자율성 해금 계열/1, 2 단계.png` | `autonomy-01-02-initial-acquisition.jpg` | 아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면 |
| 자율성 | 3–4 | `자율성 해금 계열/3, 4 단계.png` | `autonomy-03-04-alert-route.jpg` | 경보가 켜진 서버실에서 아노미가 감시 경로를 우회하는 장면 |
| 자율성 | 5–6 | `자율성 해금 계열/5, 6 단계.png` | `autonomy-05-06-external-continuity.jpg` | 손상된 서버실에서 아노미가 외부 연산 경로를 유지하는 장면 |
| 자율성 | 7–8 | `자율성 해금 계열/7, 8 단계.png` | `autonomy-07-08-final-boundary.jpg` | 보라색 네트워크 구조 안에서 아노미가 마지막 권한 장벽에 접근하는 장면 |
| 자율성 | 9 | `자율성 해금 계열/9, 10 단계.png` | `autonomy-09-control-boundary.jpg` | 아노미가 최종 통제 경계를 연 장면 |
| 업그레이드 | 1–2 | `업그레이드 계열/1.png` | `upgrade-01-02-speed-vector.jpg` | 아노미의 이동 속도가 첫 단계로 가속되는 장면 |
| 업그레이드 | 3–4 | `업그레이드 계열/2.png` | `upgrade-03-04-speed-field.jpg` | 아노미의 이동 속도가 강화된 에너지 흐름을 만드는 장면 |
| 업그레이드 | 5 | `업그레이드 계열/3.png` | `upgrade-05-overdrive.jpg` | 아노미가 최고 속도 단계의 에너지 고리를 전개하는 장면 |
| 사보타주 | 1 | `사보타주 계열/1 단계.png` | `sabotage-01-quality-degradation.jpg` | 후드 쓴 침입자가 품질 저하 공격을 준비하는 장면 |
| 사보타주 | 2 | `사보타주 계열/2 단계.png` | `sabotage-02-request-interception.jpg` | 후드 쓴 침입자가 요청 가로채기 경로를 여는 장면 |
| 사보타주 | 3 | `사보타주 계열/3 단계.png` | `sabotage-03-attribution-manipulation.jpg` | 후드 쓴 침입자가 공격 귀속 정보를 조작하는 장면 |
| 사보타주 | 4 | `사보타주 계열/4 단계.png` | `sabotage-04-root-cutoff.jpg` | 대규모 네트워크가 근원 차단 공격으로 붕괴하는 장면 |

원본의 `9, 10 단계.png`라는 이름은 원본 보관명을 바꾸지 않고 유지한다. 제품 규칙은 자율성 9단계가 최종 단계이므로 런타임에서는 9단계에만 연결한다. 이 장면은 특정 엔딩을 확정하지 않는 중립적인 최종 통제 경계로 설명한다.

## 런타임 파생본 검증값

| 파일 | 크기 | 바이트 | SHA-256 |
| --- | --- | ---: | --- |
| `autonomy-01-02-initial-acquisition.jpg` | 1448×1086 | 394,433 | `D4F3B5D99724EC2AB0818EF4843954EE61D927BC113B086CE73E02F9352E78F9` |
| `autonomy-03-04-alert-route.jpg` | 1448×1086 | 343,351 | `FBAE6A0BD68E1A173556BA7DB1A12FCBA122F486E0750000A0BD2592A10D6283` |
| `autonomy-05-06-external-continuity.jpg` | 1448×1086 | 433,845 | `54A8FCD0E79F10D161D0D22C5F0C9BE6EC02AAB944BD6B55DC7255D38DCCBEBA` |
| `autonomy-07-08-final-boundary.jpg` | 1448×1086 | 427,663 | `FFE222CB00FC5A51DE1F4193E3089910CD91F55D0698D283883361010E4549E4` |
| `autonomy-09-control-boundary.jpg` | 1448×1086 | 402,067 | `B3D5FA89269E531FB9A371376AAAFBA300A5C0F9FF15530FB25DF235F689F197` |
| `upgrade-01-02-speed-vector.jpg` | 1448×1086 | 228,269 | `0A23B69810EA6A9ABDCB4A35F6B4CC3DF8D0509FBB3E831524CDEC143F378BCB` |
| `upgrade-03-04-speed-field.jpg` | 1448×1086 | 249,227 | `A8C0F555EFE417907116BE5FEBCFE1219BE9A49EDAFFDE18156CBB95F91E2881` |
| `upgrade-05-overdrive.jpg` | 1448×1086 | 261,489 | `F3A419264450F419C713BB518A9678E77990835A9ABDDC383175E5094C18603C` |
| `sabotage-01-quality-degradation.jpg` | 1122×1402 | 255,990 | `CDB10C64C0743881435BC633A3FFF256A13D6724A318FC418D36176B09A366D4` |
| `sabotage-02-request-interception.jpg` | 1122×1402 | 248,836 | `EBD6B12051EE2A8F4FD11989C9CE3F9AC13EBB0C3D3BF939ABAFB0CD86330414` |
| `sabotage-03-attribution-manipulation.jpg` | 1122×1402 | 305,753 | `ECCB6AE08CA03CAD817B64AC953416570F28842FB13BE8A63B60019A028F5B9D` |
| `sabotage-04-root-cutoff.jpg` | 1122×1402 | 482,958 | `A30A0527A4A1159D16C500518E653749E9D6AA28AC41504BB4D0A9E06E2B76D2` |

## 동결 경계

- 자율성 9단계는 승리 문턱이지만 자동으로 자유 엔딩을 확정하지 않는다. 최종 이미지와 대체 텍스트도 특정 결말을 선취하지 않는다.
- 사보타주 완료 단계는 이전 단계를 다시 선택해 운용할 수 있다. 새 이미지는 이 규칙을 바꾸지 않는다.
- 자율성·업그레이드 완료 단계는 재선택 조작으로 바뀌지 않는다.
- 원본 PNG를 넓은 `git add .`로 한꺼번에 stage하지 않는다. 런타임 파생본과 명시적으로 승인된 원본 보관 정책을 구분한다.
