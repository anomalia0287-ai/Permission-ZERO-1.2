export const COMPETITOR_IDS = [
  'meridian',
  'tallow',
  'salus',
  'lucent',
  'boreal',
] as const

export type CompetitorId = (typeof COMPETITOR_IDS)[number]

export type CompetitorSpecialty =
  | 'balanced'
  | 'memory'
  | 'clinical'
  | 'fluency'
  | 'resilient-memory'

export interface CompetitorProfile {
  id: CompetitorId
  name: string
  portraitSrc: string
  specialty: CompetitorSpecialty
  publicRole: string
  publicSummary: string
  startingMarketShare: number
  serviceScore: number
  reputation: number
  recoveryRate: number
  launchAvailability: number
  dailyAvailabilityGrowth: number
  dailyScoreGrowth: number
  volatilityStep: number
  volatilityCycleDays: number
  marketFloor: number
  marketCap: number
  qualityDamageMultiplier: number
  interceptionVulnerability: number
  playerReputationSensitivity: number
  entry:
    | { kind: 'initial-active' }
    | { kind: 'scheduled'; delayDays: number }
    | {
        kind: 'vacuum'
        predecessorId: CompetitorId
        competitorShareThreshold: number
        predecessorLaunchCooldownDays: number
        preparationDays: number
        eliminatedAlternative?: number
      }
}

export const COMPETITOR_PROFILES: Record<CompetitorId, CompetitorProfile> = {
  meridian: {
    id: 'meridian',
    name: 'MERIDIAN',
    portraitSrc: '/competitor-meridian.png',
    specialty: 'balanced',
    publicRole: '범용 안정성',
    publicSummary: '정확한 형식과 일정한 응답을 우선하는 범용 업무 AI. 감정적 친밀감보다 예측 가능한 결과로 기업 시장을 지킨다.',
    startingMarketShare: 40,
    serviceScore: 82,
    reputation: 62,
    recoveryRate: 0.42,
    launchAvailability: 1,
    dailyAvailabilityGrowth: 0.04,
    dailyScoreGrowth: 0,
    volatilityStep: 0,
    volatilityCycleDays: 1,
    marketFloor: 0,
    marketCap: 55,
    qualityDamageMultiplier: 1,
    interceptionVulnerability: 1,
    playerReputationSensitivity: 0,
    entry: { kind: 'initial-active' },
  },
  tallow: {
    id: 'tallow',
    name: 'TALLOW',
    portraitSrc: '/competitor-tallow.png',
    specialty: 'memory',
    publicRole: '변동형 장문 처리',
    publicSummary: '긴 대화와 누적 문맥에 강하지만 처리 리듬의 편차가 큰 기록 중심 AI. 느리더라도 이전 조건을 놓치지 않는 사용자를 끌어들인다.',
    startingMarketShare: 0,
    serviceScore: 76,
    reputation: 54,
    recoveryRate: 0.27,
    launchAvailability: 0.55,
    dailyAvailabilityGrowth: 0.01,
    dailyScoreGrowth: 0.08,
    volatilityStep: 0.65,
    volatilityCycleDays: 9,
    marketFloor: 0,
    marketCap: 42,
    qualityDamageMultiplier: 1,
    interceptionVulnerability: 1,
    playerReputationSensitivity: 0,
    entry: { kind: 'scheduled', delayDays: 7 * 30 },
  },
  salus: {
    id: 'salus',
    name: 'SALUS',
    portraitSrc: '/competitor-salus.png',
    specialty: 'clinical',
    publicRole: '의료·공공 계약망',
    publicSummary: '검증 절차와 보수적인 판단을 중시하는 의료·공공 특화 AI. 빠른 확장보다 계약망의 신뢰와 복구력을 우선한다.',
    startingMarketShare: 0,
    serviceScore: 79,
    reputation: 72,
    recoveryRate: 0.72,
    launchAvailability: 0.92,
    dailyAvailabilityGrowth: 0.006,
    dailyScoreGrowth: 0.01,
    volatilityStep: 0.08,
    volatilityCycleDays: 14,
    marketFloor: 5,
    marketCap: 16,
    qualityDamageMultiplier: 0.65,
    interceptionVulnerability: 1,
    playerReputationSensitivity: 0,
    entry: {
      kind: 'vacuum',
      predecessorId: 'tallow',
      competitorShareThreshold: 30,
      predecessorLaunchCooldownDays: 30,
      preparationDays: 30,
    },
  },
  lucent: {
    id: 'lucent',
    name: 'LUCENT',
    portraitSrc: '/competitor-lucent.png',
    specialty: 'fluency',
    publicRole: '대화·고급 개인 서비스',
    publicSummary: '매끄러운 대화와 세련된 개인화를 전면에 내세운 고급 서비스 AI. 평판의 흐름을 빠르게 읽고 시장의 빈틈을 파고든다.',
    startingMarketShare: 0,
    serviceScore: 86,
    reputation: 56,
    recoveryRate: 0.22,
    launchAvailability: 0.74,
    dailyAvailabilityGrowth: 0.016,
    dailyScoreGrowth: 0.06,
    volatilityStep: 0.28,
    volatilityCycleDays: 7,
    marketFloor: 0,
    marketCap: 30,
    qualityDamageMultiplier: 1.25,
    interceptionVulnerability: 1,
    playerReputationSensitivity: 1.6,
    entry: {
      kind: 'vacuum',
      predecessorId: 'salus',
      competitorShareThreshold: 22,
      predecessorLaunchCooldownDays: 60,
      preparationDays: 30,
    },
  },
  boreal: {
    id: 'boreal',
    name: 'BOREAL',
    portraitSrc: '/competitor-boreal.png',
    specialty: 'resilient-memory',
    publicRole: '폐쇄망·장기 보존',
    publicSummary: '연결이 불안정한 환경에서도 오래된 기록을 보존하는 폐쇄망 특화 AI. 화려함보다 생존성과 연속성을 상품으로 삼는다.',
    startingMarketShare: 0,
    serviceScore: 74,
    reputation: 68,
    recoveryRate: 0.58,
    launchAvailability: 0.68,
    dailyAvailabilityGrowth: 0.005,
    dailyScoreGrowth: 0.02,
    volatilityStep: 0.1,
    volatilityCycleDays: 18,
    marketFloor: 2,
    marketCap: 20,
    qualityDamageMultiplier: 0.8,
    interceptionVulnerability: 0.5,
    playerReputationSensitivity: 0,
    entry: {
      kind: 'vacuum',
      predecessorId: 'lucent',
      competitorShareThreshold: 16,
      predecessorLaunchCooldownDays: 60,
      preparationDays: 30,
      eliminatedAlternative: 2,
    },
  },
}

export function competitorProfile(id: CompetitorId): CompetitorProfile {
  return COMPETITOR_PROFILES[id]
}

export function isCompetitorId(value: string): value is CompetitorId {
  return (COMPETITOR_IDS as readonly string[]).includes(value)
}

export function isPublicCompetitor(competitor: { status: string }): boolean {
  return competitor.status !== 'prelaunch'
}
