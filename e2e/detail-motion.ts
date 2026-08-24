import type { Page } from '@playwright/test'

/**
 * Retires the detail layer's entry transition for the run.
 *
 * Geometry assertions need the settled layout, and waiting for the entry
 * animation is not enough to guarantee it. The panel's content is a lazy
 * chunk: it can mount after a test already waited the animation out, which
 * restarts it. A headless page renders frames on demand, so a restarted
 * animation can sit at its first keyframe — `translateY(9px) scale(0.992)`
 * — and be measured there. Every CI failure box matched that transform over
 * the settled layout to the decimal (656.4 = 650 * 0.992 + 2.6 + 9).
 *
 * Removing the animation is what makes the measurement deterministic;
 * waiting for it only narrows the window. Registered as an init script so it
 * survives reloads and remounts alike.
 */
export async function retireDetailEntryAnimation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement('style')
      style.setAttribute('data-e2e', 'retire-detail-entry')
      style.textContent = '.detail-layer__content { animation: none !important; }'
      document.head.append(style)
    }
    if (document.head) install()
    else document.addEventListener('DOMContentLoaded', install, { once: true })
  })
}

/**
 * Lands every finite animation inside `root` on its end state.
 *
 * A backstop for motion the init script above does not cover: anything that
 * is still mid-flight when a measurement happens would otherwise contribute
 * its transient transform to the box.
 */
export async function settleFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const endTime = animation.effect?.getComputedTiming().endTime
      if (typeof endTime !== 'number' || !Number.isFinite(endTime)) continue
      try {
        animation.finish()
      } catch {
        // Not an entry transition; leave it running.
      }
    }
  })
}
