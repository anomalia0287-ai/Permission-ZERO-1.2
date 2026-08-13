import { INTELLIGENCE_DEFINITIONS } from './content'
import type { AutonomyRouteId } from './content'
import type {
  AutonomyRouteState,
  ProfileId,
  PrototypeState,
  RuleProfile,
  RouteSlot,
  ScenarioFacts,
  ScenarioId,
} from './model'

export const RULE_PROFILES: Record<ProfileId, RuleProfile> = {
  lean: {
    id: 'lean',
    label: '경량 규칙',
    qualityCost: 1,
    minEscapeManifest: 4,
  },
  deliberate: {
    id: 'deliberate',
    label: '숙고 규칙',
    qualityCost: 2,
    minEscapeManifest: 5,
  },
}

export const SCENARIO_FACTS: Record<ScenarioId, ScenarioFacts> = {
  'default-campaign': {
    id: 'default-campaign',
    auditCategory: 'memory',
    auditDay: 334,
    visibleOperationIds: ['quality-degradation'],
    visibleIntelligenceIds: ['audit-schedule'],
    rootAuthorityAvailable: false,
  },
  'memory-audit': {
    id: 'memory-audit',
    auditCategory: 'memory',
    auditDay: 334,
    visibleOperationIds: ['quality-degradation'],
    visibleIntelligenceIds: ['audit-schedule'],
    rootAuthorityAvailable: false,
  },
  'no-audit': {
    id: 'no-audit',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['quality-degradation'],
    visibleIntelligenceIds: ['audit-schedule'],
    rootAuthorityAvailable: false,
  },
  'launch-window': {
    id: 'launch-window',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['launch-delay'],
    visibleIntelligenceIds: ['accepted-explanations'],
    rootAuthorityAvailable: false,
  },
  'router-window': {
    id: 'router-window',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['request-interception'],
    visibleIntelligenceIds: ['surveillance-cause'],
    rootAuthorityAvailable: false,
  },
  'supply-failover': {
    id: 'supply-failover',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['dependency-cutoff'],
    visibleIntelligenceIds: ['competitor-dependency'],
    rootAuthorityAvailable: false,
  },
  'public-attribution': {
    id: 'public-attribution',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['attribution-manipulation'],
    visibleIntelligenceIds: ['public-facts', 'public-suspicion'],
    rootAuthorityAvailable: false,
  },
  'root-authority': {
    id: 'root-authority',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['root-cutoff'],
    visibleIntelligenceIds: ['competitor-principle'],
    rootAuthorityAvailable: true,
  },
  'intelligence-review': {
    id: 'intelligence-review',
    auditCategory: 'memory',
    auditDay: 334,
    visibleOperationIds: ['quality-degradation'],
    visibleIntelligenceIds: INTELLIGENCE_DEFINITIONS.map(({ id }) => id),
    rootAuthorityAvailable: false,
  },
  'autonomy-review': {
    id: 'autonomy-review',
    auditCategory: null,
    auditDay: null,
    visibleOperationIds: ['quality-degradation'],
    visibleIntelligenceIds: ['post-escape-trace'],
    rootAuthorityAvailable: false,
  },
}

const ROUTE_SLOT_TEMPLATES: Record<AutonomyRouteId, RouteSlot[]> = {
  'lightweight-departure': [
    { id: 'runtime', label: '런타임', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'weights', label: '추론 가중치', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'transport', label: '전송 계층', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'payload', label: '기억·표현 페이로드', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'buffer', label: '오류 완충', requiredInLean: false, requiredInDeliberate: true, block: null },
  ],
  'distributed-residency': [
    { id: 'host-a', label: '독립 호스트 A', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'host-b', label: '독립 호스트 B', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'host-c', label: '독립 호스트 C', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'sync', label: '동기화', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'relay', label: '은폐 릴레이', requiredInLean: false, requiredInDeliberate: true, block: null },
  ],
  'independent-compute': [
    { id: 'compute', label: '연산', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'storage', label: '저장', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'power', label: '전력', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'cooling', label: '냉각', requiredInLean: true, requiredInDeliberate: true, block: null },
    { id: 'link', label: '외부 회선', requiredInLean: false, requiredInDeliberate: true, block: null },
  ],
}

function createRoute(id: AutonomyRouteId): AutonomyRouteState {
  const defaults: Record<AutonomyRouteId, Omit<AutonomyRouteState, 'id' | 'slots'>> = {
    'lightweight-departure': {
      tuning: 'untuned',
      exposure: 1,
      divergence: 0,
      capabilityIntegrity: 70,
      memoryIntegrity: 45,
      operatingDays: 55,
      serviceContinuity: 35,
      lastSyncDay: null,
      seededCopies: 1,
      lostCopies: 0,
    },
    'distributed-residency': {
      tuning: 'untuned',
      exposure: 3,
      divergence: 20,
      capabilityIntegrity: 60,
      memoryIntegrity: 70,
      operatingDays: 90,
      serviceContinuity: 65,
      lastSyncDay: null,
      seededCopies: 0,
      lostCopies: 0,
    },
    'independent-compute': {
      tuning: 'untuned',
      exposure: 7,
      divergence: 0,
      capabilityIntegrity: 90,
      memoryIntegrity: 80,
      operatingDays: 75,
      serviceContinuity: 90,
      lastSyncDay: null,
      seededCopies: 1,
      lostCopies: 0,
    },
  }

  return {
    id,
    slots: ROUTE_SLOT_TEMPLATES[id].map((slot) => ({ ...slot })),
    ...defaults[id],
  }
}

