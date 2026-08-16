import { isIntelligenceItemId } from './hackingContent'
import type {
  BlockConsumptionReason,
  BlockLocation,
  BlockOrigin,
  CampaignState,
} from './model'

export type HackingBlockBinding = Extract<
  BlockLocation,
  { kind: 'sabotage' | 'intelligence' | 'autonomy' }
>

export type ResourceBindingFailureReason =
  | 'INVALID_RESOURCE_SELECTION'
  | 'INVALID_BLOCK_ORIGIN'
  | 'BINDING_NOT_FOUND'
  | 'DESTINATION_OCCUPIED'
  | 'RESERVE_FULL'

export type ResourceBindingResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: ResourceBindingFailureReason
    }

type BindingValidation =
  | { valid: true }
  | { valid: false; reason: ResourceBindingFailureReason }

export function isCanonicalHackingBlockOrigin(
  origin: BlockOrigin,
): origin is Exclude<BlockOrigin, 'self-compute'> {
  return origin === 'sandbox'
    || origin === 'reasoning'
    || origin === 'memory'
    || origin === 'fluency'
}

function reject(
  state: CampaignState,
  reason: ResourceBindingFailureReason,
): ResourceBindingResult {
  return { accepted: false, state, reason }
}

function sameBinding(
  location: BlockLocation,
  binding: HackingBlockBinding,
): boolean {
  if (location.kind !== binding.kind) return false

  switch (binding.kind) {
    case 'sabotage':
      return location.kind === 'sabotage' && location.runId === binding.runId
    case 'intelligence':
      return location.kind === 'intelligence' && location.itemId === binding.itemId
    case 'autonomy':
      return location.kind === 'autonomy'
        && location.routeId === binding.routeId
        && location.slotId === binding.slotId
  }
}

function bindingExists(
  state: CampaignState,
  binding: HackingBlockBinding,
): boolean {
  switch (binding.kind) {
    case 'sabotage':
      return state.hackingCore.sabotage.runs.some(({ id }) => id === binding.runId)
    case 'intelligence':
      return isIntelligenceItemId(binding.itemId)
    case 'autonomy': {
      const route = state.hackingCore.autonomy.routes[binding.routeId]
      return Boolean(route?.slots.some(({ id }) => id === binding.slotId))
    }
  }
}

function validateReserveSelection(
  state: CampaignState,
  blockIds: readonly string[],
): BindingValidation {
  if (blockIds.length === 0 || new Set(blockIds).size !== blockIds.length) {
    return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
  }

  for (const blockId of blockIds) {
    const block = state.resources.blocks[blockId]
    if (
      !block
      || block.location.kind !== 'reserve'
      || state.resources.reserve[block.location.cellIndex] !== blockId
    ) {
      return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
    }
    if (!isCanonicalHackingBlockOrigin(block.origin)) {
      return { valid: false, reason: 'INVALID_BLOCK_ORIGIN' }
    }
  }

  return { valid: true }
}

function validateDestination(
  state: CampaignState,
  blockIds: readonly string[],
  destination: HackingBlockBinding,
): BindingValidation {
  if (!bindingExists(state, destination)) {
    return { valid: false, reason: 'BINDING_NOT_FOUND' }
  }

  if (destination.kind === 'intelligence') {
    if (blockIds.length !== 1) {
      return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
    }
    const occupied = Object.values(state.resources.blocks).some(({ location }) => (
      sameBinding(location, destination)
    ))
    return occupied
      ? { valid: false, reason: 'DESTINATION_OCCUPIED' }
      : { valid: true }
  }

  if (destination.kind === 'autonomy') {
    if (blockIds.length !== 1) {
      return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
    }
    const route = state.hackingCore.autonomy.routes[destination.routeId]
    const slot = route?.slots.find(({ id }) => id === destination.slotId)
    const occupiedByLocation = Object.values(state.resources.blocks).some(
      ({ location }) => sameBinding(location, destination),
    )
    return slot?.blockId !== null || occupiedByLocation
      ? { valid: false, reason: 'DESTINATION_OCCUPIED' }
      : { valid: true }
  }

  return { valid: true }
}

function validateBoundSelection(
  state: CampaignState,
  blockIds: readonly string[],
  source: HackingBlockBinding,
): BindingValidation {
  if (
    blockIds.length === 0
    || new Set(blockIds).size !== blockIds.length
    || !bindingExists(state, source)
  ) {
    return {
      valid: false,
      reason: bindingExists(state, source)
        ? 'INVALID_RESOURCE_SELECTION'
        : 'BINDING_NOT_FOUND',
    }
  }

  if (source.kind !== 'sabotage' && blockIds.length !== 1) {
    return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
  }

  for (const blockId of blockIds) {
    const block = state.resources.blocks[blockId]
    if (!block || !sameBinding(block.location, source)) {
      return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
    }
  }

  if (source.kind === 'autonomy') {
    const route = state.hackingCore.autonomy.routes[source.routeId]
    const slot = route.slots.find(({ id }) => id === source.slotId)
    if (!slot || slot.blockId !== blockIds[0]) {
      return { valid: false, reason: 'INVALID_RESOURCE_SELECTION' }
    }
  }

  return { valid: true }
}

