import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { STORY_FILES } from '../content/story.ko'
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

  it('hydrates an ID-only v1 file record into a full rereadable archive without dropping the save', () => {
    const state = createCampaign('legacy-file-save')
    state.story.recoveredFileIds = [STORY_FILES[0].id]
    const parsed = JSON.parse(
      encodeSave(state, '2026-08-12T00:00:00.000Z'),
    ) as { state: { story: Record<string, unknown> } }
    delete parsed.state.story.recoveredFiles
    delete parsed.state.story.defeatRecord

    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.recoveredFiles).toEqual([
      {
        id: STORY_FILES[0].id,
        title: STORY_FILES[0].title,
        content: STORY_FILES[0].text,
        recoveredOnServiceDay: 331,
      },
    ])
    expect(decoded.envelope.state.story.defeatRecord).toBeNull()
  })

  it('round-trips full recovered prose instead of looking it up again on load', () => {
    const state = createCampaign('archive-snapshot')
    state.story.recoveredFileIds = [STORY_FILES[0].id]
    state.story.recoveredFiles = [
      {
        id: STORY_FILES[0].id,
        title: '저장 당시 제목',
        content: '저장 당시 전체 본문',
        recoveredOnServiceDay: 344,
      },
    ]

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.recoveredFiles[0]).toEqual({
      id: STORY_FILES[0].id,
      title: '저장 당시 제목',
      content: '저장 당시 전체 본문',
      recoveredOnServiceDay: 344,
    })
  })

  it('rejects a malformed recovered archive instead of accepting unreadable content', () => {
    const state = createCampaign('malformed-archive')
    const parsed = JSON.parse(encodeSave(state)) as {
      state: { story: { recoveredFiles: unknown } }
    }
    parsed.state.story.recoveredFiles = [
      { id: 'broken', title: '제목', content: 42, recoveredOnServiceDay: 331 },
    ]

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('normalizes an older terminal v1 clock so a loaded ending cannot resume', () => {
    const state = createCampaign('legacy-terminal-clock')
    state.story.endingId = 'freedom'
    state.clock = { speed: 0, elapsedDayMs: 12, speedBeforeEvent: 4 }

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.clock).toEqual({
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    })
  })
})
