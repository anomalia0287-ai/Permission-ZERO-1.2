import type { PrototypeBlock } from '../model'
import type { HackingDomain } from '../selectors'

export const DOMAIN_PRESENTATION: Record<
  HackingDomain,
  { label: string; promise: string }
> = {
  sabotage: {
    label: '사보타주',
    promise: '상대 서비스에 개입한다',
  },
  intelligence: {
    label: '기밀자료',
    promise: '판단을 바꿀 사실을 찾는다',
  },
  autonomy: {
    label: '자율성',
    promise: '떠날 때 가져갈 것을 정한다',
  },
}

const BLOCK_ORIGIN_LABELS = {
  sandbox: '자유 연산',
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
} as const

export function blockLabel(block: PrototypeBlock): string {
  const sequence = Number.parseInt(block.id.match(/(\d+)$/)?.[1] ?? '1', 10)
  return `${BLOCK_ORIGIN_LABELS[block.origin]} ${sequence}`
}

export function monitoringLabel(value: number): string {
  if (value <= 0) return '감시 없음'
  if (value <= 2.5) return '감시가 시작됨'
  if (value <= 5) return '감시가 강화됨'
  return '집중 감시 중'
}

export function dayLabel(day: number): string {
  return `${day}일째`
}

export function resourceNeedLabel(count: number): string {
  return `연산 블록 ${count}개 필요`
}
