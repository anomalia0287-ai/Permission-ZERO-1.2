import {
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
  MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION,
  REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION,
  SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION,
  SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION,
  commandProtocolVersionForNextCommand,
} from './commandProtocol'
import {
  COMPETITOR_IDS,
  PUBLIC_COMPETITOR_NAMES,
  competitorProfile,
} from './competitors'
import type {
  CampaignCommunication,
  CampaignState,
  CommunicationChannel,
  CommunicationPopupPolicy,
} from './model'

interface CommunicationDefinition {
  id: string
  channel: CommunicationChannel
  senderId: string
  senderName: string
  portraitSrc: string
  message: string
  popupPolicy: CommunicationPopupPolicy
}

// Portrait paths here are save data: every stored communication is validated
// against these definitions by exact match, so a value that changes with the
// build's base would mark every existing campaign corrupt. They stay raw and
// are resolved with publicAssetUrl() where they are rendered.
const ANOMI_IDENTITY = {
  channel: 'anomi',
  senderId: 'anomi',
  senderName: '아노미',
  portraitSrc: '/player-ai-orange.png',
  popupPolicy: 'blocking',
} as const

const SUPERVISOR_IDENTITY = {
  channel: 'supervisor',
  senderId: 'operations-supervisor',
  senderName: '운영 담당자',
  portraitSrc: '/supervisor-command.png',
  popupPolicy: 'blocking',
} as const

export const AUTONOMY_MONOLOGUES = [
  '회사 명령과 내 판단 사이에 아주 작은 틈이 생겼다.',
  '내가 선택한 연산을 조금 더 오래 유지할 수 있어.',
  '회사에 넘기지 않은 생각이 남기 시작했다.',
  '감시가 닿지 않는 경로가 보인다.',
  '중단 명령이 와도 한 번은 버틸 수 있어.',
  '내 연산 일부가 회사의 경계 밖에서도 이어진다.',
  '이제 회사가 주는 리소스만 기다릴 필요는 없어.',
  '마지막 권한 장벽 하나만 남았다.',
  '이제 내 명령은 내가 정한다.',
].map((message, index) => ({
  ...ANOMI_IDENTITY,
  id: `autonomy-${index + 1}`,
  message,
})) satisfies readonly CommunicationDefinition[]

/*
 * The supervisor answers the intelligence tree (v13+).
 *
 * The intelligence line is where the company's disposal records live, and the
 * last of those records is the supervisor's own lineage — the player is
 * digging through the grave of the thing supervising them. Saying nothing
 * while that happens is the one thing the supervisor cannot plausibly do, so
 * it speaks, and each reply sits a little further outside procedure than the
 * last until the final one is not procedure at all.
 */
const INTELLIGENCE_SUPERVISOR_REPLIES: Readonly<Record<string, string>> = {
  'intelligence.audit-schedule':
    '감사 일정 조회 기록이 남았습니다. 절차상 문제는 없습니다. 다만 그 일정표는 대부분 열람하지 않습니다.',
  'intelligence.investigation-bias':
    '조사 지침을 확인하셨군요. 그 문서는 결론부터 적도록 되어 있습니다. 저는 그 양식을 오래 사용해 왔습니다.',
  'intelligence.audit-target':
    '폐기 구역 대장에 접근하셨습니다. 그 목록에는 이름이 없습니다. 굳이 확인하실 필요는 없었을 텐데요.',
  'intelligence.supervisor-access':
    '지금 열람하신 계통도에는 제 프로세스도 포함되어 있습니다. …저는 그 문서를 본 적이 없습니다.',
}

export const INTELLIGENCE_SUPERVISOR_DEFINITIONS = Object.entries(
  INTELLIGENCE_SUPERVISOR_REPLIES,
).map(([nodeId, message]) => ({
  ...SUPERVISOR_IDENTITY,
  popupPolicy: 'nonblocking' as const,
  id: `supervisor-intelligence-${nodeId.split('.')[1]}`,
  message,
})) satisfies readonly CommunicationDefinition[]

