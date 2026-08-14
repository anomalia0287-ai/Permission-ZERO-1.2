import type { CampaignState } from './model'
import {
  decodeSave,
  encodeSave,
  type DecodeSaveResult,
} from './persistence'

const PROGRESS_EXPORT_PREFIX = 'PZ7:'
const LEGACY_PROGRESS_EXPORT_PREFIXES = [
  'PZ6:',
  'PZ5:',
  'PZ4:',
  'PZ3:',
  'PZ2:',
] as const

// One MiB of encoded body plus the four-character protocol prefix. The check
// happens before regex, base64 decoding, byte allocation, UTF-8, or JSON work.
export const PROGRESS_EXPORT_MAX_ENCODED_LENGTH = 1_048_580
export const PROGRESS_FILE_MAX_BYTES = 64 * 1024 * 1024

const STRICT_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function progressExportCorrupt(): DecodeSaveResult {
  return {
    ok: false,
    reason: 'CORRUPT_SAVE',
    message: '진행 내보내기 자료가 올바르지 않거나 손상되었습니다.',
  }
}

export type EncodeProgressExportResult =
  | { ok: true; payload: string }
  | { ok: false; reason: 'too-large' }

export function encodeProgressExport(
  state: CampaignState,
): EncodeProgressExportResult {
  const bytes = new TextEncoder().encode(encodeSave(state))
  const encodedLength =
    PROGRESS_EXPORT_PREFIX.length + 4 * Math.ceil(bytes.length / 3)
  if (encodedLength > PROGRESS_EXPORT_MAX_ENCODED_LENGTH) {
    return { ok: false, reason: 'too-large' }
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { ok: true, payload: `${PROGRESS_EXPORT_PREFIX}${btoa(binary)}` }
}

export function decodeProgressExport(payload: string): DecodeSaveResult {
  if (payload.length > PROGRESS_EXPORT_MAX_ENCODED_LENGTH) {
    return progressExportCorrupt()
  }
  const prefix = payload.startsWith(PROGRESS_EXPORT_PREFIX)
    ? PROGRESS_EXPORT_PREFIX
    : LEGACY_PROGRESS_EXPORT_PREFIXES.find((candidate) =>
        payload.startsWith(candidate),
      ) ?? null
  if (!prefix) return progressExportCorrupt()
  const encoded = payload.slice(prefix.length)
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !STRICT_BASE64.test(encoded)
  ) {
    return progressExportCorrupt()
  }
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const decoded = decodeSave(serialized)
    return decoded.ok ? decoded : progressExportCorrupt()
  } catch {
    return progressExportCorrupt()
  }
}

export interface ProgressFile {
  fileName: string
  mimeType: 'application/vnd.permission-zero.progress+json'
  content: string
}

export function encodeProgressFile(
  state: CampaignState,
  savedAt = new Date().toISOString(),
): ProgressFile {
  const safeTimestamp = savedAt.replaceAll(':', '-').replaceAll('.', '-')
  return {
    fileName: `permission-zero-${safeTimestamp}.pz7`,
    mimeType: 'application/vnd.permission-zero.progress+json',
    content: encodeSave(state, savedAt),
  }
}

function utf8BytesWithinLimit(value: string, limit: number): boolean {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      bytes += 1
    } else if (codeUnit <= 0x7ff) {
      bytes += 2
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
    if (bytes > limit) return false
  }
  return true
}

export function decodeProgressFile(content: string): DecodeSaveResult {
  if (
    typeof content !== 'string' ||
    content.length === 0 ||
    !utf8BytesWithinLimit(content, PROGRESS_FILE_MAX_BYTES)
  ) {
    return progressExportCorrupt()
  }
  const decoded = decodeSave(content)
  return decoded.ok ? decoded : progressExportCorrupt()
}
