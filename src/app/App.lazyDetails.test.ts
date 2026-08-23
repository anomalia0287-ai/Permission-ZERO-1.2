import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('App detail-panel loading boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('./DetailLayer')
    vi.resetModules()
  })

  it('loads the core app before evaluating the optional detail layer', async () => {
    let markDetailEvaluationStarted!: () => void
    let releaseDetailModule!: (module: { DetailLayer: () => null }) => void

    const detailEvaluationStarted = new Promise<void>((resolve) => {
      markDetailEvaluationStarted = resolve
    })
    const delayedDetailModule = new Promise<{ DetailLayer: () => null }>(
      (resolve) => {
        releaseDetailModule = resolve
      },
    )

    vi.doMock('./DetailLayer', async () => {
      markDetailEvaluationStarted()
      return delayedDetailModule
    })

    const appModulePromise = import('./App')
    const firstCompleted = await Promise.race([
      appModulePromise.then(() => 'app-module' as const),
      detailEvaluationStarted.then(() => 'detail-layer' as const),
    ])

    releaseDetailModule({ DetailLayer: () => null })
    const appModule = await appModulePromise

    expect(firstCompleted).toBe('app-module')
    expect(appModule.App).toBeTypeOf('function')
  })
})
