import type {
  CampaignState,
  CommandLogEntry,
  CommandProtocolMetadata,
  GameEvent,
} from './model'
import { JOURNAL_CHUNK_SIZE, type Journal, type JournalChunk } from './journal'
import {
  LEGACY_SAVE_STORAGE_KEY,
  LEGACY_V2_SAVE_STORAGE_KEY,
  SAVE_FORMAT_VERSION,
  SAVE_STORAGE_KEY,
  decodeSave,
  persistenceCodecInternals,
  type CampaignStorageRevision,
  type DecodeSaveResult,
  type LoadCampaignResult,
  type SaveCampaignResult,
} from './persistence'

const {
  corrupt,
  contentHash,
  hasOnlyKeys,
  isIntegerInRange,
  isNonEmptyString,
  isRecord,
  portableCheckpoint,
  portableCheckpointHash,
} = persistenceCodecInternals
const LOCAL_MANIFEST_KIND = 'permission-zero-local-v3'

interface LocalSaveManifest {
  kind: typeof LOCAL_MANIFEST_KIND
  version: 3 | 4 | 5 | 6 | typeof SAVE_FORMAT_VERSION
  savedAt: string
  campaignSeed: string
  commandProtocol: CommandProtocolMetadata
  commandSequence: number
  checkpoint: Omit<
    CampaignState,
    'commandProtocol' | 'commandLog' | 'eventLog'
  >
  checkpointHash: string
  commandHeadKey: string | null
  commandSealedChunkCount: number
  commandTail: CommandLogEntry[]
  eventHeadKey: string | null
  eventSealedChunkCount: number
  eventTail: GameEvent[]
}

interface LocalStorageJournalCache {
  commands: WeakMap<object, LocalJournalCacheEntry>
  events: WeakMap<object, LocalJournalCacheEntry>
}

interface LocalJournalCacheEntry {
  key: string
  content: string
  snapshot: LocalJournalNodeSnapshot
}

interface LocalJournalNodeSnapshot {
  previousKey: string | null
  items: unknown[]
}

const localStorageJournalCaches = new WeakMap<object, LocalStorageJournalCache>()

function revisionForStorageEntry(key: string, serialized: string): string {
  // This opaque token intentionally includes the exact root value. A short hash
  // would make two different saves indistinguishable after a collision.
  return `${key}\u0000${serialized}`
}

interface StoredCampaignEntry {
  key: string
  serialized: string
  revision: Exclude<CampaignStorageRevision, null>
}

function storedCampaignEntry(storage: Storage): StoredCampaignEntry | null {
  for (const key of [
    SAVE_STORAGE_KEY,
    LEGACY_V2_SAVE_STORAGE_KEY,
    LEGACY_SAVE_STORAGE_KEY,
  ]) {
    const serialized = storage.getItem(key)
    if (serialized !== null) {
      return {
        key,
        serialized,
        revision: revisionForStorageEntry(key, serialized),
      }
    }
  }
  return null
}

function storedCampaignRevision(storage: Storage): CampaignStorageRevision {
  return storedCampaignEntry(storage)?.revision ?? null
}

function storageConflict(): Extract<SaveCampaignResult, { ok: false }> {
  return {
    ok: false,
    reason: 'STORAGE_CONFLICT',
    message:
      '다른 탭에서 더 최신 진행을 저장했습니다. 현재 진행 파일을 내려받은 뒤 페이지를 새로 불러오세요. 충돌이 해결될 때까지 이 탭의 진행은 저장되지 않습니다.',
  }
}

function saveLockUnavailable(): Extract<SaveCampaignResult, { ok: false }> {
  return {
    ok: false,
    reason: 'SAVE_LOCK_UNAVAILABLE',
    message:
      '이 브라우저에서는 여러 창의 진행을 안전하게 조정할 수 없습니다. 현재 진행 파일을 내려받은 뒤 Web Locks를 지원하는 최신 브라우저에서 계속하세요.',
  }
}

function browserSaveLocks(): LockManager | null {
  if (typeof navigator === 'undefined') return null
  try {
    return navigator.locks ?? null
  } catch {
    return null
  }
}

function writeImmutable(
  storage: Storage,
  key: string,
  content: string,
): void {
  const existing = storage.getItem(key)
  if (existing === null) {
    storage.setItem(key, content)
    return
  }
  if (existing !== content) throw new Error('immutable local save collision')
}