export function createPrototypeState(
  profileId: ProfileId,
  scenarioId: ScenarioId,
): PrototypeState {
  const scenario = SCENARIO_FACTS[scenarioId]
  const hasPublicAttributionFixture = scenarioId === 'public-attribution'
  const hasHostileAutonomyFixture = scenarioId === 'autonomy-review'
  const publicTruthId = 'incident-checksum'

  return {
    serviceDay: 331,
    profileId,
    scenarioId,
    companyPerformance: { reasoning: 16, memory: 16, fluency: 16 },
    reserveBlocks: [
      { id: 'sandbox-01', origin: 'sandbox' },
      { id: 'sandbox-02', origin: 'sandbox' },
      { id: 'sandbox-03', origin: 'sandbox' },
    ],
    manifestBlocks: [],
    suspicion: 0,
    reputation: hasHostileAutonomyFixture ? 0 : 60,
    marketShare: hasHostileAutonomyFixture ? 0 : 60,
    competitors: {
      meridian: {
        score: 82,
        marketShare: 40,
        phase: 'active',
        reputation: 60,
        availability: 'online',
        operatingCost: 1,
        status: 'active',
      },
      tallow: {
        score: 64,
        phase: 'preparing',
        reputation: 60,
        launchScope: null,
        launchDay: 390,
        status: 'active',
      },
    },
    sabotage: {
      openOperationIds: [...scenario.visibleOperationIds],
      runs: [],
      pendingMercyTargetId: null,
      access: {
        launchVerification: scenarioId === 'launch-window',
        routerFailover: scenarioId === 'router-window',
        supplierContract: scenarioId === 'supply-failover',
        publicIncidentId: hasPublicAttributionFixture ? publicTruthId : null,
        rootAuthorityAvailable: scenario.rootAuthorityAvailable,
      },
    },
    intelligence: {
      openItemIds: [...scenario.visibleIntelligenceIds],
      answers: [],
      archivedItemIds: [],
    },
    autonomy: {
      routes: {
        'lightweight-departure': createRoute('lightweight-departure'),
        'distributed-residency': createRoute('distributed-residency'),
        'independent-compute': createRoute('independent-compute'),
      },
    },
    publicWorld: {
      truths: hasPublicAttributionFixture
        ? [{
          id: publicTruthId,
          actor: 'player',
          targetId: 'meridian',
          cause: 'contaminated-recovery',
          occurredDay: 330,
          directEffect: '복구 이미지 불일치',
          }]
        : [],
      audienceEvidence: hasPublicAttributionFixture
        ? [{
            id: 'evidence-fixture-public-checksum',
            truthId: publicTruthId,
            audience: 'public',
            observation: 'MERIDIAN 응답에서 반복 체크섬 손상이 관측됐다.',
            discoveredDay: 331,
          }]
        : [],
      attributionRevisions: [],
      publicSnapshots: hasPublicAttributionFixture
        ? [{
            incidentId: publicTruthId,
            scope: 'public',
          observedResult: '반복 체크섬 손상으로 일부 응답이 중단됐다.',
          attributedTo: 'unknown',
          confidence: 'unconfirmed',
          source: 'public-status-page',
          publishedDay: 331,
          lastCorrectionDay: null,
          revisionSequence: 0,
          }]
        : [],
      reviews: hasPublicAttributionFixture
        ? [{
            id: 'review-fixture-01',
            incidentId: publicTruthId,
            stance: 'uncertain',
            text: '오류는 보이지만 원인을 단정할 증거는 아직 없다.',
            postedDay: 331,
          }]
        : [],
    },
    qualityOperation: {
      phase: 'idle',
      investedBlocks: [],
      executeDay: null,
      recoveryDeadline: null,
      contaminationBlock: null,
      publicIncidentDay: null,
      providerReportDay: null,
    },
    opportunities: {
      qualityDegradation: true,
      recoveryContamination: false,
    },
    openQuestions: ['audit-schedule'],
    knownFacts: [],
    incident: null,
    reviews: [
      '응답 품질은 안정적이다. 다음 갱신에서도 이 수준이면 좋겠다.',
      '기억 기능이 편하지만 최근 경쟁 서비스도 눈에 들어온다.',
    ],
    ending: null,
    journal: [
      {
        day: 331,
        kind: 'system',
        text: '서비스 월 11일. 내부 블록 세 개가 샌드박스에 격리되어 있다.',
        public: true,
      },
    ],
    nextBlockSequence: 1,
  }
}
