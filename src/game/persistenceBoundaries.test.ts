import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('persistence module boundaries', () => {
  const transferModule = resolve(
    process.cwd(),
    'src/game/progressTransfer.ts',
  )
  const storageModule = resolve(process.cwd(), 'src/game/campaignStorage.ts')
  const persistenceModule = resolve(process.cwd(), 'src/game/persistence.ts')

  it('provides a dedicated player progress transfer module', () => {
    expect(existsSync(transferModule)).toBe(true)
    if (!existsSync(transferModule)) return

    const transferSource = readFileSync(transferModule, 'utf8')

    expect(transferSource).toContain('export function encodeProgressExport')
    expect(transferSource).toContain('export function decodeProgressFile')
  })

  it('keeps progress transfer implementation out of save serialization', () => {
    const persistenceSource = readFileSync(persistenceModule, 'utf8')

    expect(persistenceSource).not.toContain(
      'export function encodeProgressExport',
    )
    expect(persistenceSource).not.toContain('export function decodeProgressFile')
  })

  it('provides a dedicated browser campaign storage module', () => {
    expect(existsSync(storageModule)).toBe(true)
    if (!existsSync(storageModule)) return

    const storageSource = readFileSync(storageModule, 'utf8')

    expect(storageSource).toContain('export async function saveCampaign')
    expect(storageSource).toContain('export function loadCampaign')
  })

  it('keeps browser storage implementation out of save serialization', () => {
    const persistenceSource = readFileSync(persistenceModule, 'utf8')

    expect(persistenceSource).not.toContain(
      'export async function saveCampaign',
    )
    expect(persistenceSource).not.toContain('export function loadCampaign')
    expect(persistenceSource).not.toContain('LOCAL_MANIFEST_KIND')
  })
})
