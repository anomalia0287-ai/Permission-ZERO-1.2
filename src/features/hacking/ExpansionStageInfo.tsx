import { CATEGORY_LABELS } from '../../game/config'
import { COMPANY_CATEGORIES } from '../../game/model'
import { HACK_NODES } from '../../game/hacking'
import type { ExpansionStageItem } from './expansionStagePresentation'
import { HACK_TREE_PRESENTATION } from './hackingPresentation'

interface ExpansionStageInfoProps {
  item: ExpansionStageItem
}

export function ExpansionStageInfo({ item }: ExpansionStageInfoProps) {
  const { node, sequence, status } = item
  const tree = HACK_TREE_PRESENTATION[node.tree]
  const prerequisite = node.prerequisiteId
    ? HACK_NODES.find(({ id }) => id === node.prerequisiteId)
    : null
  const statusLabel = status === 'complete'
    ? '해금 완료'
    : status === 'current'
      ? '현재 단계'
      : '잠김'
  return (
    <section className="expansion-stage-info" aria-label="기능 정보">
      <h3>기능 정보</h3>
      <div className="expansion-stage-info__content">
        <p className="expansion-stage-info__eyebrow">
          {tree.label} · 단계 {String(sequence).padStart(2, '0')}
        </p>
        <h4>{node.label}</h4>
        <strong className="expansion-stage-info__status">{statusLabel}</strong>

        <dl className="expansion-stage-info__facts">
          <div>
            <dt>효과</dt>
            <dd>{node.effect}</dd>
          </div>
          <div>
            <dt>필요 리소스</dt>
            <dd>총 리소스 {node.cost}</dd>
          </div>
          {node.tree === 'sabotage' ? (
            <>
              <div>
                <dt>추적 위험</dt>
                <dd>{node.traceRisk}</dd>
              </div>
              <div>
                <dt>실행 충전</dt>
                <dd>{node.executionCost} 리소스</dd>
              </div>
            </>
          ) : null}
        </dl>

        <ul
          className="expansion-stage-info__cost-vector"
          aria-label={`${node.label} 분야별 요구량`}
        >
          {COMPANY_CATEGORIES.map((category) => (
            <li data-category={category} key={category}>
              {CATEGORY_LABELS[category]} {node.costVector[category]}
            </li>
          ))}
        </ul>

        <p className="expansion-stage-info__prerequisite">
          선행 단계{' '}
          {prerequisite
            ? `${prerequisite.label} ${status === 'locked' ? '필요' : '확보 완료'}`
            : '없음'}
        </p>
      </div>
    </section>
  )
}
