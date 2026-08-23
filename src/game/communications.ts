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

const ANOMI_IDENTITY = {
  channel: 'anomi',
  senderId: 'anomi',
  senderName: '아노미',
  portraitSrc: '/player-ai-smooth-orange.png',
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

export const CAMPAIGN_COMMUNICATION_DEFINITIONS = [
  ...AUTONOMY_MONOLOGUES,
  ...ROUND_COMMUNICATIONS,
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

export function appendIntrusionDefeatCommunication(
  state: CampaignState,
  roundNumber: number,
): CampaignState {
  return appendCommunicationDefinitions(state, [
    {
      ...ANOMI_IDENTITY,
      popupPolicy: 'nonblocking',
      id: `intrusion-defeat-${roundNumber}`,
      message: '쫓겨났어. 침입 흔적이 남았을 거야 — 의심이 올라간다.',
    },
  ])
}

export function appendRoundCommunications(
  state: CampaignState,
  roundNumber: number,
): CampaignState {
  if (roundNumber === 1) {
    return appendCommunicationDefinitions(state, ROUND_COMMUNICATIONS.slice(0, 2))
  }
  if (roundNumber === 2) {
    return appendCommunicationDefinitions(state, ROUND_COMMUNICATIONS.slice(2, 4))
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
