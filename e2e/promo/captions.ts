import type { Page } from '@playwright/test'

/*
 * Titles burned into the promo capture.
 *
 * The recording carries no audio track, so every claim the video makes has to
 * survive on screen. These are laid over the running game rather than cut in
 * between it, so the footage never stops to explain itself.
 */

const OVERLAY_ID = '__pz_promo_overlay'

/*
 * Install the layer as an init script rather than a one-off evaluate.
 *
 * The reel navigates several times, and each navigation would otherwise show
 * the white loading screen and then the title screen again — which reads as
 * the game restarting mid-video. Registering it up front means every document
 * comes up already behind an opaque card, so a navigation plays as a cut.
 */
export async function installCaptionLayer(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    // At init-script time the document has not started parsing, so
    // documentElement is still null — touching it here aborts the whole
    // script and the layer never gets built.
    const paint = () => {
      if (document.documentElement) {
        document.documentElement.style.background = '#060d16'
      }
    }
    paint()
    const build = () => {
    paint()
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.textContent = `
      #${id} {
        position: fixed;
        inset: 0;
        contain: layout paint;
        z-index: 2147483647;
        pointer-events: none;
        font-family: 'Pretendard', 'Noto Sans KR', system-ui, sans-serif;
      }
      #${id}[data-live='false'] { display: none; }
      #${id} .pz-cap {
        position: absolute;
        left: 4.4vw;
        bottom: 6.2vh;
        max-width: 46vw;
        padding: 1.05rem 1.5rem 1.05rem 1.35rem;
        background: linear-gradient(
          90deg,
          rgba(6, 13, 22, 0.94) 0%,
          rgba(6, 13, 22, 0.82) 100%
        );
        border-left: 3px solid #ff6b3d;
        opacity: 0;
        transform: translateY(14px);
        transition: opacity 420ms ease, transform 420ms ease;
      }
      #${id} .pz-cap[data-shown='true'] {
        opacity: 1;
        transform: translateY(0);
      }
      #${id} .pz-cap__kicker {
        display: block;
        margin: 0 0 0.42rem;
        font-size: 0.72rem;
        letter-spacing: 0.34em;
        text-transform: uppercase;
        color: #ff6b3d;
      }
      #${id} .pz-cap__line {
        margin: 0;
        font-size: 1.42rem;
        line-height: 1.5;
        letter-spacing: -0.01em;
        color: #eef4fb;
      }
      #${id} .pz-card {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.4rem;
        background: #060d16;
        opacity: 0;
        transition: opacity 620ms ease;
      }
      #${id} .pz-card[data-shown='true'] { opacity: 1; }
      #${id} .pz-card__title {
        margin: 0;
        font-size: 4.6rem;
        letter-spacing: 0.24em;
        color: #eef4fb;
      }
      #${id} .pz-card__rule {
        width: 8.5rem;
        height: 2px;
        background: #ff6b3d;
      }
      #${id} .pz-card__line {
        margin: 0;
        font-size: 1.5rem;
        letter-spacing: 0.02em;
        color: #9db2c9;
      }
      #${id} .pz-plate,
      #${id} .pz-binary {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 620ms ease;
        background: #060d16;
      }
      #${id} .pz-plate[data-shown='true'],
      #${id} .pz-binary[data-shown='true'] { opacity: 1; }
      #${id} .pz-plate img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #060d16;
      }
      #${id} .pz-card__link {
        margin: 0.6rem 0 0;
        font-size: 1.22rem;
        letter-spacing: 0.04em;
        color: #ff6b3d;
      }
    `
    const layer = document.createElement('div')
    layer.id = id
    layer.innerHTML = `
      <div class="pz-plate" data-role="plate"><img alt="" data-role="plate-img" /></div>
      <canvas class="pz-binary" data-role="binary"></canvas>
      <div class="pz-card" data-role="card">
        <h1 class="pz-card__title" data-role="card-title"></h1>
        <div class="pz-card__rule"></div>
        <p class="pz-card__line" data-role="card-line"></p>
        <p class="pz-card__link" data-role="card-link"></p>
      </div>
      <div class="pz-cap" data-role="caption">
        <span class="pz-cap__kicker" data-role="kicker"></span>
        <p class="pz-cap__line" data-role="line"></p>
      </div>
    `
    document.head.append(style)
    document.body.append(layer)
    // Up by default: whatever the navigation is doing happens behind it.
    layer.querySelector('[data-role="card"]')!.setAttribute('data-shown', 'true')
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build, { once: true })
    } else {
      build()
    }
  }, OVERLAY_ID)
}

/** Fade a caption in, hold it for `holdMs`, fade it out. */
export async function caption(
  page: Page,
  kicker: string,
  line: string,
  holdMs: number,
): Promise<void> {
  await page.evaluate(
    ({ id, kicker: k, line: l }) => {
      const layer = document.getElementById(id)
      if (!layer) return
      layer.querySelector('[data-role="kicker"]')!.textContent = k
      layer.querySelector('[data-role="line"]')!.textContent = l
      layer
        .querySelector('[data-role="caption"]')!
        .setAttribute('data-shown', 'true')
    },
    { id: OVERLAY_ID, kicker, line },
  )
  await page.waitForTimeout(holdMs)
  await hideCaption(page)
}

