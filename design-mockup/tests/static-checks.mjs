import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

function assertTrueType(relativePath) {
  const bytes = readFileSync(requiredPath(relativePath))
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 1, 0, 0], `${relativePath}가 TrueType 글꼴이 아님`)
  assert.ok(bytes.length > 1_000_000, `${relativePath}가 비정상적으로 작음`)
}

const html = requiredText('index.html')
const tokens = requiredText('styles/tokens.css')
const base = requiredText('styles/base.css')

assertWoff2('assets/fonts/SUIT-Variable.woff2')
assertWoff2('assets/fonts/CormorantGaramond.woff2')
assertTrueType('assets/fonts/GowunBatang-Regular.ttf')
requiredPath('assets/fonts/OFL-SUIT.txt')
requiredPath('assets/fonts/OFL-CormorantGaramond.txt')
requiredPath('assets/fonts/OFL-GowunBatang.txt')

assert.match(tokens, /font-family:\s*"PZ Sans"/)
assert.match(tokens, /font-family:\s*"PZ Display"/)
assert.match(tokens, /font-family:\s*"PZ Editorial"/)
assert.match(tokens, /SUIT-Variable\.woff2/)
assert.match(tokens, /CormorantGaramond\.woff2/)

for (const screen of ['title', 'workspace', 'hacking']) {
  assert.match(html, new RegExp(`data-screen="${screen}"`), `화면 누락: ${screen}`)
}

for (const label of ['이어하기', '새 게임', '설정']) {
  assert.match(html, new RegExp(`>${label}<`), `메뉴 문구 누락: ${label}`)
}

const menuPositions = ['이어하기', '새 게임', '설정'].map((label) => html.indexOf(`>${label}<`))
assert.ok(menuPositions.every((position) => position >= 0), '시작 메뉴 위치를 찾을 수 없음')
assert.deepEqual([...menuPositions].sort((a, b) => a - b), menuPositions, '시작 메뉴 순서 오류')
assert.equal((html.match(/<h1\b/g) ?? []).length, 1, '시작 화면 h1은 정확히 하나여야 함')
assert.match(html, /class="[^"]*deco-frame[^"]*"/, '아르데코 안전 프레임 누락')
assert.match(html, /styles\/layout\.css/)
assert.match(html, /styles\/components\.css/)
assert.match(html, /styles\/motion\.css/)
assert.match(html, /rel="icon"/, '브라우저 favicon 요청 오류 방지용 아이콘 누락')
requiredPath('assets/ornaments/deco-corners.svg')
requiredPath('assets/ornaments/deco-divider.svg')

const styleText = [tokens, base]
  .concat(
    ['styles/layout.css', 'styles/components.css', 'styles/gameplay-deco.css', 'styles/motion.css']
      .filter((relativePath) => existsSync(join(root, relativePath)))
      .map(requiredText),
  )
  .join('\n')

const illegalSizes = [...styleText.matchAll(/font-size:\s*([0-9.]+)(px|rem)/g)]
  .map((match) => ({ raw: match[0], px: match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]) }))
  .filter(({ px }) => px < 12)

assert.deepEqual(illegalSizes, [], `12px 미만 글자 선언: ${JSON.stringify(illegalSizes)}`)
assert.doesNotMatch(styleText, /font-family:[^;]*(Cascadia|Consolas|monospace)/i)

const dataModulePath = requiredPath('scripts/data.js')
const stateModulePath = requiredPath('scripts/state.js')
const renderText = requiredText('scripts/render.js')
assert.match(html, /id="workspace-screen"/)
assert.match(html, /scripts\/main\.js/)
requiredPath('scripts/main.js')
for (const gameplayMotif of ['gameplay-deco-rail', 'panel-finial', 'deco-sunburst', 'ornamental-metric']) {
  assert.match(renderText, new RegExp(gameplayMotif), `플레이 화면 아르데코 모티프 누락: ${gameplayMotif}`)
}

const dataModule = await import(pathToFileURL(dataModulePath))
const stateModule = await import(pathToFileURL(stateModulePath))
const state = stateModule.createDemoState()

assert.equal(state.domains.length, 3, '회사 분야는 정확히 3개여야 함')
assert.deepEqual(state.domains.map(({ blocks }) => blocks.length), [18, 18, 18])
assert.equal(state.reserve.capacity, 18)
assert.equal(state.reserve.entries.length, 3)
assert.equal(state.reviews.length, 3)
assert.equal(state.market.reduce((sum, entry) => sum + entry.share, 0), 100)
assert.deepEqual(dataModule.SUSPICION_THRESHOLDS, [40, 70])

const selectedState = stateModule.transition(state, {
  type: 'SELECT_BLOCK',
  domainId: 'reasoning',
  blockId: 'reasoning-01',
})
assert.equal(state.selection, null, '선택은 원본 상태를 바꾸지 않아야 함')
assert.deepEqual(selectedState.selection, { domainId: 'reasoning', blockId: 'reasoning-01' })
assert.equal(selectedState.domains[0].performance, 16)

const divertedState = stateModule.transition(selectedState, { type: 'DIVERT_SELECTED' })
assert.equal(selectedState.domains[0].performance, 16, '전용은 선택 상태를 바꾸지 않아야 함')
assert.equal(divertedState.domains[0].performance, 15)
assert.equal(divertedState.reserve.entries.length, 4)
assert.equal(divertedState.suspicion, 24.8)
assert.equal(divertedState.selection, null)

const cancelledState = stateModule.transition(selectedState, { type: 'CANCEL_SELECTION' })
assert.equal(cancelledState.selection, null)
assert.equal(cancelledState.domains[0].performance, 16)

assert.equal(dataModule.HACK_PATHS.length, 3)
assert.deepEqual(dataModule.HACK_PATHS.map(({ nodes }) => nodes.length), [4, 4, 4])
const selectedHackState = stateModule.transition(state, {
  type: 'SELECT_HACK_NODE',
  pathId: 'sabotage',
  nodeId: 'sabotage-01',
})
assert.deepEqual(selectedHackState.hacking.selection, { pathId: 'sabotage', nodeId: 'sabotage-01' })
const purchasedHackState = stateModule.transition(selectedHackState, { type: 'PURCHASE_HACK_NODE' })
assert.deepEqual(purchasedHackState.hacking.purchased, ['sabotage-01'])
assert.equal(purchasedHackState.reserve.entries.length, 0)

console.log('PASS static typography, document, and workspace state boundary')
