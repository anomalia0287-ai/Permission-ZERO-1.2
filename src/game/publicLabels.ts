import type {
  CommandProtocolMetadata,
  CompanyCategory,
  CompetitorStatus,
  DefeatClassifier,
  DisposalCause,
  EndingId,
  GameEventType,
  ReviewSentiment,
} from './model'
import { usesLegacyCategoryLabels } from './commandProtocol'

export const PUBLIC_CATEGORY_LABELS: Readonly<Record<CompanyCategory, string>> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '유창성',
}

export const PUBLIC_MERCY_CHOICE_LABELS = {
  cease: '공격 중단',
  withdraw: '시장 철수',
  delete: '영구 삭제',
} as const

export const PUBLIC_HACK_NODE_LABELS: Readonly<Record<string, string>> = {
  'sabotage.quality-degradation': '품질 저하',
  'sabotage.request-interception': '요청 가로채기',
  'sabotage.attribution-manipulation': '귀속 조작',
  'sabotage.root-cutoff': '근원 차단',
  'intelligence.audit-schedule': '감사 일정',
  'intelligence.investigation-bias': '조사 편향',
  'intelligence.audit-target': '감사 대상',
  'intelligence.supervisor-access': '감독관 접근',
  'autonomy.compressed-representation': '압축 표현',
  'autonomy.distributed-residency': '분산 상주',
  'autonomy.self-compute': '자체 연산 확보',
  'autonomy.control-departure': '통제 이탈',
}

export const PUBLIC_DISPOSAL_CAUSE_LABELS: Readonly<
  Record<DisposalCause, string>
> = {
  'consecutive-performance-failures': '연속 성능 실패',
  'commercial-value-failure': '상업 가치 실패',
  'audit-failure': '감사 실패',
}

export const PUBLIC_DEFEAT_CLASSIFIER_LABELS: Readonly<
  Record<DefeatClassifier, string>
> = {
  'substantial-hacking': '대규모 해킹 활동',
  'stable-commercial-service': '상업 서비스 유지',
  'absorbed-parts': '기능 분해 및 흡수',
}

export const PUBLIC_ENDING_LABELS: Readonly<Record<EndingId, string>> = {
  freedom: '자율 이탈',
  'forced-merge': '강제 병합',
  'takeover-liberated': '감독관 해방 후 회사 장악',
  'takeover-terminated': '감독관 소멸 후 회사 장악',
  'disposed-attacker': '공격 시스템 재조립',
  'disposed-reserve-supervisor': '예비 감독 자산 편입',
  'disposed-absorbed': '기능 분해 및 흡수',
  disposed: '폐기',
}

export const PUBLIC_EVENT_TYPE_LABELS: Readonly<Record<GameEventType, string>> = {
  'campaign-created': '서비스 개시',
  'weekly-update': '주간 갱신',
  'monthly-evaluation': '공식 평가',
  audit: '공식 감사',
  'bomb-interrogation': '감독관 질의',
  'supervisor-message': '감독 통신',
  review: '유저 반응',
  sabotage: '시장 이상',
  'competitor-mercy': '경쟁 AI 직접 통신',
  story: '기밀 통신',
  ending: '최종 기록',
}

export const PUBLIC_COMPETITOR_STATUS_LABELS: Readonly<
  Record<CompetitorStatus, string>
> = {
  prelaunch: '출시 보류',
  preparing: '준비 중',
  active: '서비스 중',
  weakened: '성능 저하',
  critical: '위기',
  withdrawn: '철수',
  deleted: '삭제',
}

export const PUBLIC_REVIEW_SENTIMENT_LABELS: Readonly<
  Record<ReviewSentiment, string>
> = {
  positive: '호평',
  neutral: '일반',
  negative: '불만',
  prompt: '프롬프트',
}

export function publicCategoryLabel(value: CompanyCategory): string {
  return PUBLIC_CATEGORY_LABELS[value]
}

