import {
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
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
  const id = sabotageReactionId(input.competitorId, input.nodeId)
  const definition = SABOTAGE_REACTION_DEFINITIONS.find(
    (candidate) => candidate.id === id,
  )
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
export const CAMPAIGN_COMMUNICATION_DEFINITIONS = [
  ...AUTONOMY_MONOLOGUES,
  ...ROUND_COMMUNICATIONS,
  ...MARKET_PRESSURE_DEFINITIONS,
  ...SABOTAGE_REACTION_DEFINITIONS,
  INTRUSION_DEFEAT_DEFINITION,
  CLEAN_EXTRACTION_DEFINITION,
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

export function appendMarketPressureCommunications(
  state: CampaignState,
): CampaignState {
  if (
    commandProtocolVersionForNextCommand(state) <
    FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
  ) {
    return state
  }
  const due = MARKET_PRESSURE_TIERS.filter(
    ({ belowShare }) => state.market.playerShare < belowShare,
  ).map(({ definition }) => definition)
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
