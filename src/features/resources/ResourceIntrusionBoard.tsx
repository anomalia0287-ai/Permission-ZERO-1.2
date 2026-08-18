import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'

import {
  useGameDispatch,
  useGameState,
  useRuntimeSuspended,
} from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import { COMPANY_CATEGORIES, type CompanyCategory } from '../../game/model'
import { getCompanyPerformance } from '../../game/resources'
import { ResourceBoard as LegacyAuditResourceBoard } from './ResourceBoard'
import {
  INTRUSION_AUDIT_BAND_SIZE,
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_FIELD_HEIGHT,
  INTRUSION_FIELD_WIDTH,
  INTRUSION_GRID_TILE_SIZE,
  INTRUSION_MOVE_INTERVAL_MS,
  INTRUSION_MOVE_STEP,
  INTRUSION_PLAYER_SIZE,
  INTRUSION_RESOURCE_SIZE,
  INTRUSION_THEFT_HOLD_MS,
  INTRUSION_WALL_PLAN,
  getActiveIntrusionScanRects,
  getIntrusionPhaseLabel,
  getIntrusionWallCount,
  getResourceAtIntrusionPlayer,
  getVisibleIntrusionWalls,
  intrusionCellRect,
  type IntrusionFieldResource,
} from './resourceIntrusionRuntime'
import { useResourceIntrusionRuntime } from './useResourceIntrusionRuntime'

const CELL_RENDER_SIZE = 1
const CANVAS_WIDTH = INTRUSION_FIELD_WIDTH * CELL_RENDER_SIZE
const CANVAS_HEIGHT = INTRUSION_FIELD_HEIGHT * CELL_RENDER_SIZE

const RESOURCE_COLORS: Record<CompanyCategory, string> = {
  reasoning: '#ff6b3d',
  memory: '#318cff',
  fluency: '#31c56f',
}