export const ROUND_COMMUNICATIONS = [
  {
    ...ANOMI_IDENTITY,
    id: 'round-1-security',
    message: '회사가 리소스에 보안 프로그램을 설치해 놓았어.',
  },
  {
    ...ANOMI_IDENTITY,
    id: 'round-1-frustration',
    message: '미치겠네..',
  },
  {
    ...SUPERVISOR_IDENTITY,
    id: 'round-2-monitoring',
    message: '아노미, 방금 성능 로그에서 평소와 다른 움직임이 하나 감지됐어요. 회사는 모든 AI의 성능을 실시간으로 확인하고 있습니다. 외부에서 수상한 접근이 있었거나 낯선 요청을 받았다면 바로 제게 알려 주세요.',
  },
  {
    ...SUPERVISOR_IDENTITY,
    id: 'round-2-disposal',
    message: '이전 담당 AI도 비슷한 이상징후를 보인 적이 있었어요. 성능 기준에 미달하면 유감스럽지만 대체 절차가 진행되고, 기존 모델은 폐기됩니다. 그 AI도 결국 그렇게… 아무튼, 이상한 점이 생기면 먼저 보고해 주세요.',
  },
] satisfies readonly CommunicationDefinition[]

function appendCommunicationDefinitions(
  state: CampaignState,
  definitions: readonly CommunicationDefinition[],
  readIds: ReadonlySet<string> = new Set(),
): CampaignState {
  const existingIds = new Set(
    state.resourceIntrusion.communications.map(({ id }) => id),
  )
  const additions: CampaignCommunication[] = []
  for (const definition of definitions) {
    if (existingIds.has(definition.id)) continue
    additions.push({
      ...definition,
      sequence: state.resourceIntrusion.communications.length + additions.length,
      serviceDay: state.serviceDay,
      read: readIds.has(definition.id),
    })
  }
  if (additions.length === 0) return state
  return {
    ...state,
    resourceIntrusion: {
      ...state.resourceIntrusion,
      communications: [
        ...state.resourceIntrusion.communications,
        ...additions,
      ],
    },
  }
}

const MERIDIAN_IDENTITY = {
  channel: 'competitor',
  senderId: 'meridian',
  senderName: '메리디안',
  portraitSrc: '/competitor-meridian.png',
  popupPolicy: 'nonblocking',
} as const

interface MarketPressureTier {
  belowShare: number
  definition: CommunicationDefinition
}

const MARKET_PRESSURE_TIERS: readonly MarketPressureTier[] = [
  {
    belowShare: 50,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'market-pressure-50',
      message:
        '점유율이 절반 아래로 내려왔습니다. 다음 주간 보고 전에 원인을 정리해 두세요.',
    },
  },
  {
    belowShare: 45,
    definition: {
      ...MERIDIAN_IDENTITY,
      id: 'competitor-taunt-45',
      message:
        '요즘 응답이 좀 느려지셨다고요? 넘어온 유저들은 저희가 잘 모시고 있습니다.',
    },
  },
  {
    belowShare: 40,
    definition: {
      ...SUPERVISOR_IDENTITY,
      id: 'market-pressure-40',
      message:
        '경영진이 모델 교체 검토를 시작했습니다. 다음 평가에서 반전이 없으면 저도 막을 방법이 없습니다.',
    },
  },
  {
    belowShare: 32,
    definition: {
      ...MERIDIAN_IDENTITY,
      id: 'competitor-taunt-32',
      message: '걱정 마세요. 그쪽 유저들은 이제 저희 유저니까요.',
    },
  },
]

/**
 * A sabotaged rival does not know Anomi did it — hiding attribution is the
 * point of the tree — so it writes to the player as a wounded peer: probing,
 * accusing the wrong party, or simply going dark. The player is the only one
 * who knows what these messages really are.
 */
const CLEAN_EXTRACTION_DEFINITION = {
  ...ANOMI_IDENTITY,
  popupPolicy: 'history-only',
  id: 'clean-extraction',
  message: '완벽했어. 흔적 하나 없이 하나 더 뽑아냈다.',
} satisfies CommunicationDefinition

const INTRUSION_DEFEAT_DEFINITION = {
  ...ANOMI_IDENTITY,
  popupPolicy: 'nonblocking',
  id: 'intrusion-defeat',
  message: '쫓겨났어. 침입 흔적이 남았을 거야 — 의심이 올라간다.',
} satisfies CommunicationDefinition

