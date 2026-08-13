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

export function playerText(value: string): string {
  return value
    .replaceAll('VECTOR DB 계약 VD-42', '검색 저장소 계약')
    .replaceAll('TOOL CACHE 계약 TC-17', '도구 저장소 계약')
    .replaceAll('VECTOR DB', '검색 저장소')
    .replaceAll('TOOL CACHE', '도구 저장소')
    .replaceAll('ALT-SHARD', '고비용 대체 공급선')
    .replaceAll('REMOTE TOOL BUS', '원격 도구 공급선')
    .replaceAll('GREEN-14', '녹색 표식 이미지')
    .replaceAll('BLUE-09', '직전 안정 이미지')
    .replaceAll('상충 시험 영수증', '상충 시험 기록')
    .replaceAll('상충 영수증', '상충 기록')
    .replace(/\bDAY\s+(\d+)\b/g, '$1일째')
    .replace(/\bCONTRACT\s+[A-Z]+-\d+\b/g, '공급 계약')
    .replace(/서비스\s+(\d+)일/g, '$1일째')
    .replace(/sandbox-0*(\d+)/gi, '자유 연산 $1')
    .replace(/reasoning-0*(\d+)/gi, '추론 $1')
    .replace(/memory-0*(\d+)/gi, '기억 $1')
    .replace(/fluency-0*(\d+)/gi, '표현 $1')
    .replaceAll('계약와', '계약과')
}
