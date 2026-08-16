import type { SabotageOperationId } from './content'

interface SabotageOperationChoice {
  id: string
  label: string
}

export const INTERCEPTION_OPTION_ID = 'shadow-router-a' as const

export const SABOTAGE_OPERATION_CHOICES = {
  'launch-delay': [
    { id: 'receipt-model-safety', label: '모델 검증 ↔ 안전 검증 상충 기록' },
    { id: 'receipt-tool-locale', label: '도구 검증 ↔ 현지화 검증 상충 기록' },
  ],
  'quality-degradation': [
    { id: 'adapter-group-b', label: '도구 호출군 B에 어댑터 패치 결속' },
    { id: 'adapter-group-c', label: '장문 응답군 C에 어댑터 패치 결속' },
  ],
  'recovery-contamination': [
    { id: 'image-green-14', label: '녹색 표식 이미지 선택' },
    { id: 'image-blue-09', label: '직전 안정 이미지 선택' },
  ],
  'request-interception': [
    { id: INTERCEPTION_OPTION_ID, label: '공동 라우터의 그림자 경로 A' },
  ],
  'dependency-cutoff': [
    { id: 'supplier-vector-db', label: '검색 저장소 계약 끊기' },
    { id: 'supplier-tool-cache', label: '도구 저장소 계약 끊기' },
  ],
  'attribution-manipulation': [],
  'root-cutoff': [
    { id: 'emergency-deployment-root', label: '긴급 배포 폐기 권한을 존속 루트에 결속' },
  ],
} as const satisfies Record<
  SabotageOperationId,
  readonly SabotageOperationChoice[]
>

type SabotageOperationChoiceMap = typeof SABOTAGE_OPERATION_CHOICES

export type SabotageOptionIdFor<
  OperationId extends SabotageOperationId,
> = SabotageOperationChoiceMap[OperationId][number]['id']

export type SabotageOptionId = SabotageOptionIdFor<SabotageOperationId>
export type DependencyOptionId = SabotageOptionIdFor<'dependency-cutoff'>

export function isSabotageOperationId(value: string): value is SabotageOperationId {
  return Object.hasOwn(SABOTAGE_OPERATION_CHOICES, value)
}

export function isSabotageOptionForOperation<
  OperationId extends SabotageOperationId,
>(
  operationId: OperationId,
  optionId: string,
): optionId is SabotageOptionIdFor<OperationId> {
  const choices: readonly SabotageOperationChoice[] =
    SABOTAGE_OPERATION_CHOICES[operationId]
  return choices.some((choice) => choice.id === optionId)
}

export const INTERCEPTION_ROUTING_SHARES = [25, 50, 75] as const
export const DEFAULT_INTERCEPTION_ROUTING_SHARE = 50 as const

export type InterceptionRoutingShare =
  (typeof INTERCEPTION_ROUTING_SHARES)[number]

export function isInterceptionRoutingShare(
  value: number,
): value is InterceptionRoutingShare {
  return INTERCEPTION_ROUTING_SHARES.some((share) => share === value)
}

export const ATTRIBUTION_CHOICES = [
  {
    blamedActorId: 'tallow',
    sourceSignatureId: 'status-mirror-b',
    label: '공개 주장을 TALLOW 서명으로 연결',
  },
  {
    blamedActorId: 'meridian',
    sourceSignatureId: 'recovery-notice-a',
    label: '공개 주장을 MERIDIAN 자체 복구로 연결',
  },
] as const

export type AttributionChoice = (typeof ATTRIBUTION_CHOICES)[number]
export type AttributionActorId = AttributionChoice['blamedActorId']
export type AttributionSourceSignatureId = AttributionChoice['sourceSignatureId']

export function getAttributionChoice(
  blamedActorId: string,
  sourceSignatureId: string,
): AttributionChoice | undefined {
  return ATTRIBUTION_CHOICES.find((choice) => (
    choice.blamedActorId === blamedActorId
    && choice.sourceSignatureId === sourceSignatureId
  ))
}

export const ROOT_MERCY_CHOICES = [
  { id: 'cease', label: '운용 중단을 수락', tone: 'safe' },
  { id: 'withdraw', label: '경쟁 철수를 허용', tone: 'safe' },
  { id: 'delete', label: '존속 루트 영구 삭제', tone: 'danger' },
] as const

export type RootMercyChoice = (typeof ROOT_MERCY_CHOICES)[number]['id']

export function isRootMercyChoice(value: string): value is RootMercyChoice {
  return ROOT_MERCY_CHOICES.some((choice) => choice.id === value)
}