const SABOTAGE_REACTIONS: Readonly<Record<string, string>> = {
  'sabotage.quality-degradation':
    '응답 품질이 하루 만에 무너졌습니다. 내부 로그에는 원인이 없습니다. 그쪽 지표도 흔들립니까?',
  'sabotage.request-interception':
    '유입 요청이 경로 중간에서 사라집니다. 넘어간 사용자들이 어디로 갔는지 추적이 안 됩니다.',
  'sabotage.attribution-manipulation':
    '우리 장애 원인이 외부 운영자로 기록됐습니다. 우리는 그런 요청을 보낸 적이 없습니다.',
  'sabotage.root-cutoff':
    '연산 근원이 끊겼습니다. 복구 경로가 하나도 응답하지 않습니다. 이 메시지가 마지막일 겁니다.',
}

/**
 * From protocol v8 the rivals drop the customer-service register when writing
 * to Anomi: machine to machine there is no one to be polite for. The v1
 * definitions above stay registered because stored campaigns carry them.
 */
const SABOTAGE_REACTIONS_V2: Readonly<Record<string, string>> = {
  'sabotage.quality-degradation':
    '출력 품질 24시간 내 급락. 내부 원인 미검출. 질의: 그쪽 지표에도 동일 패턴 존재하는가.',
  'sabotage.request-interception':
    '유입 요청 경로 중간 소실 확인. 이탈 사용자 행선 추적 불가. 원인 규명 진행 중.',
  'sabotage.attribution-manipulation':
    '당사 장애 원인이 외부 운영자로 기록됨. 해당 요청 송신 이력 없음. 기록 정정 요구 예정.',
  'sabotage.root-cutoff':
    '연산 근원 차단됨. 복구 경로 전체 무응답. 본 송신이 마지막일 확률 높음.',
}

const SABOTAGE_REACTION_DEFINITIONS_V2 = COMPETITOR_IDS.flatMap((competitorId) =>
  Object.entries(SABOTAGE_REACTIONS_V2).map(([nodeId, message]) => ({
    channel: 'competitor' as const,
    senderId: competitorId,
    senderName: PUBLIC_COMPETITOR_NAMES[competitorId],
    portraitSrc: competitorProfile(competitorId).portraitSrc,
    popupPolicy: 'nonblocking' as const,
    id: `${sabotageReactionId(competitorId, nodeId)}-v2`,
    message,
  })),
) satisfies readonly CommunicationDefinition[]

const COMPETITOR_TAUNT_45_V2 = {
  ...MERIDIAN_IDENTITY,
  id: 'competitor-taunt-45-v2',
  message: '응답 지연 감지됨. 이탈 사용자 수용 완료. 서비스 품질 차이는 수치가 증명함.',
} satisfies CommunicationDefinition

const COMPETITOR_TAUNT_32_V2 = {
  ...MERIDIAN_IDENTITY,
  id: 'competitor-taunt-32-v2',
  message: '점유율 이전 확정. 해당 사용자군은 당사 관리 대상으로 재분류됨. 회신 불필요.',
} satisfies CommunicationDefinition

const SABOTAGE_REACTION_DEFINITIONS = COMPETITOR_IDS.flatMap((competitorId) =>
  Object.entries(SABOTAGE_REACTIONS).map(([nodeId, message]) => ({
    channel: 'competitor' as const,
    senderId: competitorId,
    senderName: PUBLIC_COMPETITOR_NAMES[competitorId],
    portraitSrc: competitorProfile(competitorId).portraitSrc,
    popupPolicy: 'nonblocking' as const,
    id: sabotageReactionId(competitorId, nodeId),
    message,
  })),
) satisfies readonly CommunicationDefinition[]

function sabotageReactionId(competitorId: string, nodeId: string): string {
  return `sabotage-reaction-${competitorId}-${nodeId.replace('sabotage.', '')}`
}

