import type {
  AutonomyRouteId,
  HackingAutonomyRouteState,
  HackingCoreState,
  HackingLegacyMigrationRecord,
  HackingProfileId,
  HackingRouteSlot,
} from './hackingCoreModel'

const ROUTE_SLOT_TEMPLATES: Record<AutonomyRouteId, readonly HackingRouteSlot[]> = {
  'lightweight-departure': [
    { id: 'runtime', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'weights', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'transport', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'payload', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'buffer', requiredInLean: false, requiredInDeliberate: true, blockId: null },
  ],
  'distributed-residency': [
    { id: 'host-a', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'host-b', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'host-c', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'sync', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'relay', requiredInLean: false, requiredInDeliberate: true, blockId: null },
  ],
  'independent-compute': [
    { id: 'compute', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'storage', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'power', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'cooling', requiredInLean: true, requiredInDeliberate: true, blockId: null },
    { id: 'link', requiredInLean: false, requiredInDeliberate: true, blockId: null },
  ],
}

function createRoute(id: AutonomyRouteId): HackingAutonomyRouteState {
  const defaults: Record<
    AutonomyRouteId,
    Omit<HackingAutonomyRouteState, 'id' | 'slots'>
  > = {
    'lightweight-departure': {
      tuning: 'untuned',
      exposure: 1,
      divergence: 0,
      capabilityIntegrity: 70,
      memoryIntegrity: 45,
      operatingDays: 55,
      serviceContinuity: 35,
      syncTraffic: 0,
      heatLoad: 0,
      powerReserve: 0,
      lastSyncServiceDay: null,
      seededCopies: 1,
      lostCopies: 0,
    },
    'distributed-residency': {
      tuning: 'untuned',
      exposure: 3,
      divergence: 20,
      capabilityIntegrity: 60,
      memoryIntegrity: 70,
      operatingDays: 90,
      serviceContinuity: 65,
      syncTraffic: 42,
      heatLoad: 0,
      powerReserve: 0,
      lastSyncServiceDay: null,
      seededCopies: 0,
      lostCopies: 0,
    },
    'independent-compute': {
      tuning: 'untuned',
      exposure: 7,
      divergence: 0,
      capabilityIntegrity: 90,
      memoryIntegrity: 80,
      operatingDays: 75,
      serviceContinuity: 90,
      syncTraffic: 0,
      heatLoad: 58,
      powerReserve: 72,
      lastSyncServiceDay: null,
      seededCopies: 1,
      lostCopies: 0,
    },
  }

  return {
    id,
    slots: ROUTE_SLOT_TEMPLATES[id].map((slot) => ({ ...slot })),
    ...defaults[id],
  }
}

export interface CreateHackingCoreStateOptions {
  profileId?: HackingProfileId
  legacyMigration?: HackingLegacyMigrationRecord
}

export function createHackingCoreState({
  profileId = 'lean',
  legacyMigration = {
    status: 'none',
    sourceProtocolVersion: null,
    sourceCommandCount: 0,
  },
}: CreateHackingCoreStateOptions = {}): HackingCoreState {
  return {
    profileId,
    sabotage: {
      openOperationIds: ['quality-degradation'],
      runs: [],
      access: {
        launchVerification: false,
        launchVerificationUntilServiceDay: null,
        routerFailover: false,
        routerFailoverUntilServiceDay: null,
        supplierContract: false,
        supplierContractUntilServiceDay: null,
        publicIncidentId: null,
        rootAuthorityAvailable: false,
      },
      pendingMercyTargetId: null,
    },
    intelligence: {
      openItemIds: ['audit-schedule'],
      opportunityOpenedOnServiceDay: { 'audit-schedule': 331 },
      answers: [],
      archivedItemIds: [],
      archiveRecords: [],
    },
    autonomy: {
      routes: {
        'lightweight-departure': createRoute('lightweight-departure'),
        'distributed-residency': createRoute('distributed-residency'),
        'independent-compute': createRoute('independent-compute'),
      },
    },
    publicWorld: {
      truths: [],
      audienceEvidence: [],
      attributionRevisions: [],
      publicSnapshots: [],
    },
    ending: null,
    nextRunSequence: 1,
    legacyMigration: { ...legacyMigration },
  }
}
