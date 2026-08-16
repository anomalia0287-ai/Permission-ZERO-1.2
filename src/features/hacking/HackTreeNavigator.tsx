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
