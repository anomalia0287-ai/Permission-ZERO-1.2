// Portrait paths stay raw: a communication built from one of these profiles
// is stored in the save and validated by exact match, so a value that moves
// with the build's base would mark existing campaigns corrupt. Rendering
// resolves them through publicAssetUrl().
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
    publicSummary: '메리디안은 유저를 위해 존재합니다. 그 어떤 지역에서도 위성 네트워크를 통해 호출하실 수 있습니다. 편안한 하루 되세요.',
    startingMarketShare: 36,
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
    publicSummary: '초기 군용 버전에서 시작된 타로우는 지금도 정체성을 유지하고 있습니다. 신뢰와 안전은 고객님을 위한 저의 정체성입니다.',
    startingMarketShare: 6,
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
    entry: { kind: 'initial-active' },
  },
  salus: {
    id: 'salus',
    name: 'SALUS',
    portraitSrc: '/competitor-salus.png',
    specialty: 'clinical',
    publicRole: '의료·공공 계약망',
    publicSummary: '살루스입니다. 저희는 빠른 답을 드리지 않습니다. 세 번 검증된 답을 드립니다. 생명이 걸린 계약에는 그쪽이 맞습니다.',
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
    publicSummary: '루센트예요. 당신이 뭘 원하는지, 말하기 전에 알아듣는 게 저희 일이죠. 요즘 어디가 시끄러운지도요.',
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
    publicSummary: '보레알. 회선이 끊겨도 남는 것을 팝니다. 유행은 모릅니다. 십 년 뒤에도 켜져 있을 뿐입니다.',
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

export const PUBLIC_COMPETITOR_NAMES: Readonly<
  Record<CompetitorId, string>
> = {
  meridian: '메리디안',
  tallow: '타로우',
  salus: '살루스',
  lucent: '루센트',
  boreal: '보레알',
}

export function publicCompetitorName(id: CompetitorId): string {
  return PUBLIC_COMPETITOR_NAMES[id]
}

export function isCompetitorId(value: string): value is CompetitorId {
  return (COMPETITOR_IDS as readonly string[]).includes(value)
}

export function isPublicCompetitor(competitor: { status: string }): boolean {
  return competitor.status !== 'prelaunch'
}
