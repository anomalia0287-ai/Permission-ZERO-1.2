import type {
  ProfileId,
  PrototypeState,
  RuleProfile,
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
  'memory-audit': {
    id: 'memory-audit',
    auditCategory: 'memory',
    auditDay: 334,
  },
  'no-audit': {
    id: 'no-audit',
    auditCategory: null,
    auditDay: null,
  },
}

export function createPrototypeState(
  profileId: ProfileId,
  scenarioId: ScenarioId,
): PrototypeState {
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
    reputation: 60,
    marketShare: 60,
    competitors: {
      meridian: { score: 82, marketShare: 40, phase: 'active' },
      tallow: { score: 64, phase: 'preparing' },
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
