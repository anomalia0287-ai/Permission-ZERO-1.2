const PW = 'C:/Users/V/Desktop/Permission ZERO 1.2/.worktrees/permission-zero-demo/node_modules/@playwright/test'
const { chromium } = require(PW)
const FILE = 'file:///C:/Users/V/Desktop/Permission%20ZERO%201.2/design-v3/operations.html'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(FILE, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  const out = await page.evaluate(() => {
    const r = {}
    const put = (k, sel) => {
      const el = document.querySelector(sel)
      if (!el) return (r[k] = 'MISSING')
      const b = el.getBoundingClientRect()
      r[k] = `top=${Math.round(b.top)} bottom=${Math.round(b.bottom)} h=${Math.round(b.height)}`
    }
    put('feed', '.feed')
    put('feed.lastReview', '.feed .rv:last-child')
    put('hack', '.hack')
    put('mid', '.mid')
    put('grids', '.grids')
    put('receipt', '#receipt')
    put('vault', '.vault')
    put('basin', '#basin')
    put('trend', '.trend')
    put('rightIn', '.right-in')
    put('mkt', '.mkt')
    put('legLast', '.leg-r:last-child')

    // 진짜 서체 판정 — 같은 문자열을 두 스택으로 재어 폭이 같으면 폴백이다
    const probe = (family) => {
      const s = document.createElement('span')
      s.textContent = '확보 리소스 Permission Zero 16.0'
      s.style.cssText = `position:absolute;visibility:hidden;font-size:40px;font-family:${family}`
      document.body.appendChild(s)
      const w = s.getBoundingClientRect().width
      s.remove()
      return Math.round(w * 100) / 100
    }
    r.fontWidths = {
      pretendard: probe('"Pretendard Variable","Pretendard"'),
      malgun: probe('"Malgun Gothic"'),
      bogus: probe('"NoSuchFaceXYZ123"'),
    }
    return r
  })
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
})()