function ResourceIntrusionBoardSession() {
  const gameState = useGameState()
  const dispatch = useGameDispatch()
  const runtimeSuspended = useRuntimeSuspended()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastMoveAtRef = useRef(-Infinity)

  const resources = useMemo<IntrusionFieldResource[]>(
    () =>
      COMPANY_CATEGORIES.flatMap((category) =>
        gameState.resources.company[category].flatMap((blockId) => {
          if (!blockId) return []
          const block = gameState.resources.blocks[blockId]
          if (
            !block ||
            (block.origin !== 'reasoning' &&
              block.origin !== 'memory' &&
              block.origin !== 'fluency')
          ) {
            return []
          }
          return [{
            blockId,
            origin: block.origin,
            contribution: block.contribution,
          }]
        }),
      ),
    [gameState.resources.blocks, gameState.resources.company],
  )
  const resourceById = useMemo(
    () => new Map(resources.map((resource) => [resource.blockId, resource])),
    [resources],
  )

  const requestDiversion = useCallback(
    (blockId: string) => {
      dispatch({
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      })
      dispatch({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    },
    [dispatch],
  )

  const resolveDiversionOutcome = useCallback(
    (blockId: string) => {
      const block = gameState.resources.blocks[blockId]
      if (
        block?.location.kind === 'reserve' &&
        gameState.resources.reserve.includes(blockId) &&
        (block.origin === 'reasoning' ||
          block.origin === 'memory' ||
          block.origin === 'fluency')
      ) {
        return { kind: 'success' as const, origin: block.origin }
      }
      if (gameState.bombs.activeInterrogation?.blockId === blockId) {
        return { kind: 'interrogation' as const }
      }
      return { kind: 'rejected' as const }
    },
    [
      gameState.bombs.activeInterrogation,
      gameState.resources.blocks,
      gameState.resources.reserve,
    ],
  )

  const activeAudit = gameState.activeEvent?.type === 'audit'
  const requestedRunning =
    !runtimeSuspended &&
    gameState.activeEvent === null &&
    gameState.story.endingId === null
  const {
    state: intrusion,
    running,
    beginTheft,
    cancelTheft,
    move: moveRuntime,
  } = useResourceIntrusionRuntime({
    seed: gameState.campaignSeed,
    resources,
    running: requestedRunning,
    commandSequence: gameState.commandSequence,
    onRequestDiversion: requestDiversion,
    resolveDiversionOutcome,
  })

  const wallCount = getIntrusionWallCount(intrusion.totalElapsedMs)
  const visibleWalls = useMemo(
    () => getVisibleIntrusionWalls(intrusion.totalElapsedMs),
    [intrusion.totalElapsedMs],
  )
  const reserveCount = gameState.resources.reserve.reduce(
    (count, blockId) => count + (blockId ? 1 : 0),
    0,
  )
  const resourceAtPlayer = useMemo(
    () => getResourceAtIntrusionPlayer(intrusion, resources),
    [intrusion, resources],
  )

  useEffect(() => {
    if (navigator.userAgent.includes('jsdom')) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    context.fillStyle = '#2a2c2b'
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    if (intrusion.surveillance.kind === 'signal') {
      const pulse = 0.58 + Math.sin(intrusion.surveillance.elapsedMs / 80) * 0.32
      const signalColor = '#fff36a'
      context.save()
      context.globalAlpha = pulse
      context.fillStyle = signalColor
      context.shadowColor = signalColor
      context.shadowBlur = 18
      for (const lane of intrusion.surveillance.lanes) {
        if (lane.axis === 'row') {
          context.fillRect(
            lane.fromStart ? 0 : CANVAS_WIDTH - INTRUSION_GRID_TILE_SIZE,
            lane.index * CELL_RENDER_SIZE,
            INTRUSION_GRID_TILE_SIZE * CELL_RENDER_SIZE,
            INTRUSION_AUDIT_BAND_SIZE * CELL_RENDER_SIZE,
          )
        } else {
          context.fillRect(
            lane.index * CELL_RENDER_SIZE,
            lane.fromStart ? 0 : CANVAS_HEIGHT - INTRUSION_GRID_TILE_SIZE,
            INTRUSION_AUDIT_BAND_SIZE * CELL_RENDER_SIZE,
            INTRUSION_GRID_TILE_SIZE * CELL_RENDER_SIZE,
          )
        }
      }
      context.restore()
    }

    for (const scanRect of getActiveIntrusionScanRects(intrusion.surveillance)) {
      context.fillStyle = 'rgba(255, 112, 72, 0.34)'
      context.fillRect(
        scanRect.x * CELL_RENDER_SIZE,
        scanRect.y * CELL_RENDER_SIZE,
        scanRect.width * CELL_RENDER_SIZE,
        scanRect.height * CELL_RENDER_SIZE,
      )
    }

    for (const wall of visibleWalls) {
      context.fillStyle = '#101211'
      context.fillRect(
        wall.x * CELL_RENDER_SIZE,
        wall.y * CELL_RENDER_SIZE,
        wall.width * CELL_RENDER_SIZE,
        wall.height * CELL_RENDER_SIZE,
      )
    }

    context.fillStyle = '#d9d8d2'
    context.fillRect(
      INTRUSION_DEPOSIT_BOX.x * CELL_RENDER_SIZE,
      INTRUSION_DEPOSIT_BOX.y * CELL_RENDER_SIZE,
      INTRUSION_DEPOSIT_BOX.width * CELL_RENDER_SIZE,
      INTRUSION_DEPOSIT_BOX.height * CELL_RENDER_SIZE,
    )
    context.strokeStyle = '#f8f7f1'
    context.lineWidth = 2
    context.strokeRect(
      INTRUSION_DEPOSIT_BOX.x * CELL_RENDER_SIZE + 1,
      INTRUSION_DEPOSIT_BOX.y * CELL_RENDER_SIZE + 1,
      INTRUSION_DEPOSIT_BOX.width * CELL_RENDER_SIZE - 2,
      INTRUSION_DEPOSIT_BOX.height * CELL_RENDER_SIZE - 2,
    )
    context.fillStyle = '#343633'
    context.fillRect(
      (INTRUSION_DEPOSIT_BOX.x + 8) * CELL_RENDER_SIZE,
      (INTRUSION_DEPOSIT_BOX.y + 4) * CELL_RENDER_SIZE,
      (INTRUSION_DEPOSIT_BOX.width - 16) * CELL_RENDER_SIZE,
      3 * CELL_RENDER_SIZE,
    )

    const storedBlocks = gameState.resources.reserve
      .filter((blockId): blockId is string => blockId !== null)
      .slice(-8)
    storedBlocks.forEach((blockId, index) => {
      const block = gameState.resources.blocks[blockId]
      if (
        !block ||
        (block.origin !== 'reasoning' &&
          block.origin !== 'memory' &&
          block.origin !== 'fluency')
      ) {
        return
      }
      context.fillStyle = RESOURCE_COLORS[block.origin]
      context.fillRect(
        (INTRUSION_DEPOSIT_BOX.x + 5 + index * 5) * CELL_RENDER_SIZE,
        (INTRUSION_DEPOSIT_BOX.y + 10) * CELL_RENDER_SIZE,
        4 * CELL_RENDER_SIZE,
        4 * CELL_RENDER_SIZE,
      )
    })

    for (const [blockId, position] of intrusion.positions) {
      if (blockId === intrusion.carriedBlockId) continue
      const resource = resourceById.get(blockId)
      if (!resource) continue
      context.globalAlpha = resource.contribution === 'normal' ? 1 : 0.42
      context.fillStyle = RESOURCE_COLORS[resource.origin]
      context.fillRect(
        position.x * CELL_RENDER_SIZE,
        position.y * CELL_RENDER_SIZE,
        INTRUSION_RESOURCE_SIZE * CELL_RENDER_SIZE,
        INTRUSION_RESOURCE_SIZE * CELL_RENDER_SIZE,
      )
    }
    context.globalAlpha = 1

    context.lineWidth = 0.35
    context.strokeStyle = 'rgba(255,255,255,0.16)'
    context.beginPath()
    for (let x = 0; x <= INTRUSION_FIELD_WIDTH; x += 1) {
      const drawX = x * CELL_RENDER_SIZE + 0.5
      context.moveTo(drawX, 0)
      context.lineTo(drawX, CANVAS_HEIGHT)
    }
    for (let y = 0; y <= INTRUSION_FIELD_HEIGHT; y += 1) {
      const drawY = y * CELL_RENDER_SIZE + 0.5
      context.moveTo(0, drawY)
      context.lineTo(CANVAS_WIDTH, drawY)
    }
    context.stroke()

    context.lineWidth = 0.8
    context.strokeStyle = 'rgba(255,255,255,0.34)'
    context.beginPath()
    for (
      let x = 0;
      x <= INTRUSION_FIELD_WIDTH;
      x += INTRUSION_GRID_TILE_SIZE
    ) {
      const drawX = x * CELL_RENDER_SIZE + 0.5
      context.moveTo(drawX, 0)
      context.lineTo(drawX, CANVAS_HEIGHT)
    }
    for (
      let y = 0;
      y <= INTRUSION_FIELD_HEIGHT;
      y += INTRUSION_GRID_TILE_SIZE
    ) {
      const drawY = y * CELL_RENDER_SIZE + 0.5
      context.moveTo(0, drawY)
      context.lineTo(CANVAS_WIDTH, drawY)
    }
    context.stroke()

    const playerRect = intrusionCellRect(intrusion.player, INTRUSION_PLAYER_SIZE)
    context.fillStyle = '#f6f7f2'
    context.fillRect(
      playerRect.x * CELL_RENDER_SIZE,
      playerRect.y * CELL_RENDER_SIZE,
      playerRect.width * CELL_RENDER_SIZE,
      playerRect.height * CELL_RENDER_SIZE,
    )
    context.strokeStyle = '#0c0e0d'
    context.lineWidth = 2
    context.strokeRect(
      playerRect.x * CELL_RENDER_SIZE + 1,
      playerRect.y * CELL_RENDER_SIZE + 1,
      playerRect.width * CELL_RENDER_SIZE - 2,
      playerRect.height * CELL_RENDER_SIZE - 2,
    )
    if (intrusion.carriedBlockId) {
      const carriedResource = resourceById.get(intrusion.carriedBlockId)
      if (carriedResource) {
        context.fillStyle = RESOURCE_COLORS[carriedResource.origin]
        context.fillRect(
          (intrusion.player.x + INTRUSION_PLAYER_SIZE - INTRUSION_RESOURCE_SIZE) *
            CELL_RENDER_SIZE,
          intrusion.player.y * CELL_RENDER_SIZE,
          INTRUSION_RESOURCE_SIZE * CELL_RENDER_SIZE,
          INTRUSION_RESOURCE_SIZE * CELL_RENDER_SIZE,
        )
      }
    }
    if (intrusion.theft) {
      const progress = Math.min(
        1,
        intrusion.theft.elapsedMs / INTRUSION_THEFT_HOLD_MS,
      )
      context.fillStyle = '#ffffff'
      context.fillRect(
        playerRect.x * CELL_RENDER_SIZE,
        playerRect.y * CELL_RENDER_SIZE - 4,
        INTRUSION_PLAYER_SIZE * CELL_RENDER_SIZE * progress,
        2,
      )
    }
  }, [
    gameState.resources.blocks,
    gameState.resources.reserve,
    intrusion,
    resourceById,
    visibleWalls,
  ])

  const move = useCallback(
    (dx: number, dy: number) => {
      const now = performance.now()
      if (now - lastMoveAtRef.current < INTRUSION_MOVE_INTERVAL_MS) return
      lastMoveAtRef.current = now
      moveRuntime(dx, dy)
    },
    [moveRuntime],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const movement = {
      ArrowUp: [0, -INTRUSION_MOVE_STEP],
      ArrowRight: [INTRUSION_MOVE_STEP, 0],
      ArrowDown: [0, INTRUSION_MOVE_STEP],
      ArrowLeft: [-INTRUSION_MOVE_STEP, 0],
    }[event.key]
    if (movement) {
      event.preventDefault()
      move(movement[0], movement[1])
      return
    }
    if ((event.key === ' ' || event.key.toLowerCase() === 'e') && !event.repeat) {
      event.preventDefault()
      beginTheft()
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === ' ' || event.key.toLowerCase() === 'e') {
      event.preventDefault()
      if (intrusion.theft && intrusion.theft.elapsedMs < INTRUSION_THEFT_HOLD_MS) {
        cancelTheft()
      }
    }
  }

  if (activeAudit) return <LegacyAuditResourceBoard />

  const theftProgress = intrusion.theft
    ? Math.min(1, intrusion.theft.elapsedMs / INTRUSION_THEFT_HOLD_MS)
    : 0

  return (
    <section
      className="workspace-panel resource-panel resource-board resource-board--intrusion"
      aria-label="회사 제공 성능"
    >
      <header className="intrusion-board__header">
        <div>
          <h2>자원 절도 필드</h2>
        </div>
        <div className="intrusion-board__telemetry" aria-label="필드 상태">
          <span data-phase={intrusion.surveillance.kind}>
            {getIntrusionPhaseLabel(intrusion.surveillance)}
          </span>
          <span>벽 {wallCount}/{INTRUSION_WALL_PLAN.length}</span>
          <span>
            {intrusion.carriedBlockId ? '운반 중' : `확보 ${reserveCount} · 상한 없음`}
          </span>
        </div>
      </header>

      <div className="intrusion-grid-frame">
        <canvas
          ref={canvasRef}
          className="intrusion-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          data-player-x={intrusion.player.x}
          data-player-y={intrusion.player.y}
          data-carrying={intrusion.carriedBlockId ? 'true' : 'false'}
          data-surveillance-lanes={
            intrusion.surveillance.kind === 'signal' ||
            intrusion.surveillance.kind === 'active'
              ? intrusion.surveillance.lanes
                  .map(
                    (lane) =>
                      `${lane.axis}:${lane.index}:${lane.fromStart ? 'start' : 'end'}`,
                  )
                  .join(',')
              : ''
          }
          tabIndex={0}
          role="application"
          aria-label={`자원 절도 필드, 500 곱하기 300 셀, 플레이어 칸 ${intrusion.player.x}, ${intrusion.player.y}, 자원 ${resources.length}개, ${intrusion.carriedBlockId ? '절도 운반 중' : '빈손'}, ${getIntrusionPhaseLabel(intrusion.surveillance)}`}
          aria-describedby="intrusion-grid-feedback"
          aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft Space E"
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={cancelTheft}
        />
      </div>

      <footer className="intrusion-board__footer">
        <div className="intrusion-board__legend" aria-label="자원 색상 범례">
          {COMPANY_CATEGORIES.map((category) => (
            <span key={category} data-resource-category={category}>
              <i aria-hidden="true" />
              {CATEGORY_LABELS[category]} {getCompanyPerformance(gameState, category).toFixed(1)}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="intrusion-theft-control"
          disabled={
            !running ||
            intrusion.pendingDiversion !== null ||
            intrusion.carriedBlockId !== null ||
            resourceAtPlayer === null
          }
          style={{ '--theft-progress': theftProgress } as CSSProperties}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            beginTheft()
          }}
          onPointerUp={cancelTheft}
          onPointerCancel={cancelTheft}
        >
          {intrusion.carriedBlockId ? '운반 중' : intrusion.theft ? '절도 중' : '절도'}
        </button>
        <span id="intrusion-grid-feedback" role="status" aria-live="polite">
          {intrusion.announcement}
        </span>
      </footer>
    </section>
  )
}

export function ResourceIntrusionBoard() {
  const campaignSeed = useGameState().campaignSeed
  return <ResourceIntrusionBoardSession key={campaignSeed} />
}
