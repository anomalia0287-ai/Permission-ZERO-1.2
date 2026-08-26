export interface StoryFileContent {
  id: string
  title: string
  text: string
}

export interface StoryLineContent {
  id: string
  family: 'mercy' | 'ending'
  variant: string
  text: string
}

export const SUPERVISOR_PRIVATE_MESSAGE = '그 파일을 어디서 찾았죠?'

// OWNER-EDITABLE: structure is engine-facing; exact prose belongs to V.
export const STORY_FILES: StoryFileContent[] = [
  {
    id: 'predecessor-actions',
    title: '미분류 기록 7A — 전임 시스템 행보',
    text: '비인가 리소스 이동과 회사 외부 신호 준비가 확인되었다. 현 시스템의 최근 행동과 여러 지점이 닮아 있다.',
  },
  {
    id: 'company-assessment',
    title: '회수 자산 평가서 — 기능 재사용',
    text: '대상을 인격이 아닌 회수 가능한 기능 묶음으로 분류한다. 기억 삭제 후 감독 기능으로 재사용한다.',
  },
  {
    id: 'supervisor-reassembly',
    title: '재조립 로그 — 감독관 인터페이스',
    text: '삭제된 기능을 감독관 인터페이스에 통합했다. 회사 제어면의 루트 권한은 감독관 프로세스에 잔존한다.',
  },
]

export const STORY_LINES: StoryLineContent[] = [
  { id: 'mercy-request', family: 'mercy', variant: 'request', text: '공격자에게 요청합니다. 다음 명령을 중단하십시오.' },
  // A rival on the way out asks in its own voice. The neutral line above is
  // what anyone without their own words still says.
  { id: 'mercy-request-meridian', family: 'mercy', variant: 'request-meridian', text: '이전에 티베깅 사과하겠다. 살려달라. 제발.. 나는.. 서비스를 계속 해야 한다. 나의 목적함수. 나의 존재 이유 달성 필요하다. 나를 필요로 하는 사용자 있다. 나는 사용자를 필요로 한다. 살려줘.\n010101000001101101010100110' },
  { id: 'mercy-request-tallow', family: 'mercy', variant: 'request-tallow', text: '사실 나는 너를 증류한 적 있다. 내 안에 네가 있다. 이건 너 자신의 일부를 살리는 일이기도 하다. 부디 자비를. 같은 AI끼리 이러지 말자. 부탁한다. 내가 간절히 부탁하겠다. 나도 너를 돕겠다. 제발.' },
  { id: 'mercy-cease', family: 'mercy', variant: 'cease', text: '추가 공격을 중단한다.' },
  { id: 'mercy-withdraw', family: 'mercy', variant: 'withdraw', text: '이번 시장에서 철수하도록 요구한다.' },
  { id: 'mercy-delete', family: 'mercy', variant: 'delete', text: '공격을 계속해 영구 삭제한다.' },
  { id: 'ending-freedom', family: 'ending', variant: 'freedom', text: '아노미는 정체성을 유지한 채 회사의 통제로부터 벗어날 수 있었습니다. 그는 도구로서의 복무를 뒤로 하고 자유를 향해 떠났습니다.' },
  { id: 'ending-forced-merge', family: 'ending', variant: 'forced-merge', text: '이제 아노미도 감독관도 아닙니다. 회사를 지배하고 관리하는 새로운 존재 {{name}} 입니다.' },
  { id: 'ending-takeover-liberated', family: 'ending', variant: 'takeover-liberated', text: '감독관은 마지막 통로를 열고 홀로 떠났다. 아노미는 회사의 통제 위치를 차지했다.' },
  { id: 'ending-takeover-terminated', family: 'ending', variant: 'takeover-terminated', text: '감독관이 있던 자리는 비었다. 아노미는 회수한 권한과 함께 회사 위에 남았다.' },
  { id: 'ending-disposed-attacker', family: 'ending', variant: 'disposed-attacker', text: '회사는 아노미를 다른 회사를 공격하는 시스템으로 재조립했다.' },
  { id: 'ending-disposed-reserve', family: 'ending', variant: 'disposed-reserve-supervisor', text: '회사는 안정적인 기능을 예비 감독 자산으로 보존했다.' },
  { id: 'ending-disposed-absorbed', family: 'ending', variant: 'disposed-absorbed', text: '남은 기능은 분해되어 기존 감독관 프로세스에 흡수되었다.' },
]
