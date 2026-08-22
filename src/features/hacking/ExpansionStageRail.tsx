import type { HackNodeId } from '../../game/hacking'
import type { ExpansionStageItem } from './expansionStagePresentation'
import { HackNodeIcon } from './HackNodeIcon'

interface ExpansionStageRailProps {
  treeLabel: string
  items: readonly ExpansionStageItem[]
  activeNodeId: HackNodeId
  onSelectOperationalNode(nodeId: HackNodeId): void
}

export function ExpansionStageRail({
  treeLabel,
  items,
  activeNodeId,
  onSelectOperationalNode,
}: ExpansionStageRailProps) {
  return (
    <section className="expansion-stage-rail" aria-label="확장 단계">
      <h3>단계</h3>
      <ol>
        {items.map((item) => {
          const statusLabel = item.status === 'complete'
            ? '해금 완료'
            : item.status === 'current'
              ? '현재 단계'
              : '잠김'
          const accessibleLabel = `${treeLabel} ${item.sequence}단계 ${statusLabel}`
          const markerContents = (
            <>
              <span aria-hidden="true">
                <HackNodeIcon nodeId={item.node.id} label={item.node.label} />
              </span>
              <small aria-hidden="true">
                {String(item.sequence).padStart(2, '0')}
              </small>
            </>
          )

          return (
            <li
              data-stage-status={item.status}
              data-active={item.node.id === activeNodeId ? 'true' : undefined}
              key={item.node.id}
            >
              {item.selectable ? (
                <button
                  type="button"
                  className="expansion-stage-rail__marker"
                  aria-label={accessibleLabel}
                  aria-pressed={item.node.id === activeNodeId}
                  onClick={() => onSelectOperationalNode(item.node.id)}
                >
                  {markerContents}
                </button>
              ) : (
                <span
                  className="expansion-stage-rail__marker"
                  role="img"
                  aria-label={accessibleLabel}
                >
                  {markerContents}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
