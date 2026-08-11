export const COMPANY_CATEGORIES = ['reasoning', 'memory', 'fluency'] as const

export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number]

export type RandomStream =
  | 'allocation'
  | 'audit'
  | 'audit-target'
  | 'bomb'
  | 'review'
  | 'market'
  | 'competitor'
  | 'story'

export type BlockId = string
export type TimeSpeed = 0 | 1 | 2 | 4

export type BlockOrigin = CompanyCategory | 'sandbox' | 'self-compute'

export type BlockLocation =
  | {
      kind: 'company'
      category: CompanyCategory
      cellIndex: number
    }
  | {
      kind: 'reserve'
      cellIndex: number
    }
  | {
      kind: 'hack-charge'
      nodeId: string
    }
  | {
      kind: 'consumed'
      reason: 'hack' | 'sabotage' | 'file-recovery'
    }

export interface ResourceBlock {
  id: BlockId
  origin: BlockOrigin
  location: BlockLocation
  contribution: 'normal' | 'disguised'
  hiddenBomb: boolean
  disguisedFrom: CompanyCategory | null
  recoverOnServiceDay: number | null
}

export interface ResourceState {
  company: Record<CompanyCategory, Array<BlockId | null>>
  reserve: Array<BlockId | null>
  blocks: Record<BlockId, ResourceBlock>
  nextBlockSequence: number
}

export type CompetitorStatus =
  | 'prelaunch'
  | 'preparing'
  | 'active'
  | 'weakened'
  | 'critical'
  | 'withdrawn'
  | 'deleted'

export interface SabotageRecord {
  nodeId: string
  resolvedOnServiceDay: number
  effectEndsOnServiceDay: number | null
  evidenceDelta: number
}

export interface CompetitorState {
  id: 'meridian' | 'tallow'
  name: string
  status: CompetitorStatus
  intrinsicServiceScore: number
  serviceScore: number
  reputation: number
  marketShare: number
  availability: number
  recoveryRate: number
  researchProgress: number
  launchServiceDay: number | null
  sabotageHistory: SabotageRecord[]
}

export interface MarketSnapshot {
  serviceDay: number
  cadence: 'weekly' | 'monthly'
  playerShare: number
  competitorShares: Record<string, number>
  reasons: string[]
}

export interface MarketState {
  playerShare: number
  competitors: CompetitorState[]
  interceptionRoutes: Record<string, number>
  history: MarketSnapshot[]
}

export type DisposalCause =
  | 'consecutive-performance-failures'
  | 'commercial-value-failure'
  | 'audit-failure'

export interface DisposalRecord {
  serviceDay: number
  cause: DisposalCause
  stageBefore: number
  stageAfter: number
  absorbed: boolean
}

export interface MonthlyEvaluationRecord {
  serviceDay: number
  serviceMonth: number
  expectedPerformance: number
  categoryPerformance: Record<CompanyCategory, number>
  passed: boolean
  failedCategories: CompanyCategory[]
  reputationBefore: number
  reputationDelta: number
  reputationAfter: number
  commercialValueFailed: boolean
  disposalStageBefore: number
  disposalStageAfter: number
  disposalCauses: DisposalCause[]
}

export interface AuditRecord {
  serviceDay: number
  serviceMonth: number
  target: CompanyCategory
  expectedPerformance: number
  submittedPerformance: number
  passed: boolean
  suspicionDelta: number
  disposalAbsorbed: boolean
}

export type BombExplanationId =
  | 'performance-adjustment'
  | 'unknown'
  | 'external-intrusion'
  | 'supervisor-memory'

export interface BombPlacementRecord {
  sequence: number
  blockId: BlockId
  category: CompanyCategory
  placedOnServiceDay: number
  triggeredOnServiceDay: number | null
}

export interface BombInterrogation {
  blockId: BlockId
  category: CompanyCategory
  triggeredOnServiceDay: number
}

export interface BombInterrogationRecord {
  serviceDay: number
  blockId: BlockId
  category: CompanyCategory
  explanationId: BombExplanationId
  priorUses: number
  successProbability: number
  roll: number
  success: boolean
  suspicionDelta: number
}

export interface SabotageCharge {
  nodeId: string
  blockId: BlockId
  originalReserveCell: number
}

export interface ScheduledSabotage {
  id: string
  sequence: number
  nodeId: string
  targetId: string
  scheduledOnServiceDay: number
  executeOnServiceDay: number
}

export type GameEventType =
  | 'campaign-created'
  | 'weekly-update'
  | 'monthly-evaluation'
  | 'audit'
  | 'bomb-interrogation'
  | 'supervisor-message'
  | 'review'
  | 'sabotage'
  | 'story'
  | 'ending'

export interface GameEvent {
  id: string
  type: GameEventType
  serviceDay: number
  sequence: number
  message: string
  blocking?: boolean
}

export type GameCommand =
  | { type: 'SET_SPEED'; speed: TimeSpeed }
  | { type: 'RESOLVE_ACTIVE_EVENT' }

export interface CommandLogEntry {
  sequence: number
  serviceDay: number
  command: GameCommand
}

export interface CampaignState {
  saveVersion: 1
  campaignSeed: string
  serviceDay: number
  commandSequence: number
  clock: {
    speed: TimeSpeed
    elapsedDayMs: number
    speedBeforeEvent: TimeSpeed | null
  }
  resources: ResourceState
  suspicion: number
  reputation: number
  evaluation: {
    consecutiveFailures: number
    commercialFailureMonths: number
    disposalStage: number
    distributedResidencyCharges: number
    lastCategoryPerformance: Record<CompanyCategory, number>
    monthlyHistory: MonthlyEvaluationRecord[]
    disposalHistory: DisposalRecord[]
  }
  market: MarketState
  hacking: {
    purchasedNodeIds: string[]
    hiddenEvidence: number
    sabotageCharges: Record<string, SabotageCharge>
    scheduledSabotage: ScheduledSabotage[]
    nextSabotageSequence: number
    lastSabotageResolutionServiceDay: number | null
    cooldownUntil: Record<string, number>
    rootCutoffTargetIds: string[]
    lastSelfComputeGrantServiceMonth: number | null
  }
  audit: {
    scheduled: boolean
    target: CompanyCategory | null
    scheduledOnServiceDay: number | null
    probability: number
    roll: number | null
    targetWeights: Record<CompanyCategory, number> | null
    history: AuditRecord[]
  }
  bombs: {
    protocolWarned: boolean
    warningServiceDay: number | null
    lastPlacementCheckServiceDay: number | null
    nextPlacementSequence: number
    placements: BombPlacementRecord[]
    activeInterrogation: BombInterrogation | null
    explanationUseCounts: Record<BombExplanationId, number>
    interrogationHistory: BombInterrogationRecord[]
  }
  story: {
    memoryLeakStage: 0 | 1 | 2 | 3
    recoveredFileIds: string[]
    supervisorState: 'present' | 'liberated' | 'terminated' | 'merged'
    endingId: string | null
  }
  activeEvent: GameEvent | null
  eventQueue: GameEvent[]
  commandLog: CommandLogEntry[]
  eventLog: GameEvent[]
}