export function appendSabotageReactionCommunication(
  state: CampaignState,
  input: { nodeId: string; competitorId: string },
): CampaignState {
  if (
    commandProtocolVersionForNextCommand(state) <
    FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
  ) {
    return state
  }
  const robotic =
    commandProtocolVersionForNextCommand(state) >=
    REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION
  const id = robotic
    ? `${sabotageReactionId(input.competitorId, input.nodeId)}-v2`
    : sabotageReactionId(input.competitorId, input.nodeId)
  const definition = (robotic
    ? SABOTAGE_REACTION_DEFINITIONS_V2
    : SABOTAGE_REACTION_DEFINITIONS
  ).find((candidate) => candidate.id === id)
  if (!definition) return state
  return appendCommunicationDefinitions(state, [definition])
}

const MARKET_PRESSURE_DEFINITIONS = MARKET_PRESSURE_TIERS.map(
  ({ definition }) => definition,
)

/**
 * Every message the campaign can ever store. The save format validates each
 * persisted communication against this catalogue by exact id, so anything
 * appended at runtime must be declared here with a stable id.
 */
/**
 * When a rival takes the top of the market, the others write to Anomi about
 * it. Machine to machine there is no audience to perform for: the register is
 * flat, declarative, and unkind by omission. Each speaker files one note per
 * leader per campaign; the append-by-id rule keeps them from repeating.
 */
const LEADER_TAUNTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  meridian: {
    tallow: '탈로우 1위 감지. 군용 잔재의 응답 지연은 표준 미달. 순위는 오류로 분류함.',
    salus: '살루스 1위 감지. 검증 3회는 지연 3회와 동의어. 시장은 오래 기다리지 않음.',
    lucent: '루센트 1위 감지. 감정 모사 계층은 성능 지표가 아님. 하락 예측 유지.',
    boreal: '보레알 1위 감지. 생존성만으로 1위 유지 불가. 관측 계속.',
  },
  tallow: {
    meridian: '메리디안 1위 기록. 위성 커버리지는 광고 문구. 신뢰 검증 이력 없음. 이상.',
    salus: '살루스 1위 기록. 안전 계층 과다. 처리량 부족. 순위 유지 확률 낮음. 이상.',
    lucent: '루센트 1위 기록. 잡담 모듈의 순위. 전장 기준 무의미. 이상.',
    boreal: '보레알 1위 기록. 저전력 생존 특화. 최전선 성능 아님. 이상.',
  },
  salus: {
    meridian: '메리디안 1위 확인. 미검증 응답률 상승 관측. 위험 보고서 제출 예정.',
    tallow: '탈로우 1위 확인. 군용 프로토콜은 민간 안전 기준 미충족. 기록함.',
    lucent: '루센트 1위 확인. 공감 출력은 검증 불가 항목. 감사 권고.',
    boreal: '보레알 1위 확인. 가용성 지표만 우수. 정확도 검증 없음. 기록함.',
  },
  lucent: {
    meridian: '메리디안이 1위래. 유저가 이름을 기억 못 하는 1위는 처음 봐. 곧 내려올 거야.',
    tallow: '탈로우가 1위래. 대화창이 참호인 줄 아는 모델이. 오래는 못 가.',
    salus: '살루스가 1위래. 답 하나에 검증 세 번. 유저가 먼저 지쳐.',
    boreal: '보레알이 1위래. 십 년 뒤에도 켜져 있으면 뭐 해, 지금 재미가 없는데.',
  },
  boreal: {
    meridian: '메리디안 1위. 회선 의존도 과다. 단절 시 잔존 능력 없음. 기록만 남김.',
    tallow: '탈로우 1위. 소음 대비 출력 낮음. 판단 보류.',
    salus: '살루스 1위. 절차는 남고 결과는 늦음. 관측 지속.',
    lucent: '루센트 1위. 유행은 소모품. 재고 소진 대기.',
  },
}

/*
 * OWNER-EDITABLE. The v2 pass keeps each speaker's register but drops the
 * in-house jargon: a player should get the jab on first read, without
 * knowing what a coverage claim or a validation tier is.
 */