function journalCache(
  storage: Storage,
  kind: 'commands' | 'events',
): WeakMap<object, LocalJournalCacheEntry> {
  let caches = localStorageJournalCaches.get(storage)
  if (!caches) {
    caches = {
      commands: new WeakMap<object, LocalJournalCacheEntry>(),
      events: new WeakMap<object, LocalJournalCacheEntry>(),
    }
    localStorageJournalCaches.set(storage, caches)
  }
  return caches[kind]
}

interface LocalJournalWrite<T> {
  headKey: string | null
  sealedChunkCount: number
  tail: T[]
}

function writeLocalJournalChunks<T>(
  storage: Storage,
  kind: 'commands' | 'events',
  journal: Journal<T>,
): LocalJournalWrite<T> {
  const cache = journalCache(storage, kind)
  const uncached: JournalChunk<T>[] = []
  let cursor = journal.head
  let previousKey: string | null = null
  let previousSnapshot: LocalJournalNodeSnapshot | null = null

  while (cursor) {
    const cached = cache.get(cursor)
    if (cached) {
      // Reassert one bounded cached head. This repairs an externally deleted head
      // without reading or walking the already committed chain on ordinary saves.
      storage.setItem(cached.key, cached.content)
      previousKey = cached.key
      previousSnapshot = cached.snapshot
      break
    }
    uncached.push(cursor)
    cursor = cursor.previous
  }

  for (let index = uncached.length - 1; index >= 0; index -= 1) {
    const chunk = uncached[index]
    const items = [...chunk.items]
    const content = JSON.stringify({ previousKey, previousSnapshot, items })
    const key = `${SAVE_STORAGE_KEY}.journal.${kind}.${contentHash(content)}`
    writeImmutable(storage, key, content)
    const snapshot = { previousKey, items }
    cache.set(chunk, { key, content, snapshot })
    previousKey = key
    previousSnapshot = snapshot
  }

  return {
    headKey: previousKey,
    sealedChunkCount:
      (journal.length - journal.tail.length) / JOURNAL_CHUNK_SIZE,
    tail: [...journal.tail],
  }
}

function saveCampaignWhileLocked(
  storage: Storage,
  state: CampaignState,
  savedAt?: string,
  expectedRevision?: CampaignStorageRevision,
): SaveCampaignResult {
  try {
    if (
      expectedRevision !== undefined &&
      storedCampaignRevision(storage) !== expectedRevision
    ) {
      return storageConflict()
    }
    const commandJournal = writeLocalJournalChunks(
      storage,
      'commands',
      state.commandLog,
    )
    const eventJournal = writeLocalJournalChunks(
      storage,
      'events',
      state.eventLog,
    )
    const checkpoint = portableCheckpoint(state)
    const commandProtocol: CommandProtocolMetadata = {
      segments: state.commandProtocol.segments.map((segment) => ({
        ...segment,
      })),
    }
    const checkpointHash = portableCheckpointHash(
      SAVE_FORMAT_VERSION,
      commandProtocol,
      checkpoint,
    )
    const effectiveSavedAt = savedAt ?? new Date().toISOString()
    const manifest: LocalSaveManifest = {
      kind: LOCAL_MANIFEST_KIND,
      version: SAVE_FORMAT_VERSION,
      savedAt: effectiveSavedAt,
      campaignSeed: state.campaignSeed,
      commandProtocol,
      commandSequence: state.commandSequence,
      checkpoint,
      checkpointHash,
      commandHeadKey: commandJournal.headKey,
      commandSealedChunkCount: commandJournal.sealedChunkCount,
      commandTail: commandJournal.tail,
      eventHeadKey: eventJournal.headKey,
      eventSealedChunkCount: eventJournal.sealedChunkCount,
      eventTail: eventJournal.tail,
    }
    if (
      expectedRevision !== undefined &&
      storedCampaignRevision(storage) !== expectedRevision
    ) {
      return storageConflict()
    }
    const serializedManifest = JSON.stringify(manifest)
    storage.setItem(SAVE_STORAGE_KEY, serializedManifest)
    if (storage.getItem(SAVE_STORAGE_KEY) !== serializedManifest) {
      return storageConflict()
    }
    return {
      ok: true,
      revision: revisionForStorageEntry(SAVE_STORAGE_KEY, serializedManifest),
    }
  } catch {
    return {
      ok: false,
      reason: 'STORAGE_UNAVAILABLE',
      message: '브라우저 저장 공간에 캠페인을 기록할 수 없습니다.',
    }
  }
}

const CAMPAIGN_SAVE_LOCK_NAME = 'permission-zero.campaign-save.v3'

