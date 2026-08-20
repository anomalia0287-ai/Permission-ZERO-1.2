import type {
  ResourceIntrusionDiversionOutcome,
  ResourceIntrusionRuntimeState,
} from './resourceIntrusionRuntime'

export type ResourceIntrusionFeedback =
  | { type: 'moved' }
  | { type: 'compression-resolved'; hitCount: number }
  | { type: 'resource-disabled'; blockId: string }
  | { type: 'player-damaged'; health: number }
  | { type: 'player-disabled' }
  | { type: 'salvage-collected'; blockId: string }
  | { type: 'deposit-started' }
  | {
      type: 'deposit-resolved'
      outcome: ResourceIntrusionDiversionOutcome['kind']
    }

export function deriveResourceIntrusionFeedback(
  previous: ResourceIntrusionRuntimeState,
  next: ResourceIntrusionRuntimeState,
  outcome?: ResourceIntrusionDiversionOutcome,
): readonly ResourceIntrusionFeedback[] {
  const feedback: ResourceIntrusionFeedback[] = []
  if (
    previous.player.x !== next.player.x ||
    previous.player.y !== next.player.y
  ) {
    feedback.push({ type: 'moved' })
  }
  if (next.combat.compressionSequence > previous.combat.compressionSequence) {
    feedback.push({
      type: 'compression-resolved',
      hitCount: next.combat.lastCompression?.hitBlockIds.length ?? 0,
    })
  }
  for (const [blockId, actor] of next.combat.actors) {
    const previousActor = previous.combat.actors.get(blockId)
    if (previousActor?.phase !== 'salvage' && actor.phase === 'salvage') {
      feedback.push({ type: 'resource-disabled', blockId })
    }
  }
  if (next.combat.respawnCount > previous.combat.respawnCount) {
    feedback.push({ type: 'player-disabled' })
  } else if (next.combat.playerHealth < previous.combat.playerHealth) {
    feedback.push({ type: 'player-damaged', health: next.combat.playerHealth })
  }
  if (
    previous.carriedBlockId === null &&
    next.carriedBlockId !== null
  ) {
    feedback.push({
      type: 'salvage-collected',
      blockId: next.carriedBlockId,
    })
  }
  if (
    previous.carriedBlockId !== null &&
    next.pendingDiversion?.blockId === previous.carriedBlockId
  ) {
    feedback.push({ type: 'deposit-started' })
  }
  if (
    previous.pendingDiversion !== null &&
    next.pendingDiversion === null &&
    outcome
  ) {
    feedback.push({ type: 'deposit-resolved', outcome: outcome.kind })
  }
  return feedback
}
