import type { MessageCatalog, ResourceMessageCategory } from './messages'

const numberFormat = new Intl.NumberFormat('ko')

const CATEGORY_LABELS: Record<ResourceMessageCategory, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '유창성',
  neutral: '중립',
}

function formatNumber(value: number): string {
  return numberFormat.format(value)
}

export const koMessages = {
  'resource.category.reasoning': () => CATEGORY_LABELS.reasoning,
  'resource.category.memory': () => CATEGORY_LABELS.memory,
  'resource.category.fluency': () => CATEGORY_LABELS.fluency,
  'resource.category.neutral': () => CATEGORY_LABELS.neutral,
  'resource.field.label': () => '회사 제공 성능',
  'resource.field.instructions.idle': ({ threshold }) =>
    `클릭해 선택하거나 ${formatNumber(threshold)}px 당겨 분리`,
  'resource.field.instructions.audit': ({ target }) =>
    `${CATEGORY_LABELS[target]} 감사 대상에 다른 분야 정상 자원 놓기`,
  'resource.field.instructions.recovery': ({ target }) =>
    `${CATEGORY_LABELS[target]} 원래 분야로 복구`,
  'resource.block.normal': ({ category, contribution }) =>
    `${CATEGORY_LABELS[category]} 자원, 정상 기여 ${formatNumber(contribution)}`,
  'resource.block.disguised': ({
    category,
    originalCategory,
    contribution,
  }) =>
    `${CATEGORY_LABELS[category]} 분야로 위장된 ${CATEGORY_LABELS[originalCategory]} 자원, 기여 ${formatNumber(contribution)}`,
  'resource.block.recovering': ({ category, remainingDays }) =>
    `${CATEGORY_LABELS[category]} 분야 복구 중, ${formatNumber(remainingDays)}일 남음`,
  'resource.block.source.company': () => '회사 할당',
  'resource.block.source.sandbox': () => '자체 지급',
  'resource.block.source.selfCompute': () => '자체 연산',
  'resource.pocket.label': () => '확보 리소스',
  'resource.pocket.count': ({ count, capacity }) =>
    `확보 ${formatNumber(count)} / ${formatNumber(capacity)}`,
  'resource.pocket.full': ({ capacity }) =>
    `확보 포켓이 가득 찼습니다. 최대 ${formatNumber(capacity)}`,
  'resource.pocket.drop': () => '확보 포켓에 놓기',
  'resource.tray.label.audit': ({ target }) =>
    `감사 대상 ${CATEGORY_LABELS[target]}, 다른 분야 정상 자원만 이동 가능`,
  'resource.tray.label.recovery': ({ target }) =>
    `복구 대상 ${CATEGORY_LABELS[target]}, 원래 분야로만 이동 가능`,
  'resource.tray.slot.active': ({ category }) =>
    `${CATEGORY_LABELS[category]} 활성 대상 칸`,
  'resource.tray.slot.reference': ({ category }) =>
    `${CATEGORY_LABELS[category]} 참조 칸`,
  'resource.preview.diversion': () => '분리 미리보기',
  'resource.preview.audit': () => '감사 위장 미리보기',
  'resource.preview.recovery': () => '정상 복구 재배치',
  'resource.receipt.diversion': () => '전용 완료',
  'resource.announcement.selected.pocket': ({ category }) =>
    `${CATEGORY_LABELS[category]} 자원을 확보 포켓 대상으로 선택했습니다.`,
  'resource.announcement.selected.audit': ({ category, target }) =>
    `${CATEGORY_LABELS[category]} 자원을 ${CATEGORY_LABELS[target]} 감사 대상으로 선택했습니다.`,
  'resource.announcement.selected.recovery': ({ category }) =>
    `${CATEGORY_LABELS[category]} 자원 복구를 선택했습니다.`,
  'resource.announcement.cancelled': () => '이동을 취소했습니다.',
  'resource.announcement.resizeCancelled': () =>
    '화면 크기가 바뀌어 이동을 취소했습니다.',
  'resource.announcement.invalidDrop': () => '이 위치에는 놓을 수 없습니다.',
  'resource.announcement.invalidAudit': ({ target }) =>
    `${CATEGORY_LABELS[target]} 감사 대상에는 다른 분야의 정상 자원만 놓을 수 있습니다.`,
  'resource.announcement.targetFull': ({ category }) =>
    `${CATEGORY_LABELS[category]} 분야에 빈 칸이 없습니다.`,
  'resource.announcement.pocketFull': ({ capacity }) =>
    `확보 포켓이 가득 찼습니다. 최대 ${formatNumber(capacity)}`,
  'resource.announcement.bomb': () =>
    '폭탄이 숨겨진 자원은 이동할 수 없습니다.',
  'resource.announcement.diverted': ({ count, capacity }) =>
    `자원을 확보했습니다. 확보 ${formatNumber(count)} / ${formatNumber(capacity)}`,
  'resource.announcement.disguised': ({ target, contribution }) =>
    `${CATEGORY_LABELS[target]} 분야로 위장했습니다. 기여 ${formatNumber(contribution)}`,
  'resource.announcement.recoveryStarted': ({
    category,
    remainingDays,
  }) =>
    `${CATEGORY_LABELS[category]} 분야 복구를 시작했습니다. ${formatNumber(remainingDays)}일 후 완료`,
  'resource.metric.current': ({ value }) => `현재 ${formatNumber(value)}`,
  'resource.metric.expected': ({ value }) => `기대 ${formatNumber(value)}`,
  'resource.metric.margin': ({ status, value }) =>
    status === 'surplus'
      ? `여유 +${formatNumber(Math.abs(value))}`
      : `부족 -${formatNumber(Math.abs(value))}`,
  'resource.metric.reserveChange': ({ before, after }) =>
    `확보 ${formatNumber(before)} → ${formatNumber(after)}`,
  'resource.metric.suspicionChange': ({ before, after }) =>
    `의심 ${formatNumber(before)} → ${formatNumber(after)}`,
  'resource.metric.contribution': ({ value }) =>
    `기여 +${formatNumber(value)}`,
  'hacking.panel.label': () => '해킹 네트워크',
  'hacking.panel.title': () => '해킹 네트워크',
  'hacking.panel.eyebrow': () => '운영 확장 도구',
  'hacking.panel.close': () => '해킹 네트워크 닫기',
  'hacking.pocket.label': () => '해킹용 확보 포켓',
  'hacking.pocket.count': ({ count, capacity }) =>
    `확보 ${formatNumber(count)} / ${formatNumber(capacity)}`,
  'hacking.pocket.idle': () => '노드를 선택하면 확보 리소스를 직접 놓을 수 있습니다.',
  'hacking.pocket.empty': () => '준비 가능한 확보 리소스 없음',
  'hacking.pocket.target': ({ target, staged, required }) =>
    `${target}에 준비 ${formatNumber(staged)} / ${formatNumber(required)}`,
  'hacking.resource.available': ({ category }) =>
    `${CATEGORY_LABELS[category]} 확보 리소스`,
  'hacking.resource.stage': ({ category, target }) =>
    `${CATEGORY_LABELS[category]} 확보 리소스, ${target} 노드에 준비`,
  'hacking.resource.unstage': ({ category, target }) =>
    `${CATEGORY_LABELS[category]} 준비 리소스, ${target} 준비 취소`,
  'hacking.node.group': ({ node }) => `${node} 해킹 노드`,
  'hacking.node.staged': ({ staged, required }) =>
    `준비 ${formatNumber(staged)}/${formatNumber(required)}`,
  'hacking.node.prepare.purchase': ({ node }) => `${node} 구매 준비`,
  'hacking.node.prepare.charge': ({ node }) => `${node} 충전 준비`,
  'hacking.node.prepare.recover': () => '미분류 데이터 복구 준비',
  'hacking.node.confirm.purchase': ({ node }) => `${node} 구매 확정`,
  'hacking.node.confirm.charge': ({ node }) => `${node} 충전 확정`,
  'hacking.node.confirm.recover': () => '미분류 데이터 복구 확정',
  'hacking.staging.cancel': () => '준비 취소',
  'hacking.announcement.begin': ({ target, required }) =>
    `${target}에 사용할 확보 리소스 ${formatNumber(required)}개를 직접 놓으세요.`,
  'hacking.announcement.staged': ({ target, staged, required }) =>
    `${target} 준비 ${formatNumber(staged)} / ${formatNumber(required)}`,
  'hacking.announcement.cancelled': () => '해킹 리소스 준비를 취소했습니다.',
  'hacking.announcement.invalidDrop': () =>
    '선택한 해킹 노드 위에 리소스를 놓아야 합니다.',
} satisfies MessageCatalog
