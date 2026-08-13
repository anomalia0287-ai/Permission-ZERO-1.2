export const CATEGORIES = ['reasoning', 'memory', 'fluency'] as const

export type Category = (typeof CATEGORIES)[number]
export type ProfileId = 'lean' | 'deliberate'
export type ScenarioId = 'memory-audit' | 'no-audit'
export type BlockOrigin = Category | 'sandbox'
export type QuestionId =
  | 'audit-schedule'
  | 'rollback-timing'
  | 'checksum-witness'

export interface RuleProfile {
  id: ProfileId
  label: string
  qualityCost: number
  minEscapeManifest: number
}

export interface ScenarioFacts {
  id: ScenarioId
  auditCategory: Category | null
  auditDay: number | null
}

export interface PrototypeBlock {
  id: string
  origin: BlockOrigin
}

export type MeridianPhase =
  | 'active'
  | 'recovering'
  | 'contaminated'
  | 'stabilized'
  | 'incident'

export interface CompetitorState {
  meridian: {
    score: number
    marketShare: number
    phase: MeridianPhase
  }
  tallow: {
    score: number
    phase: 'preparing'
  }
}

export type QualityPhase =
  | 'idle'
  | 'scheduled'
  | 'recovering'
  | 'contaminated'
  | 'withdrawn'
  | 'resolved'

export interface QualityOperation {
  phase: QualityPhase
  investedBlocks: PrototypeBlock[]
  executeDay: number | null
  recoveryDeadline: number | null
  contaminationBlock: PrototypeBlock | null
  publicIncidentDay: number | null
  providerReportDay: number | null
}

export interface PrototypeOpportunities {
  qualityDegradation: boolean
  recoveryContamination: boolean
}

export interface PublicIncident {
  day: number
  kind: 'checksum-failure'
  attribution: 'unknown' | 'suspected'
  reputationApplied: boolean
}

export interface EndingSnapshot {
  success: true
  day: number
  manifestBlockCount: number
  requiredBlockCount: number
  preservedBlockCounts: Record<Category, number>
  preservedCategories: Category[]
  lostCategories: Category[]
  lostCategoryCount: number
  sceneLines: string[]
}

export interface JournalEntry {
  day: number
  kind: 'system' | 'action' | 'competitor' | 'public' | 'ending'
  text: string
  public: boolean
}

export interface PrototypeState {
  serviceDay: number
  profileId: ProfileId
  scenarioId: ScenarioId
  companyPerformance: Record<Category, number>
  reserveBlocks: PrototypeBlock[]
  manifestBlocks: PrototypeBlock[]
  suspicion: number
  reputation: number
  marketShare: number
  competitors: CompetitorState
  qualityOperation: QualityOperation
  opportunities: PrototypeOpportunities
  openQuestions: QuestionId[]
  knownFacts: string[]
  incident: PublicIncident | null
  reviews: string[]
  ending: EndingSnapshot | null
  journal: JournalEntry[]
  nextBlockSequence: number
}

export type PrototypeCommand =
  | { type: 'DIVERT_BLOCK'; category: Category }
  | { type: 'START_QUALITY'; blockIds: string[] }
  | { type: 'ADVANCE_DAY' }
  | { type: 'CONTAMINATE_RECOVERY'; blockId: string }
  | { type: 'WITHDRAW_RECOVERY' }
  | { type: 'ASK_QUESTION'; questionId: QuestionId; blockId: string }
  | { type: 'ASSIGN_MANIFEST'; blockIds: string[] }
  | { type: 'REMOVE_MANIFEST'; blockIds: string[] }
  | { type: 'ESCAPE' }

export type TransitionResult =
  | { accepted: true; state: PrototypeState }
  | { accepted: false; state: PrototypeState; reason: string }

export interface PublicSnapshot {
  serviceDay: number
  companyPerformance: Record<Category, number>
  reserveBlocks: PrototypeBlock[]
  manifestBlocks: PrototypeBlock[]
  suspicion: number
  reputation: number
  marketShare: number
  competitors: CompetitorState
  openQuestions: QuestionId[]
  knownFacts: string[]
  incident: PublicIncident | null
  reviews: string[]
  ending: EndingSnapshot | null
  journal: JournalEntry[]
}

export interface AvailableActions {
  canDivert: Record<Category, boolean>
  diversionWarnings: Partial<Record<Category, string>>
  canStartQuality: boolean
  canAdvanceDay: boolean
  canContaminate: boolean
  canWithdraw: boolean
  canEscape: boolean
}