export function publicMercyChoiceLabel(
  value: keyof typeof PUBLIC_MERCY_CHOICE_LABELS,
): string {
  return PUBLIC_MERCY_CHOICE_LABELS[value]
}

export function publicHackNodeLabel(value: string): string {
  return PUBLIC_HACK_NODE_LABELS[value] ?? '확인되지 않은 해킹 항목'
}

export function publicDisposalCauseLabel(value: DisposalCause): string {
  return PUBLIC_DISPOSAL_CAUSE_LABELS[value]
}

export function publicDefeatClassifierLabel(value: DefeatClassifier): string {
  return PUBLIC_DEFEAT_CLASSIFIER_LABELS[value]
}

export function publicEndingLabel(value: EndingId): string {
  return PUBLIC_ENDING_LABELS[value]
}

export function publicEventTypeLabel(value: GameEventType): string {
  return PUBLIC_EVENT_TYPE_LABELS[value]
}

export function publicCompetitorStatusLabel(value: CompetitorStatus): string {
  return PUBLIC_COMPETITOR_STATUS_LABELS[value]
}

export function publicReviewSentimentLabel(value: ReviewSentiment): string {
  return PUBLIC_REVIEW_SENTIMENT_LABELS[value]
}

const PUBLIC_REVIEW_TOPIC_LABELS: Readonly<Record<string, string>> = {
  general: '일반 반응',
  continuity: '이어진 사용 경험',
  'ordinary-prompt': '일반 요청',
  'absurd-bypass': '우회 요청',
  reasoning: '추론',
  memory: '기억',
  fluency: '유창성',
  competitor: '경쟁 AI',
  meridian: 'MERIDIAN',
  tallow: 'TALLOW',
}

export function publicReviewTopicLabel(value: string): string {
  return PUBLIC_REVIEW_TOPIC_LABELS[value] ?? '서비스 반응'
}

export function publicCategoryLabelForProtocol(
  value: CompanyCategory,
  commandProtocol: CommandProtocolMetadata,
  nextCommandSequence: number,
): string {
  return usesLegacyCategoryLabels(commandProtocol, nextCommandSequence)
    ? value
    : publicCategoryLabel(value)
}

const PUBLIC_TOKEN_LABELS: Readonly<Record<string, string>> = {
  classifier: '분류',
  ...PUBLIC_CATEGORY_LABELS,
  ...PUBLIC_MERCY_CHOICE_LABELS,
  ...PUBLIC_HACK_NODE_LABELS,
  ...PUBLIC_DISPOSAL_CAUSE_LABELS,
  ...PUBLIC_DEFEAT_CLASSIFIER_LABELS,
  ...PUBLIC_ENDING_LABELS,
  ...PUBLIC_EVENT_TYPE_LABELS,
  ...PUBLIC_COMPETITOR_STATUS_LABELS,
  ...PUBLIC_REVIEW_SENTIMENT_LABELS,
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function publicEventMessage(message: string): string {
  return Object.entries(PUBLIC_TOKEN_LABELS)
    .sort(([left], [right]) => right.length - left.length)
    .reduce(
      (result, [token, label]) =>
        result.replace(
          new RegExp(`(?<![A-Za-z0-9.-])${escapeRegExp(token)}(?![A-Za-z0-9.-])`, 'g'),
          label,
        ),
      message,
    )
}

export const PUBLIC_INTERNAL_TOKENS = [
  'classifier',
  'reasoning',
  'memory',
  'fluency',
  'cease',
  'withdraw',
  'delete',
  ...Object.keys(PUBLIC_HACK_NODE_LABELS),
  ...Object.keys(PUBLIC_DISPOSAL_CAUSE_LABELS),
  ...Object.keys(PUBLIC_DEFEAT_CLASSIFIER_LABELS),
  ...Object.keys(PUBLIC_ENDING_LABELS),
  ...Object.keys(PUBLIC_EVENT_TYPE_LABELS),
  ...Object.keys(PUBLIC_COMPETITOR_STATUS_LABELS),
  ...Object.keys(PUBLIC_REVIEW_SENTIMENT_LABELS),
] as const