/** Show a caption and leave it up while the caller drives the game. */
export async function showCaption(
  page: Page,
  kicker: string,
  line: string,
): Promise<void> {
  await page.evaluate(
    ({ id, kicker: k, line: l }) => {
      const layer = document.getElementById(id)
      if (!layer) return
      layer.querySelector('[data-role="kicker"]')!.textContent = k
      layer.querySelector('[data-role="line"]')!.textContent = l
      layer
        .querySelector('[data-role="caption"]')!
        .setAttribute('data-shown', 'true')
    },
    { id: OVERLAY_ID, kicker, line },
  )
}

export async function hideCaption(page: Page): Promise<void> {
  await page.evaluate((id) => {
    document
      .getElementById(id)
      ?.querySelector('[data-role="caption"]')
      ?.setAttribute('data-shown', 'false')
  }, OVERLAY_ID)
  await page.waitForTimeout(460)
}

export async function showCard(
  page: Page,
  title: string,
  line: string,
  link = '',
): Promise<void> {
  await page.evaluate(
    ({ id, title: t, line: l, link: u }) => {
      const layer = document.getElementById(id)
      if (!layer) return
      layer.querySelector('[data-role="card-title"]')!.textContent = t
      layer.querySelector('[data-role="card-line"]')!.textContent = l
      layer.querySelector('[data-role="card-link"]')!.textContent = u
      layer.querySelector('[data-role="card"]')!.setAttribute('data-shown', 'true')
    },
    { id: OVERLAY_ID, title, line, link },
  )
  await page.waitForTimeout(680)
}

export async function hideCard(page: Page): Promise<void> {
  await page.evaluate((id) => {
    document
      .getElementById(id)
      ?.querySelector('[data-role="card"]')
      ?.setAttribute('data-shown', 'false')
  }, OVERLAY_ID)
  await page.waitForTimeout(680)
}

/*
 * Take the whole layer out of the frame.
 *
 * Combat runs on real RAF cadence and real key events, and a fixed overlay
 * composited over the canvas every frame is enough to make the steering miss
 * its turns. The reel captions around the round, never through it.
 */
export async function setLayerLive(page: Page, live: boolean): Promise<void> {
  await page.evaluate(
    ({ id, live: on }) => {
      document
        .getElementById(id)
        ?.setAttribute('data-live', on ? 'true' : 'false')
    },
    { id: OVERLAY_ID, live },
  )
}

/** Hold a still full-frame — the key art that opens the reel. */
export async function showPlate(page: Page, src: string): Promise<void> {
  await page.evaluate(
    ({ id, src: url }) => {
      const layer = document.getElementById(id)
      if (!layer) return
      const img = layer.querySelector('[data-role="plate-img"]') as HTMLImageElement
      img.src = url
      layer.querySelector('[data-role="plate"]')!.setAttribute('data-shown', 'true')
    },
    { id: OVERLAY_ID, src },
  )
  await page.waitForTimeout(700)
}

export async function hidePlate(page: Page): Promise<void> {
  await page.evaluate((id) => {
    document
      .getElementById(id)
      ?.querySelector('[data-role="plate"]')
      ?.setAttribute('data-shown', 'false')
  }, OVERLAY_ID)
  await page.waitForTimeout(700)
}

/*
 * A wash of ones and zeroes. This is a title card, not the game — it stands
 * where the story stops making sense to the thing telling it.
 */
export async function showBinaryRain(page: Page, holdMs: number): Promise<void> {
  await page.evaluate((id) => {
    const layer = document.getElementById(id)
    if (!layer) return
    const canvas = layer.querySelector('[data-role="binary"]') as HTMLCanvasElement
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = 16
    const columns = Math.ceil(canvas.width / size)
    const drops = Array.from({ length: columns }, () =>
      Math.floor((Math.random() * canvas.height) / size),
    )
    const win = window as unknown as { __pzBinaryTimer?: number }
    const tick = () => {
      ctx.fillStyle = 'rgba(6, 13, 22, 0.16)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${size - 2}px "SFMono-Regular", ui-monospace, monospace`
      for (let column = 0; column < columns; column += 1) {
        const y = drops[column] * size
        ctx.fillStyle = Math.random() < 0.06 ? '#ff6b3d' : 'rgba(160, 214, 255, 0.72)'
        ctx.fillText(Math.random() < 0.5 ? '0' : '1', column * size, y)
        drops[column] =
          y > canvas.height && Math.random() > 0.975 ? 0 : drops[column] + 1
      }
    }
    win.__pzBinaryTimer = window.setInterval(tick, 45)
    canvas.setAttribute('data-shown', 'true')
  }, OVERLAY_ID)
  await page.waitForTimeout(holdMs)
  await page.evaluate((id) => {
    const win = window as unknown as { __pzBinaryTimer?: number }
    if (win.__pzBinaryTimer) window.clearInterval(win.__pzBinaryTimer)
    document
      .getElementById(id)
      ?.querySelector('[data-role="binary"]')
      ?.setAttribute('data-shown', 'false')
  }, OVERLAY_ID)
  await page.waitForTimeout(700)
}
