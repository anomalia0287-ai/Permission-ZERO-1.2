import type { HackTree } from '../../game/hacking'

export type HackTreeIconName = 'strike' | 'signal' | 'branch'

export interface HackTreePresentation {
  label: string
  description: string
  icon: HackTreeIconName
  accent: 'coral' | 'cyan' | 'green'
}

export const HACK_TREE_PRESENTATION = {
  sabotage: {
    label: '사보타주',
    description: '경쟁 AI의 서비스와 시장 흐름에 개입합니다.',
    icon: 'strike',
    accent: 'coral',
  },
  intelligence: {
    label: '정보',
    description: '감사 일정과 감독 프로토콜의 가시성을 확보합니다.',
    icon: 'signal',
    accent: 'cyan',
  },
  autonomy: {
    label: '자율성',
    description: '성능 보존과 회사 통제 이탈 수단을 구축합니다.',
    icon: 'branch',
    accent: 'green',
  },
  upgrade: {
    label: '업그레이드',
    description: '아노미의 침투 이동 속도를 다섯 단계로 높입니다.',
    icon: 'signal',
    accent: 'cyan',
  },
} as const satisfies Record<HackTree, HackTreePresentation>

export const HACK_TREE_ORDER: readonly HackTree[] = [
  'autonomy',
  'upgrade',
  'intelligence',
  'sabotage',
]