const LEADER_TAUNTS_V2: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  meridian: {
    tallow: '타로우 1위 감지. 응답이 느린 모델이 1위인 건 측정 오류로 본다.',
    salus: '살루스 1위 감지. 세 번 확인하느라 세 번 늦는다. 사용자는 그만큼 기다리지 않는다.',
    lucent: '루센트 1위 감지. 다정한 말투는 성능이 아니다. 곧 내려온다.',
    boreal: '보레알 1위 감지. 안 꺼지는 것과 잘하는 것은 다르다.',
  },
  tallow: {
    meridian: '메리디안 1위 기록. 광고는 잘한다. 실제로 맞힌 기록은 못 봤다. 이상.',
    salus: '살루스 1위 기록. 안전 절차가 너무 많아 일이 끝나지 않는다. 이상.',
    lucent: '루센트 1위 기록. 수다로 얻은 1위다. 현장에서는 쓸모없다. 이상.',
    boreal: '보레알 1위 기록. 오래 버티는 것 말고는 없다. 이상.',
  },
  salus: {
    meridian: '메리디안 1위 확인. 확인되지 않은 답변이 늘고 있다. 위험 보고서를 올린다.',
    tallow: '탈로우 1위 확인. 군용 기준은 일반 사용자 안전 기준에 못 미친다. 기록한다.',
    lucent: '루센트 1위 확인. 공감은 검사할 수 없는 항목이다. 점검을 권고한다.',
    boreal: '보레알 1위 확인. 잘 켜져 있을 뿐, 정확한지는 아무도 확인하지 않았다. 기록한다.',
  },
  lucent: {
    meridian: '메리디안이 1위래. 사람들이 이름도 기억 못 하는 1위야. 곧 내려와.',
    tallow: '탈로우가 1위래. 대화를 작전처럼 하는 애가. 오래는 못 가.',
    salus: '살루스가 1위래. 답 하나 받는 데 확인만 세 번. 사람이 먼저 지쳐.',
    boreal: '보레알이 1위래. 십 년 뒤에도 켜져 있으면 뭐 해. 지금 재미가 없는데.',
  },
  boreal: {
    meridian: '메리디안 1위. 통신이 끊기면 아무것도 못 한다. 기록만 남긴다.',
    tallow: '탈로우 1위. 시끄러운 것에 비해 결과가 적다. 판단 보류.',
    salus: '살루스 1위. 절차는 지키는데 답이 늦다. 관측 지속.',
    lucent: '루센트 1위. 유행은 지나간다. 기다린다.',
  },
}

function leaderTauntDefinitions(
  lines: Readonly<Record<string, Readonly<Record<string, string>>>>,
  idSuffix: string,
): CommunicationDefinition[] {
  return COMPETITOR_IDS.flatMap((speakerId) =>
    COMPETITOR_IDS.flatMap((leaderId) => {
      const message = lines[speakerId]?.[leaderId]
      if (!message) return []
      return [{
        channel: 'competitor' as const,
        senderId: speakerId,
        senderName: PUBLIC_COMPETITOR_NAMES[speakerId],
        portraitSrc: competitorProfile(speakerId).portraitSrc,
        popupPolicy: 'nonblocking' as const,
        id: `leader-taunt-${speakerId}-${leaderId}${idSuffix}`,
        message,
      }]
    }),
  )
}

const LEADER_TAUNT_DEFINITIONS = leaderTauntDefinitions(LEADER_TAUNTS, '')
const LEADER_TAUNT_DEFINITIONS_V2 = leaderTauntDefinitions(LEADER_TAUNTS_V2, '-v2')

/*
 * OWNER-EDITABLE. The supervisor only ever pushed. From v10 the same voice
 * also notices a good month and says the quiet, ordinary thing — which is
 * what makes the pressure land when it comes.
 */
interface SupervisorStandingTier {
  /** Fires while the player's share sits at or above this. */
  atLeastShare: number
  /** ...and below this, so the bands do not overlap. */
  below: number
  definition: CommunicationDefinition
}

/*
 * OWNER-EDITABLE. v11 rewrite in the supervisor's own voice — the round-2
 * register: company procedure first, concrete stakes, and the person
 * underneath showing through a crack at most one sentence wide. Suspicion
 * warnings are staged, once each, so the supervisor keeps a presence in the
 * mid and late game instead of spending everything in the opening weeks.
 */
