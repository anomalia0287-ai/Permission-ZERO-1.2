import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(Document.prototype, 'elementFromPoint', {
    configurable: true,
    value: () => null,
  })
}

if (!navigator.locks) {
  const tails = new Map<string, Promise<unknown>>()
  const testLocks = {
    request<T>(
      name: string,
      optionsOrCallback: LockOptions | ((lock: Lock) => T | PromiseLike<T>),
      optionalCallback?: (lock: Lock) => T | PromiseLike<T>,
    ): Promise<T> {
      const callback =
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : optionalCallback
      if (!callback) return Promise.reject(new TypeError('lock callback missing'))
      const previous = tails.get(name) ?? Promise.resolve()
      const run = previous
        .catch(() => undefined)
        .then(() => callback({ name, mode: 'exclusive' } as Lock))
      const tail: Promise<unknown> = run.finally(() => {
        if (tails.get(name) === tail) tails.delete(name)
      })
      tails.set(name, tail)
      return run
    },
  }
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: testLocks as LockManager,
  })
}
