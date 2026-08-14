const PW = 'C:/Users/V/Desktop/Permission ZERO 1.2/.worktrees/permission-zero-demo/node_modules/@playwright/test'
const { chromium } = require(PW)
const path = require('path')
const fs = require('fs')

const FILE = 'file:///C:/Users/V/Desktop/Permission%20ZERO%201.2/design-v3/operations.html'
const OUT = path.join(__dirname, 'shots')
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { w: 1280, h: 720 },
  { w: 1440, h: 900 },
]

;(async () => {
  const browser = await chromium.launch()
  for (const v of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 })
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(FILE, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)

    // 실제 적용된 서체를 기록한다 — 선언만 하고 폴백되는 실패를 막기 위해
    const fontInfo = await page.evaluate(() => {
      const probe = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).fontFamily : null
      }
      return {
        body: probe('.rv-t'),
        available: ['Pretendard', 'Pretendard Variable', 'Malgun Gothic'].filter((f) =>
          document.fonts.check(`15px "${f}"`),
        ),
      }
    })

    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }))

    await page.screenshot({ path: path.join(OUT, `operations-${v.w}x${v.h}.png`) })

    // 핵심 동사 — 블록을 임계 이상 끌어낸 상태에서 정지 캡처
    const blk = page.locator('.grid[data-dom="0"] .blk').nth(7)
    const box = await blk.boundingBox()
    const basin = await page.locator('#basin').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 40, { steps: 6 })
    await page.mouse.move(basin.x + basin.width * 0.24, basin.y + basin.height * 0.62, { steps: 12 })
    await page.waitForTimeout(140)
    await page.screenshot({ path: path.join(OUT, `detach-${v.w}x${v.h}.png`) })
    await page.mouse.up()
    await page.waitForTimeout(320)
    await page.screenshot({ path: path.join(OUT, `settled-${v.w}x${v.h}.png`) })

    console.log(`${v.w}x${v.h}  overflow x=${overflow.x} y=${overflow.y}  errors=${errors.length}`)
    console.log(`   computed body font: ${fontInfo.body}`)
    console.log(`   resolvable: ${fontInfo.available.join(', ') || '(없음 — 시스템 폴백)'}`)
    if (errors.length) console.log('   ' + errors.join('\n   '))
    await page.close()
  }
  await browser.close()
})()