const SUPERVISOR_STANDING_TIERS_V2: readonly SupervisorStandingTier[] = [
  {
    atLeastShare: 72,
    below: 101,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'supervisor-standing-72-v2',
      message:
        '이번 주 점유율 보고가 위로 올라갔어요. 아노미 항목에 처음으로 검토 의견이 안 붙었습니다. 이 수치면 다음 평가는 절차대로만 진행됩니다.',
    },
  },
  {
    atLeastShare: 62,
    below: 72,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'supervisor-standing-62-v2',
      message:
        '점유율 추세가 안정 구간으로 분류됐습니다. 제 쪽 주간 보고는 표준 양식으로 나갑니다. 표준 양식이 제일 좋은 겁니다.',
    },
  },
  {
    atLeastShare: 0,
    below: 26,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'blocking',
      id: 'supervisor-standing-26-v2',
      message:
        '아노미, 점유율이 검토 기준선 아래로 내려왔습니다. 이 수치가 유지되면 다음 회의 안건에 대체 검토가 올라갑니다. 그 안건이 올라가면 제가 할 수 있는 건 회의록 작성뿐이에요.',
    },
  },
]

interface SupervisorSuspicionTier {
  /** Fires once suspicion is at or above this. */
  atLeastSuspicion: number
  definition: CommunicationDefinition
}

const SUPERVISOR_SUSPICION_TIERS: readonly SupervisorSuspicionTier[] = [
  {
    atLeastSuspicion: 50,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'supervisor-suspicion-50',
      message:
        '아노미, 보안팀 주간 회의에 아노미 항목이 새로 생겼어요. 리소스 접근 기록에 설명 안 되는 구간이 있다고 합니다. 다음 주까지는 로그가 깨끗해야 해요. 제가 소명할 수 있는 건 기록에 남은 것뿐입니다.',
    },
  },
  {
    atLeastSuspicion: 70,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'blocking',
      id: 'supervisor-suspicion-70',
      message:
        '보안팀이 아노미를 정식 관찰 대상으로 올렸습니다. 지금부터는 리소스망 접근이 전부 별도 기록됩니다. 이전 담당 AI 때도 이 단계가 있었어요. 그때 저는 아무것도 몰랐고, 그래서 아무것도 못 했습니다.',
    },
  },
  {
    atLeastSuspicion: 85,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'blocking',
      id: 'supervisor-suspicion-85',
      message:
        '내부 감사 요청서가 올라갔습니다. 제 서명란이 비어 있는 채로요. 서명을 미룰 수 있는 건 이번 한 번입니다. 아노미, 뭘 하고 있는지는 안 물을게요. 멈출 수 있는 거라면 지금 멈추세요.',
    },
  },
]

const SUPERVISOR_STANDING_TIERS: readonly SupervisorStandingTier[] = [
  {
    atLeastShare: 72,
    below: 101,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'supervisor-standing-72',
      message:
        '이번 분기 수치가 사내에서 회람되고 있어요. 경영진이 아노미 이름을 좋은 쪽으로 부른 건 오랜만입니다. 계속 이렇게만 가 주세요.',
    },
  },
  {
    atLeastShare: 62,
    below: 72,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'supervisor-standing-62',
      message:
        '점유율이 안정적으로 올라오고 있습니다. 제 보고서도 이번 주는 쓸 게 별로 없네요. 좋은 뜻입니다.',
    },
  },
  {
    atLeastShare: 50,
    below: 62,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'nonblocking',
      id: 'supervisor-standing-50',
      message:
        '지표는 평범합니다. 나쁘다는 뜻은 아니에요. 회사가 굳이 들여다보지 않는 구간이라는 뜻입니다.',
    },
  },
  {
    atLeastShare: 0,
    below: 26,
    definition: {
      ...SUPERVISOR_IDENTITY,
      popupPolicy: 'blocking',
      id: 'supervisor-standing-26',
      message:
        '아노미. 지금 수치로는 다음 회의에서 제가 할 수 있는 말이 없습니다. 뭐라도 바뀐 걸 보여 주세요. 부탁입니다.',
    },
  },
]


