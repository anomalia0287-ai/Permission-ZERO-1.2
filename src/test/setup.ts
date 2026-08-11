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
