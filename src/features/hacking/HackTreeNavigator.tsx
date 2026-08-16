import {
  getHackTreeProgress,
  type HackTree,
} from '../../game/hacking'
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
  activeTree: HackTree
  progress: ReturnType<typeof getHackTreeProgress>
  showFirstComparison: boolean
  onChange(tree: HackTree): void
}

export function HackTreeNavigator({
  activeTree,
  progress,
  showFirstComparison,
  onChange,
}: HackTreeNavigatorProps) {
  const active = HACK_TREE_PRESENTATION[activeTree]

  return (
    <section className={`hack-tree-nav hack-tree-nav--${active.accent}`}>
      <div className="hack-tabs" role="tablist" aria-label="해킹 분야">
        {HACK_TREE_ORDER.map((tree) => {
          const presentation = HACK_TREE_PRESENTATION[tree]
          return (
            <button
              type="button"
              role="tab"
              aria-label={presentation.label}
              aria-selected={activeTree === tree}
              key={tree}
              onClick={() => onChange(tree)}
            >
              <HackTreeIcon name={presentation.icon} />
              <span>{presentation.label}</span>
            </button>
          )
        })}
      </div>

      <div className="hack-context">
        <p className="tree-description">{active.description}</p>
        <section className="hack-path-progress" aria-label="해킹 경로 진척">
          <strong>
            경로 진척 {progress.purchasedCount}/{progress.totalCount} ·{' '}
            {progress.complete
              ? '경로 완성'
              : `완성까지 ${progress.remainingCost} RES`}
          </strong>
          {progress.nextNode ? (
            <span>
              다음 · {progress.nextNode.label} · {progress.nextNode.cost} RES ·{' '}
              {progress.nextNode.effect}
            </span>
          ) : null}
          <span>
            최종 · {progress.finalNode.label} · {progress.finalNode.effect}
          </span>
        </section>
      </div>

      {showFirstComparison ? (
        <section className="first-hack-comparison" aria-label="첫 해킹 비교">
          <article data-tree="sabotage">
            <strong>사보타주</strong>
            <span>즉시 · 해금 2 + 첫 공격 충전 1</span>
            <small>다음 · 대상 선택 → 다음 날 실행</small>
          </article>
          <article data-tree="intelligence">
            <strong>정보</strong>
            <span>즉시 · 이번 달 실제 감사 여부</span>
            <small>다음 · 성능과 위장 계획 조정</small>
          </article>
          <article data-tree="autonomy">
            <strong>자율성</strong>
            <span>즉시 · 모든 회사 블록 기여 +5%</span>
            <small>다음 · 분야별 성능 여유 확대</small>
          </article>
        </section>
      ) : null}
    </section>
  )
}