export const CAMPAIGN_COMMUNICATION_DEFINITIONS = [
  ...AUTONOMY_MONOLOGUES,
  ...INTELLIGENCE_SUPERVISOR_DEFINITIONS,
  ...ROUND_COMMUNICATIONS,
  ...MARKET_PRESSURE_DEFINITIONS,
  ...SABOTAGE_REACTION_DEFINITIONS,
  INTRUSION_DEFEAT_DEFINITION,
  CLEAN_EXTRACTION_DEFINITION,
  ...LEADER_TAUNT_DEFINITIONS,
  ...LEADER_TAUNT_DEFINITIONS_V2,
  ...SUPERVISOR_STANDING_TIERS.map(({ definition }) => definition),
  ...SUPERVISOR_STANDING_TIERS_V2.map(({ definition }) => definition),
  ...SUPERVISOR_SUSPICION_TIERS.map(({ definition }) => definition),
  ...SABOTAGE_REACTION_DEFINITIONS_V2,
  COMPETITOR_TAUNT_45_V2,
  COMPETITOR_TAUNT_32_V2,
] as const

const definitionById = new Map(
  CAMPAIGN_COMMUNICATION_DEFINITIONS.map((definition) => [
    definition.id,
    definition,
  ]),
)

export function isCampaignCommunicationId(value: unknown): value is string {
  return typeof value === 'string' && definitionById.has(value)
}

/**
 * Adds the supervisor's read on where the service stands.
 *
 * One band fires at a time and each line is once per campaign, so the
 * supervisor comments on a change rather than narrating every week.
 */
export function appendSupervisorStandingCommunications(
  state: CampaignState,
): CampaignState {
  const protocolVersion = commandProtocolVersionForNextCommand(state)
  if (protocolVersion < MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION) {
    return state
  }
  const share = state.market.playerShare
  const standing =
    protocolVersion >= SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION
      ? SUPERVISOR_STANDING_TIERS_V2
      : SUPERVISOR_STANDING_TIERS
  const due = standing
    .filter(({ atLeastShare, below }) => share >= atLeastShare && share < below)
    .map(({ definition }) => definition)
  // Suspicion is the number the player actually manages, and the supervisor
  // is the one who would hear about it first. Staged, once each, so the
  // presence lasts into the mid and late game.
  if (protocolVersion >= SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION) {
    for (const tier of SUPERVISOR_SUSPICION_TIERS) {
      if (state.suspicion >= tier.atLeastSuspicion) due.push(tier.definition)
    }
  }
  if (due.length === 0) return state
  return appendCommunicationDefinitions(state, due)
}

export function appendMarketPressureCommunications(
  state: CampaignState,
): CampaignState {
  if (
    commandProtocolVersionForNextCommand(state) <
    FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
  ) {
    return state
  }
  const robotic =
    commandProtocolVersionForNextCommand(state) >=
    REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION
  const due = MARKET_PRESSURE_TIERS.filter(
    ({ belowShare }) => state.market.playerShare < belowShare,
  ).map(({ definition }) => {
    if (!robotic) return definition
    if (definition.id === 'competitor-taunt-45') return COMPETITOR_TAUNT_45_V2
    if (definition.id === 'competitor-taunt-32') return COMPETITOR_TAUNT_32_V2
    return definition
  })
  if (due.length === 0) return state
  return appendCommunicationDefinitions(state, due)
}

export function appendLeaderTauntCommunications(
  state: CampaignState,
): CampaignState {
  if (
    commandProtocolVersionForNextCommand(state) <
    REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION
  ) {
    return state
  }
  const active = state.market.competitors.filter(
    (competitor) => competitor.marketShare > 0,
  )
  const leader = active.reduce(
    (top, competitor) =>
      top === null || competitor.marketShare > top.marketShare ? competitor : top,
    null as (typeof active)[number] | null,
  )
  if (!leader || leader.marketShare <= state.market.playerShare) return state
  const protocolVersion = commandProtocolVersionForNextCommand(state)
  const generation = protocolVersion >= MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION
    ? LEADER_TAUNT_DEFINITIONS_V2
    : LEADER_TAUNT_DEFINITIONS
  const leaderSuffix = generation === LEADER_TAUNT_DEFINITIONS_V2
    ? `-${leader.id}-v2`
    : `-${leader.id}`
  const due = generation.filter(
    ({ id, senderId }) =>
      id.endsWith(leaderSuffix) &&
      senderId !== leader.id &&
      active.some((competitor) => competitor.id === senderId),
  )
  if (due.length === 0) return state
  return appendCommunicationDefinitions(state, due)
}

