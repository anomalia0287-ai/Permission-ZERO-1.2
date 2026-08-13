import {
  DEMO_MARKET,
  DEMO_REVIEWS,
  DOMAIN_DEFINITIONS,
  PERFORMANCE_HISTORY,
  SUPERVISOR_MESSAGE,
  HACK_PATHS,
} from './data.js'

function createBlocks(domainId) {
  return Array.from({ length: 18 }, (_, index) => ({
    id: `${domainId}-${String(index + 1).padStart(2, '0')}`,
    position: index + 1,
    active: index < 16,
    diverted: false,
  }))
}

export function createDemoState() {
  return {
    screen: 'title',
    serviceDate: '서비스 11개월 1일',
    speed: 1,
    reputation: 60,
    weeklyCountdown: 6,
    monthlyCountdown: 29,
    expectation: 14,
    suspicion: 22.4,
    selection: null,
    domains: DOMAIN_DEFINITIONS.map((domain) => ({
      ...domain,
      performance: 16,
      blocks: createBlocks(domain.id),
    })),
    reserve: {
      capacity: 18,
      entries: [
        { id: 'reserve-01', source: 'reasoning' },
        { id: 'reserve-02', source: 'memory' },
        { id: 'reserve-03', source: 'fluency' },
      ],
    },
    reviews: DEMO_REVIEWS.map((review) => ({ ...review })),
    market: DEMO_MARKET.map((entry) => ({ ...entry })),
    performanceHistory: PERFORMANCE_HISTORY.map((point) => ({ ...point })),
    supervisorMessage: { ...SUPERVISOR_MESSAGE },
    hacking: {
      activePath: 'sabotage',
      selection: { pathId: 'sabotage', nodeId: 'sabotage-01' },
      purchased: [],
      paths: HACK_PATHS.map((path) => ({ ...path, nodes: path.nodes.map((node) => ({ ...node })) })),
    },
  }
}

function rounded(value) {
  return Math.round(value * 10) / 10
}

export function transition(state, action) {
  switch (action.type) {
    case 'SELECT_BLOCK': {
      const domain = state.domains.find(({ id }) => id === action.domainId)
      const block = domain?.blocks.find(({ id }) => id === action.blockId)
      if (!domain || !block?.active || block.diverted) return state
      return {
        ...state,
        selection: { domainId: domain.id, blockId: block.id },
      }
    }

    case 'CANCEL_SELECTION':
      return state.selection ? { ...state, selection: null } : state

    case 'SET_SPEED':
      return [0, 1, 2, 4].includes(action.speed) ? { ...state, speed: action.speed } : state

    case 'DIVERT_SELECTED': {
      if (!state.selection || state.reserve.entries.length >= state.reserve.capacity) return state
      const { blockId, domainId } = state.selection
      const domainIndex = state.domains.findIndex(({ id }) => id === domainId)
      if (domainIndex < 0) return state
      const block = state.domains[domainIndex].blocks.find(({ id }) => id === blockId)
      if (!block?.active || block.diverted) return state

      const domains = state.domains.map((domain, index) =>
        index === domainIndex
          ? {
              ...domain,
              performance: rounded(domain.performance - 1),
              blocks: domain.blocks.map((candidate) =>
                candidate.id === blockId
                  ? { ...candidate, active: false, diverted: true }
                  : candidate,
              ),
            }
          : domain,
      )

      return {
        ...state,
        domains,
        reserve: {
          ...state.reserve,
          entries: [
            ...state.reserve.entries,
            { id: `reserve-${String(state.reserve.entries.length + 1).padStart(2, '0')}`, source: domainId },
          ],
        },
        suspicion: rounded(state.suspicion + 2.4),
        selection: null,
      }
    }

    case 'SET_HACK_PATH': {
      const path = state.hacking.paths.find(({ id }) => id === action.pathId)
      const firstNode = path?.nodes[0]
      return path && firstNode
        ? {
            ...state,
            hacking: {
              ...state.hacking,
              activePath: path.id,
              selection: { pathId: path.id, nodeId: firstNode.id },
            },
          }
        : state
    }

    case 'SELECT_HACK_NODE': {
      const path = state.hacking.paths.find(({ id }) => id === action.pathId)
      const node = path?.nodes.find(({ id }) => id === action.nodeId)
      if (!node) return state
      return { ...state, hacking: { ...state.hacking, activePath: path.id, selection: { pathId: path.id, nodeId: node.id } } }
    }

    case 'PURCHASE_HACK_NODE': {
      const selection = state.hacking.selection
      const path = state.hacking.paths.find(({ id }) => id === selection?.pathId)
      const node = path?.nodes.find(({ id }) => id === selection?.nodeId)
      if (!node || state.hacking.purchased.includes(node.id) || state.reserve.entries.length < node.cost) return state
      return {
        ...state,
        reserve: { ...state.reserve, entries: state.reserve.entries.slice(node.cost) },
        hacking: { ...state.hacking, purchased: [...state.hacking.purchased, node.id], selection: null },
      }
    }

    default:
      return state
  }
}
