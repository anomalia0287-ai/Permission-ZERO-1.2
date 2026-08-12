import type { RandomStream } from './model'

const UTF8_ENCODER = new TextEncoder()
const UINT32_RANGE = 0x1_0000_0000

function hash32(value: string): number {
  let hash = 0x811c9dc5

  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }

  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16

  return hash >>> 0
}

export function random01(
  seed: string,
  serviceDay: number,
  stream: RandomStream,
  sequence: number,
): number {
  const key = `${seed}|${serviceDay}|${stream}|${sequence}`
  return hash32(key) / UINT32_RANGE
}
