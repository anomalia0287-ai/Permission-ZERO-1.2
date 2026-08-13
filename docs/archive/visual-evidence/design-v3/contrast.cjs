const PW = 'C:/Users/V/Desktop/Permission ZERO 1.2/.worktrees/permission-zero-demo/node_modules/@playwright/test'
const { chromium } = require(PW)
const FILE = 'file:///C:/Users/V/Desktop/Permission%20ZERO%201.2/design-v3/operations.html'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(FILE, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  const rows = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    // 실제 배경을 위로 거슬러 올라가 찾는다
    const bgOf = (el) => {
      let n = el
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && !bg.startsWith('rgba(0, 0, 0, 0)')) return parse(bg)
        n = n.parentElement
      }
      return [10, 15, 18]
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
    }
    const targets = [
      ['리뷰 본문', '.rv-t'],
      ['리뷰 작성자', '.rv-a'],
      ['리뷰 날짜', '.rv-d'],
      ['분야 이름', '.dom-n'],
      ['분야 수치', '.dom-v b'],
      ['기대 수치', '.dom-v span'],
      ['확보 라벨', '.vault-l'],
      ['확보 부제', '.vault-l i'],
      ['확보 수치', '.vault-n b'],
      ['의심 수치', '.susp-v b'],
      ['위험 구간', '.susp-txt b'],
      ['다음 구간까지', '.susp-txt span'],
      ['감독관 본문', '.sup-b'],
      ['시장 범례', '.leg-n'],
      ['해킹 라벨', '.hack-t'],
      ['기록', '.log'],
    ]
    return targets.map(([name, sel]) => {
      const el = document.querySelector(sel)
      if (!el) return { name, err: 'MISSING' }
      const cs = getComputedStyle(el)
      return {
        name,
        px: Math.round(parseFloat(cs.fontSize) * 10) / 10,
        weight: cs.fontWeight,
        ratio: ratio(parse(cs.color), bgOf(el)),
      }
    })
  })

  const flag = (r) => {
    if (r.err) return r.err
    const large = r.px >= 18.66 || (r.px >= 14 && +r.weight >= 700)
    const need = large ? 3.0 : 4.5
    return r.ratio >= need ? 'OK' : r.ratio >= 3.0 ? '경계' : '미달'
  }
  console.log('항목                크기    대비     판정')
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(16)}  ${String(r.px ?? '').padStart(5)}  ${String(r.ratio ?? '').padStart(6)}   ${flag(r)}`,
    )
  }
  await browser.close()
})()
