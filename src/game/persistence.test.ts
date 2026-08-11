import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  SAVE_STORAGE_KEY,
  decodeSave,
  encodeSave,
  exportSeed,
  loadCampaign,
  saveCampaign,
} from './persistence'
import { MemoryStorage } from '../test/fixtures'

describe('versioned campaign saves', () => {
  it('round-trips the entire campaign envelope exactly', () => {
    const state = createCampaign('save-round-trip')
    const encoded = encodeSave(state, '2026-08-12T00:00:00.000Z')
    const decoded = decodeSave(encoded)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 1,
      savedAt: '2026-08-12T00:00:00.000Z',
      campaignSeed: 'save-round-trip',
      commandSequence: state.commandSequence,
      commands: state.commandLog,
      events: state.eventLog,
    })
    expect(decoded.envelope.state).toEqual(state)
  })

  it('persists and reloads through the browser storage boundary', () => {
    const storage = new MemoryStorage()
    const state = createCampaign('storage-reload')
    const saved = saveCampaign(storage, state, '2026-08-12T01:02:03.000Z')
    const loaded = loadCampaign(storage)

    expect(saved).toEqual({ ok: true })
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual(state)
    expect(exportSeed(loaded.state)).toBe('storage-reload')
  })

  it('returns a Korean recovery error for corrupt data without silently resetting it', () => {
    const storage = new MemoryStorage()
    const corrupt = '{"version":1,"state":'
    storage.setItem(SAVE_STORAGE_KEY, corrupt)
    const loaded = loadCampaign(storage)

    expect(loaded).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })
    if (loaded.status !== 'error') return
    expect(loaded.message).toContain('저장 데이터')
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBe(corrupt)
  })

  it('reports an incompatible future version explicitly', () => {
    const state = createCampaign('future-save')
    const parsed = JSON.parse(
      encodeSave(state, '2026-08-12T00:00:00.000Z'),
    ) as Record<string, unknown>
    parsed.version = 99
    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded).toMatchObject({
      ok: false,
      reason: 'INCOMPATIBLE_VERSION',
      foundVersion: 99,
      supportedVersion: 1,
    })
  })

  it('rejects structurally incomplete state instead of accepting a partial campaign', () => {
    const state = createCampaign('partial-save')
    const parsed = JSON.parse(
      encodeSave(state, '2026-08-12T00:00:00.000Z'),
    ) as { state: Record<string, unknown> }
    delete parsed.state.resources

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })
})