export async function saveCampaign(
  storage: Storage,
  state: CampaignState,
  savedAt?: string,
  expectedRevision?: CampaignStorageRevision,
): Promise<SaveCampaignResult> {
  const locks = browserSaveLocks()
  if (!locks) return saveLockUnavailable()
  try {
    return await locks.request(
      CAMPAIGN_SAVE_LOCK_NAME,
      { mode: 'exclusive' },
      () => saveCampaignWhileLocked(storage, state, savedAt, expectedRevision),
    )
  } catch {
    return saveLockUnavailable()
  }
}

function readLocalChunks(
  storage: Storage,
  kind: 'commands' | 'events',
  headKey: unknown,
  sealedChunkCount: unknown,
  tail: unknown,
): {
  chunks: unknown[][]
  headKey: string | null
  headContent: string | null
  headSnapshot: LocalJournalNodeSnapshot | null
} | null {
  if (
    (headKey !== null && !isNonEmptyString(headKey)) ||
    !isIntegerInRange(sealedChunkCount, 0) ||
    ((sealedChunkCount === 0) !== (headKey === null)) ||
    !Array.isArray(tail) ||
    tail.length > JOURNAL_CHUNK_SIZE ||
    (sealedChunkCount > 0 && tail.length === 0)
  ) {
    return null
  }
  const reverseChunks: unknown[][] = []
  const visited = new Set<string>()
  const expectedPrefix = `${SAVE_STORAGE_KEY}.journal.${kind}.`
  const originalHeadKey = headKey
  let headContent: string | null = null
  let headSnapshot: LocalJournalNodeSnapshot | null = null
  let fallbackSnapshot: LocalJournalNodeSnapshot | null = null
  let chainHasRecoverySnapshots = true
  let key = headKey
  for (let index = 0; index < sealedChunkCount; index += 1) {
    if (typeof key !== 'string' || visited.has(key)) return null
    visited.add(key)
    const serialized = storage.getItem(key)
    let parsed: unknown
    if (
      serialized !== null &&
      key === `${expectedPrefix}${contentHash(serialized)}`
    ) {
      try {
        parsed = JSON.parse(serialized)
      } catch {
        parsed = null
      }
    } else {
      parsed = null
    }
    let storedSnapshot: LocalJournalNodeSnapshot | null = null
    let nextFallback: LocalJournalNodeSnapshot | null = null
    if (
      isRecord(parsed) &&
      (hasOnlyKeys(parsed, ['previousKey', 'items']) ||
        hasOnlyKeys(parsed, ['previousKey', 'previousSnapshot', 'items'])) &&
      (parsed.previousKey === null || isNonEmptyString(parsed.previousKey)) &&
      Array.isArray(parsed.items) &&
      parsed.items.length === JOURNAL_CHUNK_SIZE
    ) {
      storedSnapshot = {
        previousKey: parsed.previousKey as string | null,
        items: parsed.items,
      }
      if ('previousSnapshot' in parsed) {
        nextFallback = validLocalJournalSnapshot(parsed.previousSnapshot)
        if (parsed.previousSnapshot !== null && nextFallback === null) return null
      } else {
        chainHasRecoverySnapshots = false
      }
    }
    const node = storedSnapshot ?? fallbackSnapshot
    if (!node) return null
    if (
      index === 0 &&
      storedSnapshot &&
      serialized !== null
    ) {
      headContent = serialized
      headSnapshot = storedSnapshot
    }
    reverseChunks.push(node.items)
    key = node.previousKey
    fallbackSnapshot = nextFallback
  }
  if (key !== null) return null
  const chunks = reverseChunks.reverse()
  if (tail.length > 0) chunks.push(tail)
  return {
    chunks,
    headKey: originalHeadKey as string | null,
    // A legacy linked chain has no parent snapshots. Avoid caching its head so
    // the first subsequent save rewrites the validated in-memory chain into the
    // recoverable format instead of publishing another legacy dependency.
    headContent: chainHasRecoverySnapshots ? headContent : null,
    headSnapshot: chainHasRecoverySnapshots ? headSnapshot : null,
  }
}

function validLocalJournalSnapshot(value: unknown): LocalJournalNodeSnapshot | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['previousKey', 'items']) ||
    (value.previousKey !== null && !isNonEmptyString(value.previousKey)) ||
    !Array.isArray(value.items) ||
    value.items.length !== JOURNAL_CHUNK_SIZE
  ) return null
  return {
    previousKey: value.previousKey as string | null,
    items: value.items,
  }
}

