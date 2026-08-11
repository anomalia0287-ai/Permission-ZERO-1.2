import { useRef, useState, type KeyboardEvent } from 'react'

import type { ResourceState } from '../../game/model'
import { ResourceBlock } from './ResourceBlock'

export interface ReserveGridProps {
  resources: ResourceState
  selectedBlockId: string | null
  hoveredCell: number | null
  settlingCell: number | null
  disabled: boolean
  onDestination: (cellIndex: number) => void
  onDestinationFocus: (cellIndex: number) => void
}

export function ReserveGrid({
  resources,
  selectedBlockId,
  hoveredCell,
  settlingCell,
  disabled,
  onDestination,
  onDestinationFocus,
}: ReserveGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [rovingCell, setRovingCell] = useState<number | null>(null)
  const availableCells = resources.reserve.flatMap((blockId, cellIndex) =>
    blockId === null ? [cellIndex] : [],
  )
  const activeCell =
    rovingCell !== null && availableCells.includes(rovingCell)
      ? rovingCell
      : (availableCells[0] ?? null)

  function moveFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    cellIndex: number,
  ) {
    const directions: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -9,
      ArrowDown: 9,
    }
    const delta = directions[event.key]
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const currentPosition = availableCells.indexOf(cellIndex)
    const nextPosition = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? availableCells.length - 1
        : Math.max(0, Math.min(availableCells.length - 1, currentPosition + delta))
    const nextCell = availableCells[nextPosition]
    if (nextCell === undefined) return
    setRovingCell(nextCell)
    onDestinationFocus(nextCell)
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-reserve-cell="${nextCell}"]`)
      ?.focus()
  }

  return (
    <div
      ref={gridRef}
      className="resource-grid reserve-grid"
      role="grid"
      aria-label="확보 리소스 저장소"
    >
      {resources.reserve.map((blockId, cellIndex) => {
        const destinationEnabled = Boolean(selectedBlockId) && !disabled && blockId === null
        const ready = destinationEnabled && hoveredCell === null
        const hovered = destinationEnabled && hoveredCell === cellIndex

        return (
          <div
            className={[
              'resource-cell',
              'resource-cell--reserve',
              blockId ? 'resource-cell--filled' : '',
              ready ? 'resource-cell--drop-ready' : '',
              hovered ? 'resource-cell--drop-hover' : '',
            ].filter(Boolean).join(' ')}
            role="gridcell"
            aria-label={`확보 리소스 ${cellIndex + 1}, ${blockId ? '할당됨' : '비어 있음'}`}
            data-reserve-cell={cellIndex}
            key={`reserve-${cellIndex}`}
          >
            {blockId ? (
              <ResourceBlock
                block={resources.blocks[blockId]}
                cellIndex={cellIndex}
                label="확보 리소스"
                kind="reserve"
                disabled
                settling={settlingCell === cellIndex}
              />
            ) : (
              <button
                type="button"
                className="reserve-destination"
                aria-label={`확보 리소스 ${cellIndex + 1}, 비어 있음`}
                disabled={!destinationEnabled}
                tabIndex={destinationEnabled && cellIndex === activeCell ? 0 : -1}
                data-reserve-cell={cellIndex}
                onFocus={() => {
                  setRovingCell(cellIndex)
                  onDestinationFocus(cellIndex)
                }}
                onClick={() => onDestination(cellIndex)}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onDestination(cellIndex)
                  } else {
                    moveFocus(event, cellIndex)
                  }
                }}
              >
                <span aria-hidden="true">{String(cellIndex + 1).padStart(2, '0')}</span>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
