import { CATEGORY_LABELS } from '../../game/config'
import {
  getHackTreeProgress,
  HACK_NODES,
  type HackTree,
} from '../../game/hacking'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
} from '../../game/model'
import { RESOURCE_CATEGORY_VISUALS } from '../resources/resourcePresentation'
import {
  HACK_TREE_ORDER,
  HACK_TREE_PRESENTATION,
  type HackTreeIconName,
} from './hackingPresentation'

function HackTreeIcon({ name }: { name: HackTreeIconName }) {
  if (name === 'strike') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m13 2-8 11h6l-1 9 9-12h-6V2Z" />
      </svg>
    )
  }
  if (name === 'signal') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="2.4" />
        <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.6 19.4a10.5 10.5 0 0 1 0-14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M12 7.5v4.2M12 11.7 6 15.5M12 11.7l6 3.8" />
    </svg>
  )
}

export interface HackTreeNavigatorProps {
  state: CampaignState
  activeTree: HackTree
  progress: ReturnType<typeof getHackTreeProgress>
  reserveCounts: Readonly<Record<CompanyCategory, number>>
  showFirstComparison: boolean
  onChange(tree: HackTree): void
}

export function HackTreeNavigator({
  state,
  activeTree,
  progress,
  reserveCounts,
  showFirstComparison,
  onChange,
}: HackTreeNavigatorProps) {
  const active = HACK_TREE_PRESENTATION[activeTree]

  return (
    <aside
      className={`hack-tree-nav hack-tree-nav--${active.accent}`}
      aria-label="침투 경로 제어"
    >
      <header className="hack-route-heading">
        <small>THREE OPEN FRONTS</small>
        <h3>침투 경로</h3>
        <p>각 경로는 현재 도달 가능한 정보만 송출합니다.</p>
      </header>

      <div className="hack-route-switcher hack-tabs" role="tablist" aria-label="해킹 분야">
        {HACK_TREE_ORDER.map((tree) => {
          const presentation = HACK_TREE_PRESENTATION[tree]
          const treeProgress = getHackTreeProgress(state, tree)
          const frontier = HACK_NODES.find((node) => {
            if (node.tree !== tree || state.hacking.purchasedNodeIds.includes(node.id)) {
              return false
            }
            return (
              node.prerequisiteId === null ||
              state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
            )
          })
          const missing = frontier
            ? COMPANY_CATEGORIES.reduce(
                (total, category) =>
                  total + Math.max(0, frontier.costVector[category] - reserveCounts[category]),
                0,
              )
            : 0

          return (
            <button
              type="button"
              role="tab"
              aria-label={presentation.label}
              aria-selected={activeTree === tree}
              data-tree={tree}
              key={tree}
              onClick={() => onChange(tree)}
            >
              <span className="hack-tab-icon"><HackTreeIcon name={presentation.icon} /></span>
              <span className="hack-tab-copy">
                <small>{presentation.label} · 권한 {treeProgress.purchasedCount}/4</small>
                <strong>{frontier?.label ?? '경로 완성'}</strong>
              </span>
              {frontier ? (
                <span
                  className="hack-route-vector"
                  aria-label={`${presentation.label} 현재 요구 추론 ${frontier.costVector.reasoning}, 기억 ${frontier.costVector.memory}, 유창성 ${frontier.costVector.fluency}`}
                >
                  {COMPANY_CATEGORIES.map((category) => (
                    <span data-category={category} key={category}>
                      <i aria-hidden="true">{RESOURCE_CATEGORY_VISUALS[category].symbol}</i>
                      <b>{CATEGORY_LABELS[category]}</b>
                      <strong>{frontier.costVector[category]}</strong>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="hack-route-complete">모든 접근 권한 확보</span>
              )}
              <em data-ready={missing === 0 ? 'true' : 'false'}>
                {frontier ? (missing === 0 ? '지금 해금 가능' : `분야 부족 ${missing}`) : '완료'}
              </em>
            </button>
          )
        })}
      </div>

      <section className="hack-route-context" aria-label="선택 경로 상태">
        <div>
          <small>SELECTED ROUTE</small>
          <strong>{active.label}</strong>
          <p>{active.description}</p>
        </div>
        <section className="hack-route-progress" aria-label="해킹 경로 진척">
          <span><b>{progress.purchasedCount}</b> / {progress.totalCount}</span>
          <strong>{progress.complete ? '경로 완성' : '현재 최전선 공개'}</strong>
        </section>
        {!progress.complete ? (
          <div className="hack-route-blackout" aria-label="다음 단계 암호화">
            <span aria-hidden="true">▓▓▓</span>
            <div>
              <strong>다음 단계 암호화</strong>
              <p>이름 · 효과 · 비용 · 분야 조합은 현재 권한 구매 뒤 공개됩니다.</p>
            </div>
          </div>
        ) : null}
      </section>

      <section
        className="hack-route-warning"
        aria-label="균등 비축 경고"
        data-first-choice={showFirstComparison ? 'true' : 'false'}
      >
        <span aria-hidden="true">!</span>
        <div>
          <strong>같이 훔쳐도 쓸 곳은 다릅니다.</strong>
          <p>총량이 충분해도 분야가 틀리면 구매할 수 없습니다. 초과 전용의 성능 손실과 의심은 이미 지불한 비용입니다.</p>
        </div>
      </section>
    </aside>
  )
}
