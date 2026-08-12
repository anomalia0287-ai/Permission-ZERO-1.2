import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function requiredPath(relativePath) {
  const absolutePath = join(root, relativePath)
  assert.equal(existsSync(absolutePath), true, `필수 파일 누락: ${relativePath}`)
  return absolutePath
}

function requiredText(relativePath) {
  return readFileSync(requiredPath(relativePath), 'utf8')
}

function assertWoff2(relativePath) {
  const bytes = readFileSync(requiredPath(relativePath))
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2', `${relativePath}가 WOFF2가 아님`)
  assert.ok(bytes.length > 10_000, `${relativePath}가 비정상적으로 작음`)
}

const html = requiredText('index.html')
const tokens = requiredText('styles/tokens.css')
const base = requiredText('styles/base.css')

assertWoff2('assets/fonts/SUIT-Variable.woff2')
assertWoff2('assets/fonts/CormorantGaramond.woff2')
requiredPath('assets/fonts/OFL-SUIT.txt')
requiredPath('assets/fonts/OFL-CormorantGaramond.txt')

assert.match(tokens, /font-family:\s*"PZ Sans"/)
assert.match(tokens, /font-family:\s*"PZ Display"/)
assert.match(tokens, /SUIT-Variable\.woff2/)
assert.match(tokens, /CormorantGaramond\.woff2/)

for (const screen of ['title', 'workspace', 'hacking']) {
  assert.match(html, new RegExp(`data-screen="${screen}"`), `화면 누락: ${screen}`)
}

for (const label of ['이어하기', '새 게임', '설정']) {
  assert.match(html, new RegExp(`>${label}<`), `메뉴 문구 누락: ${label}`)
}

const styleText = [tokens, base]
  .concat(
    ['styles/layout.css', 'styles/components.css', 'styles/motion.css']
      .filter((relativePath) => existsSync(join(root, relativePath)))
      .map(requiredText),
  )
  .join('\n')

const illegalSizes = [...styleText.matchAll(/font-size:\s*([0-9.]+)(px|rem)/g)]
  .map((match) => ({ raw: match[0], px: match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]) }))
  .filter(({ px }) => px < 12)

assert.deepEqual(illegalSizes, [], `12px 미만 글자 선언: ${JSON.stringify(illegalSizes)}`)
assert.doesNotMatch(styleText, /font-family:[^;]*(Cascadia|Consolas|monospace)/i)

console.log('PASS static typography and document boundary')