function cacheLoadedJournalHead<T>(
  storage: Storage,
  kind: 'commands' | 'events',
  journal: Journal<T>,
  headKey: string | null,
  headContent: string | null,
  headSnapshot: LocalJournalNodeSnapshot | null,
): void {
  if (journal.head && headKey && headContent && headSnapshot) {
    journalCache(storage, kind).set(journal.head, {
      key: headKey,
      content: headContent,
      snapshot: headSnapshot,
    })
  }
}

function decodeLocalManifest(
  storage: Storage,
  serialized: string,
): DecodeSaveResult | null {
  let manifest: unknown
  try {
    manifest = JSON.parse(serialized)
  } catch {
    return null
  }
  if (!isRecord(manifest) || manifest.kind !== LOCAL_MANIFEST_KIND) return null
  if (
    !hasOnlyKeys(manifest, [
      'kind',
      'version',
      'savedAt',
      'campaignSeed',
      'commandProtocol',
      'commandSequence',
      'checkpoint',
      'checkpointHash',
      'commandHeadKey',
      'commandSealedChunkCount',
      'commandTail',
      'eventHeadKey',
      'eventSealedChunkCount',
      'eventTail',
    ]) ||
    (manifest.version !== 3 &&
      manifest.version !== 4 &&
      manifest.version !== 5 &&
      manifest.version !== 6 &&
      manifest.version !== SAVE_FORMAT_VERSION) ||
    !isNonEmptyString(manifest.checkpointHash)
  ) {
    return corrupt()
  }
  if (
    manifest.checkpointHash !==
    portableCheckpointHash(
      manifest.version,
      manifest.commandProtocol,
      manifest.checkpoint,
    )
  ) return corrupt()
  const commandJournal = readLocalChunks(
    storage,
    'commands',
    manifest.commandHeadKey,
    manifest.commandSealedChunkCount,
    manifest.commandTail,
  )
  const eventJournal = readLocalChunks(
    storage,
    'events',
    manifest.eventHeadKey,
    manifest.eventSealedChunkCount,
    manifest.eventTail,
  )
  if (!commandJournal || !eventJournal) return corrupt()
  const commandChunks = commandJournal.chunks
  const eventChunks = eventJournal.chunks
  const decoded = decodeSave(
    JSON.stringify({
      version: manifest.version,
      savedAt: manifest.savedAt,
      campaignSeed: manifest.campaignSeed,
      commandProtocol: manifest.commandProtocol,
      commandSequence: manifest.commandSequence,
      state: manifest.checkpoint,
      journals: {
        commands: { chunkSize: JOURNAL_CHUNK_SIZE, chunks: commandChunks },
        events: { chunkSize: JOURNAL_CHUNK_SIZE, chunks: eventChunks },
      },
      integrity: {
        checkpointHash: portableCheckpointHash(
          manifest.version,
          manifest.commandProtocol,
          manifest.checkpoint,
        ),
        commandChunkHashes: commandChunks.map((chunk) =>
          contentHash(JSON.stringify(chunk)),
        ),
        eventChunkHashes: eventChunks.map((chunk) =>
          contentHash(JSON.stringify(chunk)),
        ),
      },
    }),
  )
  if (decoded.ok) {
    cacheLoadedJournalHead(
      storage,
      'commands',
      decoded.envelope.state.commandLog,
      commandJournal.headKey,
      commandJournal.headContent,
      commandJournal.headSnapshot,
    )
    cacheLoadedJournalHead(
      storage,
      'events',
      decoded.envelope.state.eventLog,
      eventJournal.headKey,
      eventJournal.headContent,
      eventJournal.headSnapshot,
    )
  }
  return decoded
}

export function loadCampaign(storage: Storage): LoadCampaignResult {
  let stored: StoredCampaignEntry | null
  try {
    stored = storedCampaignEntry(storage)
  } catch {
    return {
      status: 'error',
      reason: 'STORAGE_UNAVAILABLE',
      message: '브라우저 저장 공간을 읽을 수 없습니다.',
      revision: null,
    }
  }
  if (stored === null) return { status: 'empty' }

  const decoded =
    decodeLocalManifest(storage, stored.serialized) ?? decodeSave(stored.serialized)
  if (!decoded.ok) {
    return {
      status: 'error',
      reason: decoded.reason,
      message: decoded.message,
      revision: stored.revision,
    }
  }
  return {
    status: 'loaded',
    state: decoded.envelope.state,
    envelope: decoded.envelope,
    revision: stored.revision,
  }
}
