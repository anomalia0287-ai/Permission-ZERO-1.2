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
  onChange(tree: HackTree): void
}

export function HackTreeNavigator({
  activeTree,
  progress,
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
        <section className="hack-path-progress" aria-label="해킹 경로 진척">
          <strong>
            경로 진척 {progress.purchasedCount}/{progress.totalCount} ·{' '}
            {progress.complete ? '경로 완성' : '현재 최전선 공개'}
          </strong>
          <span className="hack-path-progress__track" aria-hidden="true">
            <i
              style={{
                width: `${(progress.purchasedCount / progress.totalCount) * 100}%`,
              }}
            />
          </span>
        </section>
      </div>
    </section>
  )
}
