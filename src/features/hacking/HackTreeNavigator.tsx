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
    <section className={`hack-tree-nav hack-tree-nav--${active.accent}`}>
      <div className="hack-tabs" role="tablist" aria-label="해킹 분야">
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
              key={tree}
              onClick={() => onChange(tree)}
            >
              <span className="hack-tab-icon"><HackTreeIcon name={presentation.icon} /></span>
              <span className="hack-tab-copy">
                <small>{presentation.label} // {treeProgress.purchasedCount}/4</small>
                <strong>{frontier?.label ?? '경로 완성'}</strong>
                {frontier ? (
                  <span aria-hidden="true">
                    ∴ {frontier.costVector.reasoning} · ◇ {frontier.costVector.memory} · ≋{' '}
                    {frontier.costVector.fluency}
                  </span>
                ) : (
                  <span>모든 접근 권한 확보</span>
                )}
              </span>
              <em data-ready={missing === 0 ? 'true' : 'false'}>
                {frontier ? (missing === 0 ? '진입 가능' : `부족 ${missing}`) : '완료'}
              </em>
            </button>
          )
        })}
      </div>

      <div className="hack-context">
        <div>
          <small>SELECTED VECTOR</small>
          <p className="tree-description">{active.description}</p>
        </div>
        <section className="hack-path-progress" aria-label="해킹 경로 진척">
          <strong>
            경로 진척 {progress.purchasedCount}/{progress.totalCount} ·{' '}
            {progress.complete ? '경로 완성' : '현재 최전선 공개'}
          </strong>
          {!progress.complete ? (
            <span>
              현재 단계 뒤{' '}
              {Math.max(
                0,
                progress.totalCount - progress.purchasedCount - 1,
              )}
              개 단계의 요구와 효과는 아직 암호화되어 있습니다.
            </span>
          ) : null}
        </section>
      </div>

      {showFirstComparison ? (
        <section className="first-hack-comparison" aria-label="첫 해킹 비교">
          <header>
            <small>균등 비축 경고</small>
            <strong>같이 훔쳐도 맞는 조합은 다릅니다.</strong>
          </header>
          <article data-tree="sabotage">
            <strong>사보타주</strong>
            <span>현재 · 추론 1 + 유창성 2</span>
            <small>실행은 별도 리소스 1개 충전</small>
          </article>
          <article data-tree="intelligence">
            <strong>정보</strong>
            <span>현재 · 추론 1 + 기억 3</span>
            <small>이후 단계 요구는 해금 뒤 공개</small>
          </article>
          <article data-tree="autonomy">
            <strong>자율성</strong>
            <span>현재 · 추론 2 + 유창성 2</span>
            <small>이후 단계 요구는 해금 뒤 공개</small>
          </article>
        </section>
      ) : null}
    </section>
  )
}