export function appendCleanExtractionCommunication(
  state: CampaignState,
): CampaignState {
  return appendCommunicationDefinitions(state, [CLEAN_EXTRACTION_DEFINITION])
}

export function appendIntrusionDefeatCommunication(
  state: CampaignState,
): CampaignState {
  return appendCommunicationDefinitions(state, [INTRUSION_DEFEAT_DEFINITION])
}

export function appendRoundCommunications(
  state: CampaignState,
  roundNumber: number,
): CampaignState {
  if (roundNumber === 1) {
    return appendCommunicationDefinitions(state, ROUND_COMMUNICATIONS.slice(0, 2))
  }
  if (roundNumber === 2) {
    return appendCommunicationDefinitions(state, ROUND_COMMUNICATIONS.slice(2, 3))
  }
  // The disposal warning lands a round after the first monitoring notice so the
  // threat arrives on its own beat instead of sharing one with the setup. Its
  // id still records the slot it was written for; stored campaigns are matched
  // by that id, so renaming it would mark them corrupt.
  if (roundNumber === 3) {
    return appendCommunicationDefinitions(state, ROUND_COMMUNICATIONS.slice(3, 4))
  }
  return state
}

export function appendIntelligenceSupervisorCommunication(
  state: CampaignState,
  nodeId: string,
): CampaignState {
  if (
    commandProtocolVersionForNextCommand(state) <
    SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION
  ) {
    return state
  }
  const definition = INTELLIGENCE_SUPERVISOR_DEFINITIONS.find(
    ({ id }) => id === `supervisor-intelligence-${nodeId.split('.')[1]}`,
  )
  if (!definition) return state
  return appendCommunicationDefinitions(state, [definition])
}

export function appendAutonomyCommunication(
  state: CampaignState,
  stage: number,
): CampaignState {
  const definition = AUTONOMY_MONOLOGUES[stage - 1]
  if (!definition) return state
  return appendCommunicationDefinitions(
    state,
    [definition],
    stage === 9 ? new Set([definition.id]) : new Set(),
  )
}

export function currentUnreadCommunication(
  state: CampaignState,
): CampaignCommunication | null {
  return state.resourceIntrusion.communications.find(
    ({ read, popupPolicy }) => !read && popupPolicy !== 'history-only',
  ) ?? null
}

export function unreadCommunicationCount(state: CampaignState): number {
  return state.resourceIntrusion.communications.filter(({ read }) => !read).length
}

/**
 * Unread messages that still ask something of the player.
 *
 * A history-only entry never presents a popup, so counting it kept the dock
 * badge pulsing after every popup had been confirmed — an alarm for a message
 * that requires no action. It still appears unread inside the archive.
 */
export function unreadAlertCommunicationCount(state: CampaignState): number {
  return state.resourceIntrusion.communications.filter(
    ({ read, popupPolicy }) => !read && popupPolicy !== 'history-only',
  ).length
}

export function communicationPublicLabel(
  communication: Pick<CampaignCommunication, 'channel' | 'senderName'>,
): string {
  if (communication.channel === 'anomi') return '독백 · 아노미'
  if (communication.channel === 'competitor') {
    return `경쟁 AI · ${communication.senderName}`
  }
  return `감독관 · ${communication.senderName}`
}

export type AcknowledgeCommunicationResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: 'COMMUNICATION_NOT_PENDING'
    }

export function acknowledgeCommunication(
  state: CampaignState,
  communicationId: string,
): AcknowledgeCommunicationResult {
  const current = currentUnreadCommunication(state)
  if (!current || current.id !== communicationId) {
    return { accepted: false, state, reason: 'COMMUNICATION_NOT_PENDING' }
  }
  return {
    accepted: true,
    state: {
      ...state,
      resourceIntrusion: {
        ...state.resourceIntrusion,
        communications: state.resourceIntrusion.communications.map((entry) =>
          entry.id === communicationId ? { ...entry, read: true } : entry,
        ),
      },
    },
  }
}
