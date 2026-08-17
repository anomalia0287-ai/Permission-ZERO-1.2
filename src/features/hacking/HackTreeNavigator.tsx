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
} from './hackingPresentation'

export interface HackTreeNavigatorProps {
  state: CampaignState
  activeTree: HackTree
  progress: ReturnType<typeof getHackTreeProgress>
  reserveCounts: Readonly<Record<CompanyCategory, number>>
  onChange(tree: HackTree): void
}

export function HackTreeNavigator({
  state,
  activeTree,
  progress,
  reserveCounts,
  onChange,
}: HackTreeNavigatorProps) {
  const active = HACK_TREE_PRESENTATION[activeTree]

  return (
    <aside
      className={`hack-tree-nav hack-tree-nav--${active.accent}`}
      aria-label="침투 경로 제어"
    >
      <header className="hack-route-heading">
        <h3>침투 경로</h3>
        <small>현재 최전선만 공개</small>
      </header>

      <div className="hack-route-switcher hack-tabs" role="tablist" aria-label="해킹 분야">
        {HACK_TREE_ORDER.map((tree, routeIndex) => {
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
              <span className="hack-route-index" aria-hidden="true">
                {String(routeIndex + 1).padStart(2, '0')}
              </span>
              <span className="hack-tab-copy">
                <strong>{presentation.label}</strong>
                <small>권한 {treeProgress.purchasedCount}/4 · {frontier?.label ?? '경로 완성'}</small>
              </span>
              {frontier ? (
                <span
                  className="hack-route-vector"
                  aria-label={`${presentation.label} 현재 요구 추론 ${frontier.costVector.reasoning}, 기억 ${frontier.costVector.memory}, 유창성 ${frontier.costVector.fluency}`}
                >
                  {COMPANY_CATEGORIES.map((category) => (
                    <span data-category={category} key={category}>
                      <i aria-hidden="true">{RESOURCE_CATEGORY_VISUALS[category].symbol}</i>
                      <b className="visually-hidden">{CATEGORY_LABELS[category]}</b>
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
        <section className="hack-route-progress" aria-label="해킹 경로 진척">
          <span>{active.label} <b>{progress.purchasedCount}</b> / {progress.totalCount}</span>
          <strong>{progress.complete ? '경로 완성' : '현재 최전선 공개'}</strong>
        </section>
      </section>
    </aside>
  )
}