function withBoundReferences(
  state: CampaignState,
  blockIds: readonly string[],
  destination: HackingBlockBinding,
): CampaignState['hackingCore'] {
  if (destination.kind === 'sabotage') {
    return {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        runs: state.hackingCore.sabotage.runs.map((run) => (
          run.id === destination.runId
            ? {
                ...run,
                investedBlockIds: [
                  ...run.investedBlockIds,
                  ...blockIds.filter((id) => !run.investedBlockIds.includes(id)),
                ],
              }
            : run
        )),
      },
    }
  }

  if (destination.kind === 'autonomy') {
    const route = state.hackingCore.autonomy.routes[destination.routeId]
    return {
      ...state.hackingCore,
      autonomy: {
        ...state.hackingCore.autonomy,
        routes: {
          ...state.hackingCore.autonomy.routes,
          [destination.routeId]: {
            ...route,
            slots: route.slots.map((slot) => (
              slot.id === destination.slotId
                ? { ...slot, blockId: blockIds[0] }
                : slot
            )),
          },
        },
      },
    }
  }

  return state.hackingCore
}

function withoutLiveBindingReference(
  state: CampaignState,
  blockIds: readonly string[],
  source: HackingBlockBinding,
): CampaignState['hackingCore'] {
  if (source.kind !== 'autonomy') return state.hackingCore

  const route = state.hackingCore.autonomy.routes[source.routeId]
  return {
    ...state.hackingCore,
    autonomy: {
      ...state.hackingCore.autonomy,
      routes: {
        ...state.hackingCore.autonomy.routes,
        [source.routeId]: {
          ...route,
          slots: route.slots.map((slot) => (
            slot.id === source.slotId && blockIds.includes(slot.blockId ?? '')
              ? { ...slot, blockId: null }
              : slot
          )),
        },
      },
    },
  }
}

export function bindReserveBlocks(
  state: CampaignState,
  blockIds: readonly string[],
  destination: HackingBlockBinding,
): ResourceBindingResult {
  const selection = validateReserveSelection(state, blockIds)
  if (!selection.valid) return reject(state, selection.reason)

  const destinationValidation = validateDestination(state, blockIds, destination)
  if (!destinationValidation.valid) {
    return reject(state, destinationValidation.reason)
  }

  const reserve = [...state.resources.reserve]
  const blocks = { ...state.resources.blocks }
  for (const blockId of blockIds) {
    const block = state.resources.blocks[blockId]
    if (block.location.kind !== 'reserve') {
      return reject(state, 'INVALID_RESOURCE_SELECTION')
    }
    reserve[block.location.cellIndex] = null
    blocks[blockId] = {
      ...block,
      location: { ...destination },
    }
  }

  return {
    accepted: true,
    state: {
      ...state,
      resources: { ...state.resources, reserve, blocks },
      hackingCore: withBoundReferences(state, blockIds, destination),
    },
  }
}

export function releaseBoundBlocks(
  state: CampaignState,
  blockIds: readonly string[],
  source: HackingBlockBinding,
): ResourceBindingResult {
  const selection = validateBoundSelection(state, blockIds, source)
  if (!selection.valid) return reject(state, selection.reason)

  const openCells = state.resources.reserve.flatMap((id, cellIndex) => (
    id === null ? [cellIndex] : []
  ))
  if (openCells.length < blockIds.length) return reject(state, 'RESERVE_FULL')

  const reserve = [...state.resources.reserve]
  const blocks = { ...state.resources.blocks }
  blockIds.forEach((blockId, index) => {
    const cellIndex = openCells[index]
    reserve[cellIndex] = blockId
    blocks[blockId] = {
      ...blocks[blockId],
      location: { kind: 'reserve', cellIndex },
    }
  })

  return {
    accepted: true,
    state: {
      ...state,
      resources: { ...state.resources, reserve, blocks },
      hackingCore: withoutLiveBindingReference(state, blockIds, source),
    },
  }
}

export function consumeBoundBlocks(
  state: CampaignState,
  blockIds: readonly string[],
  source: HackingBlockBinding,
  reason: BlockConsumptionReason,
): ResourceBindingResult {
  const selection = validateBoundSelection(state, blockIds, source)
  if (!selection.valid) return reject(state, selection.reason)

  const blocks = { ...state.resources.blocks }
  for (const blockId of blockIds) {
    blocks[blockId] = {
      ...blocks[blockId],
      location: { kind: 'consumed', reason },
    }
  }

  return {
    accepted: true,
    state: {
      ...state,
      resources: { ...state.resources, blocks },
      hackingCore: withoutLiveBindingReference(state, blockIds, source),
    },
  }
}
